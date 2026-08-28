import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'node:path'
import { SseClient } from './sse-client'
import { JsonEventStore, type EventStore } from './store'
import { Notifier, type Reminder } from './notifier'
import { SettingsStore } from './settings'
import { DingTalkChannel, PushRouter } from './push'
import { ExternalWatcher } from './external-watcher'
import { AgentDiscovery } from './agent-discovery'
import { TaskTracker } from './task-tracker'
import { calcCost, costOfTotals, fmtCost } from './cost'
import type { ConnectionState, PetEvent, TaskEndEvent } from '../shared/types'
import type { AppSettings } from '../shared/settings'

// 图标路径（开发/打包通用：build 目录随 asar 打包）
const ICON_DIR = join(__dirname, '../../build')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let sse: SseClient | null = null
let store: EventStore | null = null
let notifier: Notifier | null = null
let settingsStore: SettingsStore | null = null
let pushRouter: PushRouter | null = null
let externalWatcher: ExternalWatcher | null = null
let agentDiscovery: AgentDiscovery | null = null
let taskTracker: TaskTracker | null = null
/** 回合级去重：同一会话同一回合号只推送一次（插件更新/重连可能重复发） */
const seenTurns = new Set<string>()
/** 活跃 agent 集合：多 agent 并发状态汇总（任一 running 即 working） */
const activeAgents = new Set<string>()
let connectionState: ConnectionState = 'offline'
let petMood: string = 'idle'
let lastReminder: Reminder | null = null
let quitting = false

function createWindow(): void {
  // 初始位置：主屏右下角（桌宠习惯位置），避开任务栏
  const wa = screen.getPrimaryDisplay().workArea
  const posX = wa.x + wa.width - 260 - 16
  const posY = wa.y + wa.height - 320 - 16

  mainWindow = new BrowserWindow({
    width: 260,
    height: 320,
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    icon: join(ICON_DIR, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 置顶层级：Win 用 screen-saver，mac 用 floating（跨平台适配）
  mainWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver')

  // 点击穿透：透明区域不拦截鼠标（桌面宠物不挡操作）
  // 默认穿透；渲染层 hover 到可交互区域时通过 IPC 切换为可交互
  mainWindow.setIgnoreMouseEvents(true, { forward: true })
  ipcMain.handle('pet:set-ignore-mouse', (_e, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
    return { ok: true }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** 设置窗口：独立常规窗口（非透明），承载设置表单 */
let settingsWindow: BrowserWindow | null = null

function createSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    title: 'RyderBaby 设置',
    frame: false,
    resizable: true,
    minimizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?settings=1#/settings`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { settings: '1' },
      hash: '/settings'
    })
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(join(ICON_DIR, 'tray.png'))
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon)
  const ctx = Menu.buildFromTemplate([
    { label: '显示桌宠', click: () => showPet() },
    { label: '设置…', click: () => createSettingsWindow() },
    { label: '静音提醒', type: 'checkbox', checked: false, click: (item) => notifier?.setMuted(item.checked) },
    { label: '暂停提醒', type: 'checkbox', checked: false, click: (item) => notifier?.setPaused(item.checked) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ])
  tray.setToolTip('RyderBaby 桌宠')
  tray.setContextMenu(ctx)
  tray.on('click', () => showPet())
}

function showPet(): void {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

function setupIpc(): void {
  ipcMain.handle('pet:get-state', () => {
    const today = store?.todayTokens() ?? null
    return {
      connection: connectionState,
      mood: petMood,
      lastReminder,
      aggregate: store?.aggregate() ?? null,
      todayTokens: today,
      todayCost: today && settingsStore ? costOfTotals(today, settingsStore.get().pricing) : 0,
      settings: settingsStore?.get() ?? null
    }
  })

  ipcMain.handle('pet:get-settings', () => settingsStore?.get() ?? null)

  ipcMain.handle('pet:set-settings', (_e, patch: Partial<AppSettings>) => {
    if (!settingsStore) return { ok: false, error: 'settings unavailable' }
    const next = settingsStore.update(patch)
    applySettings(next)
    return { ok: true, settings: next }
  })

  ipcMain.handle('pet:test-push', async () => {
    const results = pushRouter ? await pushRouter.testAll() : []
    return { results }
  })

  ipcMain.handle('pet:list-channels', () => pushRouter?.list() ?? [])

  ipcMain.handle('pet:list-agents', () => agentDiscovery?.list() ?? [])

  ipcMain.handle('pet:get-token-history', (_e, opts?: { bucket?: 'hour' | 'day'; days?: number }) => {
    if (!store) return []
    return store.tokenHistory(opts?.bucket ?? 'day', opts?.days ?? 7)
  })

  // 按会话统计：每个会话的 token/花费/回合数
  ipcMain.handle('pet:get-sessions', () => {
    if (!store || !settingsStore) return []
    const pricing = settingsStore.get().pricing
    const agg = store.aggregate()
    // 会话标题：从事件表找最近一次 sessionTitle
    const titleOf = new Map<string, string>()
    const turnsOf = new Map<string, number>()
    for (const e of store.query()) {
      if (e.type === 'task-end' && e.kind === 'turn') {
        if (e.sessionId) {
          if (e.sessionTitle) titleOf.set(e.sessionId, e.sessionTitle)
          turnsOf.set(e.sessionId, (turnsOf.get(e.sessionId) ?? 0) + 1)
        }
      }
    }
    const out: Array<{ id: string; title: string; input: number; output: number; cacheRead: number; tokens: number; cost: number; turns: number }> = []
    for (const [id, s] of Object.entries(agg.sessions)) {
      out.push({
        id,
        title: titleOf.get(id) ?? id.slice(0, 12),
        input: s.input,
        output: s.output,
        cacheRead: s.cacheRead,
        tokens: s.input + s.output + s.cacheRead + s.cacheWrite,
        cost: calcCost({ input: s.input, output: s.output, cacheRead: s.cacheRead }, pricing),
        turns: turnsOf.get(id) ?? 0
      })
    }
    return out.sort((a, b) => b.tokens - a.tokens)
  })

  ipcMain.handle('pet:set-muted', (_e, muted: boolean) => {
    notifier?.setMuted(muted)
    return { ok: true }
  })

  ipcMain.handle('pet:set-paused', (_e, paused: boolean) => {
    notifier?.setPaused(paused)
    return { ok: true }
  })

  ipcMain.handle('pet:minimize-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
    return { ok: true }
  })

  ipcMain.handle('pet:close-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
    return { ok: true }
  })

  ipcMain.handle('pet:quit', () => {
    quitting = true
    app.quit()
  })
}

/** 设置变更后应用到运行时各组件 */
function applySettings(settings: AppSettings): void {
  // 预算阈值与分级开关喂给 Notifier
  if (notifier) {
    notifier.setOptions({
      dailyTokenBudget: settings.reminders.dailyTokenBudget,
      warningLevels: settings.reminders.warningLevels,
      notifyCommandSuccess: settings.reminders.notifyCommandSuccess,
      notifyCommandFailure: settings.reminders.notifyCommandFailure,
      notifyTaskLevel: settings.agents.watch.dsh || settings.agents.watch['claude-code'] || settings.agents.watch.codex
    })
  }
  // 外部工具监视器：由 agents.watch 驱动（claude-code / codex 的监控开关）
  applyExternalWatcher(settings.agents.watch)
  // DSH 地址变更：重启 SSE 连接（仅地址确实不同时）
  if (sse && settings.dshUrl.trim()) {
    const target = `${settings.dshUrl.trim().replace(/\/$/, '')}/pet/events`
    if (sse.url !== target) {
      sse.stop()
      sse = new SseClient({ url: target })
      wireSse(sse)
      sse.start()
    }
  }
}

function applyExternalWatcher(watch: Record<string, boolean>): void {
  const wantClaude = watch['claude-code'] === true
  const wantCodex = watch.codex === true
  const want = wantClaude || wantCodex
  if (want && !externalWatcher) {
    const watcher = new ExternalWatcher({
      watchClaude: wantClaude,
      watchCodex: wantCodex
    })
    watcher.on('event', ({ event, source }) => {
      // 标记来源并注册活跃度
      let tagged = { ...event, source }
      if (tagged.type === 'task-end' && taskTracker) {
        tagged = taskTracker.enrich(tagged)
      }
      // 回合级去重（与 SSE 路径共用 seenTurns）
      let turnDeduped = false
      if (tagged.type === 'task-end' && tagged.kind === 'turn' && typeof tagged.turn === 'number' && tagged.sessionId) {
        const key = `${tagged.sessionId}|${tagged.turn}`
        if (seenTurns.has(key)) {
          turnDeduped = true
        } else {
          seenTurns.add(key)
          if (seenTurns.size > 500) seenTurns.clear()
        }
      }
      agentDiscovery?.markActivity(source)
      store?.append(tagged)
      const today = store?.todayTokens() ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
      // 按 agent 开关过滤：该 agent 未启用监控则忽略其事件；回合重复跳过提醒
      if (!isAgentWatched(source) || turnDeduped) return
      notifier?.handleEvent(tagged, { todayInput: today.input, todayOutput: today.output })
      if (tagged.type === 'usage') broadcastToRenderer('pet:usage', tagged)
      if (tagged.type === 'task-end') broadcastToRenderer('pet:task-end', tagged)
      broadcastToRenderer('pet:event', tagged)
    })
    externalWatcher = watcher
    watcher.start()
    console.log(`[pet] external watcher started (claude=${wantClaude} codex=${wantCodex})`)
  } else if (!want && externalWatcher) {
    externalWatcher.stop()
    externalWatcher = null
    console.log('[pet] external watcher stopped')
  }
}

function setupDataPlumbing(): void {
  store = new JsonEventStore()
  settingsStore = new SettingsStore()
  taskTracker = new TaskTracker()
  agentDiscovery = new AgentDiscovery(
    () => connectionState === 'connected',
    () => petMood === 'working'
  )
  notifier = new Notifier({
    dailyTokenBudget: settingsStore.get().reminders.dailyTokenBudget,
    warningLevels: settingsStore.get().reminders.warningLevels,
    notifyCommandSuccess: settingsStore.get().reminders.notifyCommandSuccess,
    notifyCommandFailure: settingsStore.get().reminders.notifyCommandFailure
  })
  // 会话 token 查询（卡片补充用）：按 sessionId 从 store 累计
  notifier.sessionTokenFn = (sessionId: string) => {
    if (!store || !sessionId) return 0
    let total = 0
    for (const e of store.query()) {
      if (e.type === 'usage' && e.sessionId === sessionId) {
        total += e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite
      }
    }
    return total
  }
  // 任务花费估算：按任务时间区间 + 会话过滤的 usage 用量 × 价格
  notifier.costFn = (ev: TaskEndEvent) => {
    if (!store || !settingsStore) return undefined
    const pricing = settingsStore.get().pricing
    const from = ev.startedAt ?? 0
    const to = ev.endedAt ?? Date.now()
    let input = 0
    let output = 0
    let cacheRead = 0
    for (const e of store.query(from, to)) {
      // 只统计本任务所属会话的 usage（多 agent 并发不串账）
      if (e.type === 'usage' && e.sessionId === ev.sessionId) {
        input += e.usage.input
        output += e.usage.output
        cacheRead += e.usage.cacheRead
      }
    }
    // turn 事件的 tokens 已是本回合增量；若按窗口没取到（起始时间不准），
    // 用 ev.tokens 作为兜底估算——但单数字无法拆分三价，故返回 undefined 让卡片只显 token
    if (input === 0 && output === 0 && cacheRead === 0) return undefined
    return calcCost({ input, output, cacheRead }, pricing)
  }

  // 推送渠道：目前只有钉钉，后续飞书/企微/公众号在此追加
  const dingtalk = new DingTalkChannel(() => settingsStore!.get().push.dingtalk)
  pushRouter = new PushRouter([dingtalk])

  notifier.on('reminder', (reminder: Reminder) => {
    lastReminder = reminder
    if (reminder.mood) petMood = reminder.mood
    console.log(`[pet] reminder L${reminder.level}: ${reminder.title} — ${reminder.body.replace(/\n/g, ' | ')}`)
    broadcastToRenderer('pet:reminder', reminder)
    // 手机/群推送：仅当 reminder 标记要推且对应 agent 允许推送
    if (reminder.pushToChannels && isAgentPushEnabled(reminder.source ?? 'dsh')) {
      void pushRouter?.broadcast(reminder).then((results) => {
        for (const r of results) {
          if (!r.ok) console.error(`[pet] push ${r.channel} failed: ${r.error}`)
        }
      })
    }
    // 几秒后回到工作/空闲状态
    setTimeout(() => {
      if (petMood === reminder.mood) petMood = 'idle'
      broadcastToRenderer('pet:mood', petMood)
    }, 8000)
  })

  sse = new SseClient({ url: `${settingsStore.get().dshUrl.replace(/\/$/, '')}/pet/events` })
  wireSse(sse)
  sse.start()
}

function wireSse(client: SseClient): void {
  client.on('state', (state: ConnectionState) => {
    connectionState = state
    if (state === 'connected') {
      petMood = activeAgents.size > 0 ? 'working' : 'idle'
      notifier?.setMuted(false)
      broadcastToRenderer('pet:connection', state)
      broadcastToRenderer('pet:mood', petMood)
    } else {
      petMood = state === 'offline' ? 'offline' : 'worried'
      broadcastToRenderer('pet:connection', state)
      broadcastToRenderer('pet:mood', petMood)
      if (state === 'offline') {
        notifier?.handleEvent(
          { type: 'agent-error', seq: 0, ts: Date.now(), agentId: 'dsh', message: '与 DSH 的连接已断开，正在重试…' },
          { todayInput: 0, todayOutput: 0 }
        )
      }
    }
  })

  client.on('event', (rawEvent: PetEvent) => {
    // DSH 事件统一标记 source（若插件未带）
    let event: PetEvent = rawEvent.source ? rawEvent : { ...rawEvent, source: 'dsh' }
    // task-end 先补全起止时间（卡片耗时展示），再走存储/提醒
    if (event.type === 'task-end' && taskTracker) {
      event = taskTracker.enrich(event)
    }
    // 回合级去重：插件更新/重连期间同一回合可能重复发（seq 不同），只提醒一次
    let turnDeduped = false
    if (event.type === 'task-end' && event.kind === 'turn' && typeof event.turn === 'number' && event.sessionId) {
      const key = `${event.sessionId}|${event.turn}`
      if (seenTurns.has(key)) {
        turnDeduped = true
      } else {
        seenTurns.add(key)
        // 防止无限增长：超过 500 个回合键时清空（重启窗口）
        if (seenTurns.size > 500) seenTurns.clear()
      }
    }
    agentDiscovery?.markActivity('dsh')
    store?.append(event)

    // 快照：重建活跃 agent 集合（重启/重连后状态恢复）
    if (event.type === 'snapshot') {
      const recent = event.recent ?? []
      const lastState = new Map<string, string>()
      for (const e of recent) {
        if (e.type === 'agent-status' && e.agentId) lastState.set(e.agentId, e.state)
      }
      activeAgents.clear()
      for (const [id, st] of lastState) {
        if (st === 'running') activeAgents.add(id)
      }
      const nextMood = activeAgents.size > 0 ? 'working' : 'idle'
      if (nextMood !== petMood) {
        petMood = nextMood
        broadcastToRenderer('pet:mood', petMood)
      }
      return
    }

    const today = store?.todayTokens() ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
    // 按 agent 开关过滤：dsh 未启用监控则忽略；回合重复跳过提醒
    if (isAgentWatched('dsh') && !turnDeduped) {
      notifier?.handleEvent(event, { todayInput: today.input, todayOutput: today.output })
    }

    // 状态折叠：多 agent 并发时只要有任意 agent running 就是 working
    if (event.type === 'agent-status') {
      if (event.state === 'running') taskTracker?.onAgentRunning(event.agentId)
      else taskTracker?.onAgentIdle(event.agentId)
      // 活跃 agent 集合：running 加入，idle 移除
      if (event.state === 'running') activeAgents.add(event.agentId)
      else activeAgents.delete(event.agentId)
      const nextMood = activeAgents.size > 0 ? 'working' : 'idle'
      if (nextMood !== petMood) {
        petMood = nextMood
        broadcastToRenderer('pet:mood', petMood)
      }
    }
    if (event.type === 'usage') {
      broadcastToRenderer('pet:usage', event)
    }
    if (event.type === 'task-end') {
      broadcastToRenderer('pet:task-end', event)
      // 强提醒：仅任务级（workflow/subagent/agent-session），命令级不打扰
      const isTaskKind = event.kind === 'workflow' || event.kind === 'subagent' || event.kind === 'agent-session'
      const s = settingsStore?.get()
      const ok = event.result === 'ok' || event.result === 'completed' || event.result === 'success'
      const strong = isTaskKind && (ok ? s?.reminders.strongOnTaskEnd : s?.reminders.strongOnFailure)
      if (strong) {
        broadcastToRenderer('pet:strong-reminder', {
          ok,
          kind: event.kind,
          label: event.label ?? event.runId ?? event.jobId ?? ''
        })
      }
    }
    broadcastToRenderer('pet:event', event)
  })

  client.on('reconnecting', ({ attempt, delayMs }) => {
    console.log(`[pet] reconnecting attempt ${attempt} in ${delayMs}ms`)
  })

  client.on('error', (err) => {
    console.error('[pet] SSE error:', err.message)
  })
}

function broadcastToRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** 按设置判断某 agent 是否启用监控 */
function isAgentWatched(source: string): boolean {
  const agents = settingsStore?.get().agents
  if (!agents) return true
  return agents.watch[source] ?? true
}

/** 按设置判断某 agent 是否允许推送 */
function isAgentPushEnabled(source: string): boolean {
  const agents = settingsStore?.get().agents
  if (!agents) return true
  return agents.push[source] ?? true
}

// 应用身份：替换 Electron 默认名称（任务栏/通知/菜单归属）
app.setName('RyderBaby')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.ryderbaby.desktop')
}

app.whenReady().then(() => {
  // 应用菜单：替换 Electron 默认菜单（去掉 "Electron" 字样）
  const appMenu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [
          { role: 'about' as const, label: `关于 ${app.name}` },
          { type: 'separator' as const },
          { role: 'quit' as const, label: '退出' }
        ] }]
      : []),
    { label: '文件', submenu: [{ role: 'quit' as const, label: '退出' }] },
    { label: '编辑', submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' }
      ] },
    { label: '视图', submenu: [
        { role: 'reload' as const, label: '重新加载' },
        { role: 'toggleDevTools' as const, label: '开发者工具' },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: '实际大小' },
        { role: 'zoomIn' as const, label: '放大' },
        { role: 'zoomOut' as const, label: '缩小' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '全屏' }
      ] },
    { label: '窗口', role: 'window' as const }
  ])
  Menu.setApplicationMenu(appMenu)

  setupIpc()
  createWindow()
  createTray()
  setupDataPlumbing()
  applySettings(settingsStore!.get())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 桌宠常驻：关窗不退出（托盘控制）
})

app.on('before-quit', () => {
  quitting = true
  sse?.stop()
})
