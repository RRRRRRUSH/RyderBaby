import type { PetEvent, TaskEndEvent, UsageEvent } from '../shared/types'

/** Agent 来源显示名 */
export const SOURCE_LABELS: Record<string, string> = {
  dsh: 'DSH',
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

export function sourceLabel(source?: string): string {
  return (source && SOURCE_LABELS[source]) || source || 'DSH'
}

/** Token 单位换算：M（百万） */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 耗时格式化 */
export function fmtDuration(startTs: number, endTs: number): string {
  const secs = Math.max(0, Math.round((endTs - startTs) / 1000))
  if (secs < 60) return `${secs}秒`
  if (secs < 3600) return `${Math.floor(secs / 60)}分${secs % 60 ? `${secs % 60}秒` : ''}`
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}小时${m ? `${m}分` : ''}`
}

/** 任务级类别判定：workflow / subagent / turn / agent-session 是"任务"，job 是"命令" */
export function isTaskLevel(kind: TaskEndEvent['kind']): boolean {
  return kind === 'workflow' || kind === 'subagent' || kind === 'turn' || kind === 'agent-session'
}

/** 结果判定 */
export function isSuccess(result: string): boolean {
  return result === 'ok' || result === 'completed' || result === 'success' || result === 'finished'
}

export interface TaskCardData {
  source: string
  kind: string
  title: string
  result: string
  detail?: string
  startedAt?: number
  endedAt?: number
  turns?: number
  tokens?: number
  sessionId?: string
}

/**
 * 把一次任务结束事件整理成结构化 markdown 卡片（钉钉/飞书通用）。
 * 从会话累计中带出 token 与轮次信息，避免只推一行原始 label。
 */
export function buildTaskCard(ev: TaskEndEvent, sessionTokens?: number): { title: string; body: string } {
  const src = sourceLabel(ev.source)
  const ok = isSuccess(ev.result)
  const kindLabel: Record<string, string> = {
    workflow: '工作流',
    subagent: '子任务',
    turn: '回合',
    'agent-session': '会话',
    job: '命令',
    goal: '目标'
  }
  const kindZh = kindLabel[ev.kind] ?? ev.kind
  // 任务名：turn 用任务内容（label 已是提取的用户消息）；workflow 用 meta.name；其余用 label/runId
  const taskName =
    ev.meta?.name || ev.label || ev.runId || ev.jobId || (ev.kind === 'turn' ? `第 ${ev.turn ?? '?'} 轮对话` : '(未命名任务)')

  const title = `${ok ? '✅' : '❌'} ${src} · ${kindZh}${ok ? '完成' : '失败'}`

  // 卡片主体：钉钉 markdown 用「- 前缀」让每行独立渲染
  const rows: string[] = []
  rows.push(`**${taskName}**`)
  if (ev.kind === 'turn' && typeof ev.turn === 'number') {
    rows.push(`- 🔄 回合：第 ${ev.turn} 轮`)
  }
  if (ev.endedAt && ev.startedAt) {
    rows.push(`- ⏱ 耗时：${fmtDuration(ev.startedAt, ev.endedAt)}`)
  }
  const tokens = ev.tokens ?? sessionTokens
  if (tokens !== undefined && tokens > 0) {
    rows.push(`- ⚡ Token：${fmtTokens(tokens)}`)
  }
  if (ev.agentsStarted !== undefined && ev.agentsStarted > 0) {
    rows.push(`- 🧩 轮次：${ev.agentsStarted} 次 agent 调用`)
  }
  if (ev.detail) {
    rows.push(`- 📎 详情：${ev.detail.slice(0, 200)}`)
  }
  rows.push(`- ${ok ? '✅' : '❌'} 结果：${ok ? '成功' : ev.result}`)

  return { title, body: rows.join('\n') }
}

/** 统计命令卡片：token 消耗统计（@机器人 查询用，后续版本） */
export function buildStatsCard(data: {
  todayTokens: number
  totalTokens: number
  taskOk: number
  taskFail: number
  activeAgents: number
}): { title: string; body: string } {
  const lines: string[] = []
  lines.push(`📊 **RyderBaby 状态报告**`)
  lines.push(`⚡ 今日 Token: ${fmtTokens(data.todayTokens)}`)
  lines.push(`⚡ 累计 Token: ${fmtTokens(data.totalTokens)}`)
  lines.push(`🧩 任务: ${data.taskOk} 成功 / ${data.taskFail} 失败`)
  lines.push(`🤖 活跃 Agent: ${data.activeAgents}`)
  return { title: 'RyderBaby 状态报告', body: lines.join('\n') }
}

/** 从 usage 事件累计某会话 token */
export function sumSessionTokens(events: PetEvent[], sessionId: string): number {
  let total = 0
  for (const e of events) {
    if (e.type === 'usage' && (e as UsageEvent).sessionId === sessionId) {
      const u = (e as UsageEvent).usage
      total += u.input + u.output + u.cacheRead + u.cacheWrite
    }
  }
  return total
}
