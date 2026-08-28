/** 轻量 i18n：中英词典 + 语言切换（zh / en） */

export type Lang = 'zh' | 'en'

const dict = {
  zh: {
    // 设置界面
    settingsTitle: 'RyderBaby 设置',
    tbMinimize: '最小化',
    tbClose: '关闭',
    navGeneral: '常规',
    navReminders: '提醒',
    navPush: '推送渠道',
    navAppearance: '外观',
    navExternal: '外部工具',
    navAbout: '关于',
    // 常规
    secGeneral: '常规',
    langLabel: '界面语言',
    dshUrlLabel: 'DSH 地址',
    dshUrlHint: '改动后会自动重连数据流。',
    secPricing: '价格设置（每 1M tokens，元）',
    pricingHint: '按实际计价规则估算花费：缓存命中输入 / 未命中输入 / 输出。参考 DeepSeek 价，可改。',
    priceCacheHit: '输入（缓存命中）',
    priceInput: '输入（未命中）',
    priceOutput: '输出',
    // 提醒
    secReminders: '提醒',
    strongTaskEnd: '任务结束后强提醒（声音 + 动画）',
    strongFailure: '任务失败强提醒',
    dailyBudget: '每日 token 预算（0 = 不限制）',
    notifyCommandSuccess: '命令完成提醒（npm 等命令执行完）',
    notifyCommandFailure: '命令失败提醒',
    secCommands: '命令级提醒',
    commandsHint: '命令（npm、脚本等后台 job）默认不推送，可单独开启。',
    // Agent
    navAgents: 'Agent',
    secAgents: 'Agent 监控',
    agentsHint: '检测当前可监控的 AI Agent，可分别控制监控与推送。',
    watchAgent: '监控',
    pushAgent: '推送',
    agentDetected: '已检测',
    agentNotDetected: '未检测到',
    agentActive: '活跃中',
    agentIdle: '空闲',
    // 统计
    navStats: '统计',
    statsByDay: '按天',
    statsByHour: '按小时',
    statsDays: '天',
    statsTotalTokens: '累计 Token',
    statsCalls: '调用次数',
    statsTasks: '任务数',
    statsCost: '估算花费',
    statsBySession: '按会话',
    statsNoSession: '暂无会话数据',
    // 推送
    secPush: '推送渠道',
    pushHint: '渠道开启后，L2 级提醒（任务失败/断线/token 预警）会同步推送到对应平台。',
    enableChannel: '启用',
    dingtalkWebhook: 'Webhook URL（钉钉群 → 智能群助手 → 添加自定义机器人）',
    dingtalkSecret: '加签密钥（安全设置里的 Secret，未启用加签则留空）',
    notConfigured: '未配置',
    enabled: '已启用',
    sendTest: '发送测试推送',
    sending: '发送中…',
    testOk: '成功',
    testFail: '失败',
    // 外观
    secAppearance: '外观',
    customIcons: '自定义图标（每个状态可填 emoji 或图片路径）',
    idleText: '空闲状态文字（留空用默认）',
    iconHint: '每个状态可自定义图标（emoji 或图片路径）与状态文字，留空用默认。',
    moodIcon: '图标（emoji 或图片路径）',
    moodText: '状态文字（留空用默认）',
    resetIcons: '恢复默认图标',
    // 外部工具
    secExternal: '外部工具监视',
    extHint: '监听其他 AI 编程工具的本地日志，统一汇入提醒与统计。',
    extClaude: 'Claude Code（~/.claude/projects/*.jsonl）',
    extCodex: 'OpenAI Codex（~/.codex/sessions/*/rollout.jsonl）',
    extWatch: '启用监控',
    // 关于
    secAbout: '关于',
    aboutText: 'RyderBaby —— 程序员桌面宠物。监控 AI 编码的 token 消耗与任务状态，把运维信息变成一只趴在屏幕角落的伙伴。',
    version: '版本',
    // 保存
    saving: '保存中…',
    saved: '✓ 已保存',
    loading: '加载中…',
    // 桌宠 HUD
    connected: '已连接',
    reconnecting: '重连中…',
    offline: '离线',
    today: '今日',
    idleDefault: '盯着的呢…',
    workingText: '干活中…',
    happyText: '任务完成！',
    worriedText: '出问题了…',
    panickedText: '烧钱太快了！',
    offlineText: 'DSH 断线了',
    sleepingText: 'Zzz…'
  },
  en: {
    settingsTitle: 'RyderBaby Settings',
    tbMinimize: 'Minimize',
    tbClose: 'Close',
    navGeneral: 'General',
    navReminders: 'Reminders',
    navPush: 'Push Channels',
    navAppearance: 'Appearance',
    navExternal: 'External Tools',
    navAbout: 'About',
    secGeneral: 'General',
    langLabel: 'Language',
    dshUrlLabel: 'DSH URL',
    dshUrlHint: 'The data stream will reconnect automatically.',
    secPricing: 'Pricing (per 1M tokens, CNY)',
    pricingHint: 'Estimate cost by billing rules: cached input / uncached input / output. DeepSeek reference prices, editable.',
    priceCacheHit: 'Input (cache hit)',
    priceInput: 'Input (no cache)',
    priceOutput: 'Output',
    secReminders: 'Reminders',
    strongTaskEnd: 'Strong reminder on task end (sound + animation)',
    strongFailure: 'Strong reminder on task failure',
    dailyBudget: 'Daily token budget (0 = unlimited)',
    notifyCommandSuccess: 'Notify on command success (npm etc.)',
    notifyCommandFailure: 'Notify on command failure',
    secCommands: 'Command-level reminders',
    commandsHint: 'Commands (npm, scripts, background jobs) are silent by default; enable per type.',
    // Agent
    navAgents: 'Agents',
    secAgents: 'Agent Monitoring',
    agentsHint: 'Detected AI agents, control watch & push per agent.',
    watchAgent: 'Watch',
    pushAgent: 'Push',
    agentDetected: 'Detected',
    agentNotDetected: 'Not detected',
    agentActive: 'Active',
    agentIdle: 'Idle',
    // 统计
    navStats: 'Stats',
    statsByDay: 'By day',
    statsByHour: 'By hour',
    statsDays: 'days',
    statsTotalTokens: 'Total tokens',
    statsCalls: 'Calls',
    statsTasks: 'Tasks',
    statsCost: 'Est. cost',
    statsBySession: 'By session',
    statsNoSession: 'No session data',
    secPush: 'Push Channels',
    pushHint: 'When enabled, L2 reminders (failure/disconnect/budget) are pushed to the platform.',
    enableChannel: 'Enabled',
    dingtalkWebhook: 'Webhook URL (DingTalk group → Smart Assistant → Custom Bot)',
    dingtalkSecret: 'Signing secret (from bot security settings; leave empty if unsigned)',
    notConfigured: 'Not configured',
    enabled: 'Enabled',
    sendTest: 'Send test push',
    sending: 'Sending…',
    testOk: 'OK',
    testFail: 'Failed',
    secAppearance: 'Appearance',
    customIcons: 'Custom icons (emoji or image path per state)',
    idleText: 'Idle state text (empty = default)',
    iconHint: 'Customize icon (emoji or image path) and status text per state; empty = default.',
    moodIcon: 'Icon (emoji or image path)',
    moodText: 'Status text (empty = default)',
    resetIcons: 'Reset icons',
    secExternal: 'External Tool Monitoring',
    extHint: 'Watch other AI coding tools\' local logs, unified into reminders & stats.',
    extClaude: 'Claude Code (~/.claude/projects/*.jsonl)',
    extCodex: 'OpenAI Codex (~/.codex/sessions/*/rollout.jsonl)',
    extWatch: 'Enable watch',
    secAbout: 'About',
    aboutText: 'RyderBaby — a desktop pet for programmers. Monitors token usage and task state of AI coding, turning ops info into a companion lounging at the corner of your screen.',
    version: 'Version',
    saving: 'Saving…',
    saved: '✓ Saved',
    loading: 'Loading…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
    today: 'today',
    idleDefault: 'Watching…',
    workingText: 'Working…',
    happyText: 'Task done!',
    worriedText: 'Something went wrong…',
    panickedText: 'Burning too fast!',
    offlineText: 'DSH offline',
    sleepingText: 'Zzz…'
  }
} as const

export type I18nKey = keyof (typeof dict)['zh']

/** 简单响应式 i18n：订阅语言变化 */
export class I18n {
  private lang: Lang = 'zh'
  private listeners = new Set<() => void>()

  setLang(lang: Lang): void {
    if (this.lang === lang) return
    this.lang = lang
    for (const l of this.listeners) l()
  }

  getLang(): Lang {
    return this.lang
  }

  /** 语言变更时订阅（返回取消函数） */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  t(key: I18nKey): string {
    return dict[this.lang][key] ?? dict.zh[key]
  }
}

/** 全局单例（渲染层） */
export const i18n = new I18n()
