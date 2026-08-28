/** 桌宠设置（持久化到 userData/settings.json） */

export interface DingTalkChannelSettings {
  enabled: boolean
  /** 钉钉群机器人 webhook 完整 URL（含 access_token） */
  webhook: string
  /** 加签密钥（安全设置里的 secret），为空则不加签 */
  secret: string
}

/** 推送渠道配置（后续扩展：飞书/企微/公众号…都往这里加字段） */
export interface PushChannelSettings {
  dingtalk: DingTalkChannelSettings
}

export interface ReminderSettings {
  /** 任务结束后强提醒：声音 + 加强动画 */
  strongOnTaskEnd: boolean
  /** 失败/错误强提醒（默认开） */
  strongOnFailure: boolean
  /** 每日 token 预算（0 = 不限制） */
  dailyTokenBudget: number
  /** 预警档位 0-1 */
  warningLevels: number[]
}

export interface AppearanceSettings {
  /** 台词风格模板 id（预留，D4） */
  lineStyle: string
  /** 界面语言：zh / en */
  language: 'zh' | 'en'
  /** 每个情绪状态的自定义图标（emoji 或图片路径）；空 = 用内置默认 */
  petIcons: Partial<Record<PetMoodKey, string>>
  /** 空闲状态自定义文字（气泡/状态栏显示）；空 = 用内置默认 */
  idleText: string
}

export type PetMoodKey =
  | 'idle'
  | 'working'
  | 'happy'
  | 'worried'
  | 'panicked'
  | 'offline'
  | 'sleeping'

/** 每个 agent 的独立开关 */
export interface AgentWatchSettings {
  /** agent id → 是否监控 */
  watch: Record<string, boolean>
  /** agent id → 任务结束是否推送 */
  push: Record<string, boolean>
}

export interface ReminderSettings {
  /** 任务结束后强提醒：声音 + 加强动画 */
  strongOnTaskEnd: boolean
  /** 失败/错误强提醒（默认开） */
  strongOnFailure: boolean
  /** 每日 token 预算（0 = 不限制） */
  dailyTokenBudget: number
  /** 预警档位 0-1 */
  warningLevels: number[]
  /** 命令级（job）完成是否提醒（默认 false：npm 等不打扰） */
  notifyCommandSuccess: boolean
  /** 命令级（job）失败是否提醒（默认 true） */
  notifyCommandFailure: boolean
}

export interface AppSettings {
  reminders: ReminderSettings
  push: PushChannelSettings
  appearance: AppearanceSettings
  agents: AgentWatchSettings
  /** DSH 地址 */
  dshUrl: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  reminders: {
    strongOnTaskEnd: true,
    strongOnFailure: true,
    dailyTokenBudget: 1000000,
    warningLevels: [0.5, 0.8, 1.0],
    notifyCommandSuccess: false,
    notifyCommandFailure: true
  },
  push: {
    dingtalk: {
      enabled: false,
      webhook: '',
      secret: ''
    }
  },
  appearance: {
    lineStyle: 'ops',
    language: 'zh',
    petIcons: {},
    idleText: ''
  },
  agents: {
    watch: { dsh: true, 'claude-code': false, codex: false },
    push: { dsh: true, 'claude-code': false, codex: false }
  },
  dshUrl: 'http://127.0.0.1:63726'
}
