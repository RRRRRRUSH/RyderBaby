import { EventEmitter } from 'node:events'
import { Notification } from 'electron'
import type { PetEvent, TaskEndEvent } from '../shared/types'
import { buildTaskCard, fmtTokens, isSuccess, isTaskLevel } from './task-card'

export type ReminderLevel = 'L1' | 'L2'

export interface Reminder {
  level: ReminderLevel
  title: string
  body: string
  mood: 'happy' | 'worried' | 'panicked' | 'offline'
  sound?: boolean
  /** 是否要推到手机/群（PushRouter） */
  pushToChannels?: boolean
  /** 事件来源 agent（dsh / claude-code / codex） */
  source?: string
}

export interface NotifierOptions {
  /** token 预算阈值（日级） */
  dailyTokenBudget?: number
  /** 预警档位：0.5 / 0.8 / 1.0 */
  warningLevels?: number[]
  /** 命令级（job）完成时是否提醒（默认 false：npm 等命令不打扰） */
  notifyCommandSuccess?: boolean
  /** 命令级（job）失败时是否提醒（默认 true） */
  notifyCommandFailure?: boolean
  /** 任务级完成/失败是否提醒（默认 true） */
  notifyTaskLevel?: boolean
  /** 系统级（断线/错误）是否提醒（默认 true） */
  notifySystem?: boolean
}

/**
 * 提醒规则引擎（分级版）：
 * - 任务级（workflow/subagent/agent-session）结束 → 卡片 + 推送（可开关）
 * - 命令级（job）→ 默认只记录不推（npm 等命令不打扰；失败可选提醒）
 * - 系统级（断线/agent-error）→ L2
 * - token 阈值 → 50% / 80% / 100% 分级 L2
 */
export class Notifier extends EventEmitter {
  private readonly options: Required<NotifierOptions>
  private muted = false
  private paused = false
  private firedLevels: Set<string> = new Set()
  private dailyWindow = ''
  /** 事件回调：外部注入查询会话 token 的函数（避免 Notifier 依赖 store） */
  sessionTokenFn: ((sessionId: string) => number) | null = null
  /** 事件回调：外部注入计算本次任务花费的函数（按价格与用量） */
  costFn: ((ev: TaskEndEvent) => number | undefined) | null = null

  constructor(options: NotifierOptions = {}) {
    super()
    this.options = {
      dailyTokenBudget: Number(process.env.RYDERBABY_DAILY_BUDGET) || 1000000,
      warningLevels: [0.5, 0.8, 1.0],
      notifyCommandSuccess: false,
      notifyCommandFailure: true,
      notifyTaskLevel: true,
      notifySystem: true,
      ...options
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  /** 设置页实时更新预算与分级开关 */
  setOptions(next: Partial<NotifierOptions>): void {
    if (next.dailyTokenBudget !== undefined) this.options.dailyTokenBudget = next.dailyTokenBudget
    if (next.warningLevels !== undefined) this.options.warningLevels = next.warningLevels
    if (next.notifyCommandSuccess !== undefined) this.options.notifyCommandSuccess = next.notifyCommandSuccess
    if (next.notifyCommandFailure !== undefined) this.options.notifyCommandFailure = next.notifyCommandFailure
    if (next.notifyTaskLevel !== undefined) this.options.notifyTaskLevel = next.notifyTaskLevel
    if (next.notifySystem !== undefined) this.options.notifySystem = next.notifySystem
    this.firedLevels.clear()
  }

  private emitReminder(reminder: Reminder): void {
    if (this.muted || this.paused) return
    this.emit('reminder', reminder)
    if (reminder.level === 'L2' || reminder.sound) {
      this.showSystemNotification(reminder)
    }
  }

  private showSystemNotification(reminder: Reminder): void {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: reminder.title,
      body: reminder.body,
      silent: !reminder.sound
    })
    n.show()
  }

  handleEvent(event: PetEvent, totals: { todayInput: number; todayOutput: number }): void {
    switch (event.type) {
      case 'task-end': {
        this.handleTaskEnd(event)
        break
      }
      case 'agent-error': {
        if (!this.options.notifySystem) break
        this.emitReminder({
          level: 'L2',
          title: 'Agent 出错 ⚠️',
          body: event.message,
          mood: 'worried',
          sound: true,
          pushToChannels: true
        })
        break
      }
      default:
        break
    }

    // token 阈值检查（日级）
    if (event.type === 'usage') {
      this.checkTokenThresholds(totals.todayInput + totals.todayOutput)
    }
  }

  private handleTaskEnd(ev: TaskEndEvent): void {
    const ok = isSuccess(ev.result)
    const taskLevel = isTaskLevel(ev.kind)

    // 命令级（job）：默认只记录不推；失败可配置提醒
    if (!taskLevel) {
      if (ok && !this.options.notifyCommandSuccess) return
      if (!ok && !this.options.notifyCommandFailure) return
    } else if (!this.options.notifyTaskLevel) {
      return
    }

    // 卡片化：外部注入的 token 查询补充会话消耗；costFn 计算本次花费
    const sessionTokens = ev.source && ev.source !== 'dsh' && this.sessionTokenFn
      ? this.sessionTokenFn(ev.sessionId ?? '')
      : undefined
    const cost = this.costFn ? this.costFn(ev) : undefined
    const card = buildTaskCard(ev, sessionTokens, cost)

    this.emitReminder({
      level: ok ? 'L1' : 'L2',
      title: card.title,
      body: card.body,
      mood: ok ? 'happy' : 'worried',
      sound: !ok,
      pushToChannels: true,
      source: ev.source
    })
  }

  private checkTokenThresholds(todayTokens: number): void {
    const now = new Date()
    const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
    if (dayKey !== this.dailyWindow) {
      this.dailyWindow = dayKey
      this.firedLevels.clear()
    }
    const budget = this.options.dailyTokenBudget
    for (const level of this.options.warningLevels) {
      const key = `${level}`
      if (this.firedLevels.has(key)) continue
      if (todayTokens >= budget * level) {
        this.firedLevels.add(key)
        this.emitReminder({
          level: 'L2',
          title: `Token 预警 🔥 ${Math.round(level * 100)}%`,
          body: `今日已消耗 ${fmtTokens(todayTokens)} tokens（预算 ${fmtTokens(budget)}）`,
          mood: 'panicked',
          sound: level >= 1,
          pushToChannels: true
        })
      }
    }
  }
}
