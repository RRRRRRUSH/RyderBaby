/** DSH pet-bridge 事件契约（与 DSH 插件侧对齐） */

export type PetEvent =
  | UsageEvent
  | AgentStatusEvent
  | AgentErrorEvent
  | TaskEndEvent
  | GoalEvent
  | CmdEvent
  | SnapshotEvent

export interface UsageEvent {
  type: 'usage'
  seq: number
  ts: number
  sessionId: string
  model: string
  provider: string
  usage: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
  }
  totalTokens: number
  /** 事件来源：dsh / claude-code / codex / … */
  source?: string
}

export interface AgentStatusEvent {
  type: 'agent-status'
  seq: number
  ts: number
  agentId: string
  state: 'running' | 'idle'
  source?: string
}

export interface AgentErrorEvent {
  type: 'agent-error'
  seq: number
  ts: number
  agentId: string
  message: string
  turn?: number
  source?: string
}

export interface TaskEndEvent {
  type: 'task-end'
  seq: number
  ts: number
  kind: 'subagent' | 'workflow' | 'job' | 'goal' | 'agent-session' | 'turn'
  runId?: string
  jobId?: string
  agentId?: string
  sessionId?: string
  label?: string
  meta?: { name?: string; description?: string }
  result: string
  detail?: string
  agentsStarted?: number
  ownerSession?: string
  startedAt?: number
  endedAt?: number
  /** 回合号（kind=turn 时） */
  turn?: number
  /** 该回合/任务的 token 累计 */
  tokens?: number
  /** 该回合的 usage 明细（本回合增量，按三档价格拆分花费用） */
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /** 会话标题（对话名称，如"电脑桌宠监控与题型构思"） */
  sessionTitle?: string
  /** 事件来源：dsh / claude-code / codex / … */
  source?: string
}

export interface GoalEvent {
  type: 'goal'
  seq: number
  ts: number
  action: string
  sessionId?: string
  source?: string
}

export interface CmdEvent {
  type: 'cmd'
  seq: number
  ts: number
  cmd: unknown
  source?: string
}

export interface SnapshotEvent {
  type: 'snapshot'
  seq: number
  ts: number
  totals: TokenTotals
  byModel: Record<string, { input: number; output: number; calls: number }>
  bySession: Record<string, { input: number; output: number; calls: number }>
  agents: Record<string, { state: string; lastSeen: number }>
  recent: PetEvent[]
  source?: string
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  calls: number
}

/** 连接状态机 */
export type ConnectionState = 'connected' | 'reconnecting' | 'offline'

/** 桌宠情绪（渲染层用） */
export type PetMood =
  | 'idle'
  | 'working'
  | 'happy'
  | 'worried'
  | 'panicked'
  | 'offline'
