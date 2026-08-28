import type { TaskEndEvent } from '../shared/types'

/**
 * 任务跟踪器：维护各来源 agent 的"当前任务开始时间"。
 * - agent-status running → 记录该 agent 任务开始
 * - task-end → 若带 sessionId/agentId 能匹配到开始时间，补 startedAt/endedAt
 * 用于卡片耗时展示（DSH 插件事件不带时间戳，由桌宠侧推导）。
 */
export class TaskTracker {
  private starts = new Map<string, number>()

  /** agent-status 事件时调用：记录忙碌开始 */
  onAgentRunning(agentId: string): void {
    if (!this.starts.has(agentId)) {
      this.starts.set(agentId, Date.now())
    }
  }

  /** agent-status idle 时清理（避免陈旧） */
  onAgentIdle(agentId: string): void {
    // 保留一小段时间，供随后的 task-end 匹配；5 分钟后自然失效
    const ts = this.starts.get(agentId)
    if (ts !== undefined && Date.now() - ts > 5 * 60_000) {
      this.starts.delete(agentId)
    }
  }

  /** task-end 时调用：补充 startedAt/endedAt 并返回增强后的事件 */
  enrich(ev: TaskEndEvent): TaskEndEvent {
    const now = Date.now()
    const key = ev.sessionId ?? ev.agentId ?? ev.runId
    let startedAt = ev.startedAt
    if (startedAt === undefined && key) {
      const s = this.starts.get(key)
      if (s !== undefined) startedAt = s
    }
    if (startedAt === undefined && key && this.starts.size > 0) {
      // 兜底：用最早的 running 时间（多 agent 并发时最接近的）
      let best = Infinity
      for (const v of this.starts.values()) {
        if (v < best) best = v
      }
      if (best !== Infinity) startedAt = best
    }
    const out: TaskEndEvent = { ...ev, startedAt, endedAt: now }
    if (key) this.starts.delete(key)
    return out
  }
}
