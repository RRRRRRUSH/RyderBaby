import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { SseClient } from './sse-client'
import { JsonEventStore, type EventStore } from './store'
import { Notifier, type Reminder } from './notifier'
import { SettingsStore } from './settings'
import { DingTalkChannel, PushRouter } from './push'
import { ExternalWatcher } from './external-watcher'
import { AgentDiscovery } from './agent-discovery'
import { TaskTracker } from './task-tracker'
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
let connectionState: ConnectionState = 'offline'
let petMood: string = 'idle'
let lastReminder: Reminder | null = null
let quitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 260,
    height: 320,
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
  ipcMain.handle('pet:get-state', () => ({
    connection: connectionState,
    mood: petMood,
    lastReminder,
    aggregate: store?.aggregate() ?? null,
    todayTokens: store?.todayTokens() ?? null,
    settings: settingsStore?.get() ?? null
  }))

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

  ipcMain.handle('pet:set-muted', (_e, muted: boolean) => {
    notifier?.setMuted(muted)
    return { ok: true }
  })

  ipcMain.handle('pet:set-paused', (_e, paused: boolean) => {
    notifier?.setPaused(paused)
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
  // 外部工具监视器：按设置启停
  applyExternalWatcher(settings.external)
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

function applyExternalWatcher(cfg: AppSettings['external']): void {
  const want = cfg.claudeCode || cfg.codex
  if (want && !externalWatcher) {
    const watcher = new ExternalWatcher({
      watchClaude: cfg.claudeCode,
      watchCodex: cfg.codex,
      claudeRoot: cfg.claudeRoot.trim() || undefined,
      codexRoot: cfg.codexRoot.trim() || undefined
    })
    watcher.on('event', ({ event, source }) => {
      // 标记来源并注册活跃度
      let tagged = { ...event, source }
      if (tagged.type === 'task-end' && taskTracker) {
        tagged = taskTracker.enrich(tagged)
      }
      agentDiscovery?.markActivity(source)
      store?.append(tagged)
      const today = store?.todayTokens() ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
      // 按 agent 开关过滤：该 agent 未启用监控则忽略其事件
      if (!isAgentWatched(source)) return
      notifier?.handleEvent(tagged, { todayInput: today.input, todayOutput: today.output })
      if (tagged.type === 'usage') broadcastToRenderer('pet:usage', tagged)
      if (tagged.type === 'task-end') broadcastToRenderer('pet:task-end', tagged)
      broadcastToRenderer('pet:event', tagged)
    })
    externalWatcher = watcher
    watcher.start()
    console.log(`[pet] external watcher started (claude=${cfg.claudeCode} codex=${cfg.codex})`)
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
      petMood = 'idle'
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
    agentDiscovery?.markActivity('dsh')
    store?.append(event)
    const today = store?.todayTokens() ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
    // 按 agent 开关过滤：dsh 未启用监控则忽略
    if (isAgentWatched('dsh')) {
      notifier?.handleEvent(event, { todayInput: today.input, todayOutput: today.output })
    }

    // 状态折叠：working / idle
    if (event.type === 'agent-status') {
      if (event.state === 'running') taskTracker?.onAgentRunning(event.agentId)
      else taskTracker?.onAgentIdle(event.agentId)
      petMood = event.state === 'running' ? 'working' : petMood === 'working' ? 'idle' : petMood
      broadcastToRenderer('pet:mood', petMood)
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

app.whenReady().then(() => {
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
