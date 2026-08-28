import { createHmac } from 'node:crypto'
import type { Reminder } from './notifier'

/** 推送结果 */
export interface PushResult {
  ok: boolean
  channel: string
  error?: string
}

/**
 * 推送渠道接口：一个渠道 = 一种把提醒送到手机/群的方式。
 * 后续新增渠道（飞书/企微/公众号/自定义 webhook）都实现这个接口，
 * 注册进 PushRouter 即可，Notifier 侧零改动。
 */
export interface PushChannel {
  readonly id: string
  readonly label: string
  /** 渠道是否已配置（有可用的 webhook/凭据） */
  isConfigured(): boolean
  /** 是否启用（设置开关） */
  isEnabled(): boolean
  /** 发送一条提醒 */
  send(reminder: Reminder): Promise<PushResult>
  /** 发送测试消息（设置页"测试推送"按钮） */
  test(): Promise<PushResult>
}

/** 钉钉群机器人自定义机器人渠道 */
export class DingTalkChannel implements PushChannel {
  readonly id = 'dingtalk'
  readonly label = '钉钉群机器人'

  constructor(
    private readonly getConfig: () => { enabled: boolean; webhook: string; secret: string }
  ) {}

  isConfigured(): boolean {
    const c = this.getConfig()
    return c.webhook.trim().length > 0 && c.webhook.startsWith('http')
  }

  isEnabled(): boolean {
    return this.getConfig().enabled
  }

  private buildUrl(): string {
    const c = this.getConfig()
    const url = new URL(c.webhook.trim())
    if (c.secret.trim()) {
      // 加签模式：timestamp + sign 参数
      const timestamp = Date.now()
      const stringToSign = `${timestamp}\n${c.secret.trim()}`
      const sign = createHmac('sha256', c.secret.trim())
        .update(stringToSign, 'utf-8')
        .digest('base64')
      url.searchParams.set('timestamp', String(timestamp))
      url.searchParams.set('sign', encodeURIComponent(sign))
    }
    return url.toString()
  }

  async send(reminder: Reminder): Promise<PushResult> {
    if (!this.isConfigured()) {
      return { ok: false, channel: this.id, error: 'webhook 未配置' }
    }
    try {
      const body = {
        msgtype: 'markdown',
        markdown: {
          title: reminder.title.slice(0, 60),
          // 卡片内容：标题 + 正文（多行保留为 markdown）
          text: `### ${reminder.title}\n\n${reminder.body}`
        }
      }
      const res = await fetch(this.buildUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = (await res.json()) as { errcode?: number; errmsg?: string }
      if (res.ok && data.errcode === 0) {
        return { ok: true, channel: this.id }
      }
      return {
        ok: false,
        channel: this.id,
        error: `钉钉返回 errcode=${data.errcode ?? res.status} ${data.errmsg ?? ''}`
      }
    } catch (err) {
      return { ok: false, channel: this.id, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async test(): Promise<PushResult> {
    return this.send({
      level: 'L2',
      title: 'RyderBaby 测试推送 ✅',
      body: '这是一条来自桌宠的测试消息。如果你在手机上/群里看到它，说明钉钉通道配置成功！',
      mood: 'happy'
    })
  }
}

/** 推送路由器：把所有启用的渠道各发一遍（后续加渠道即在此注册） */
export class PushRouter {
  private readonly channels: PushChannel[]

  constructor(channels: PushChannel[]) {
    this.channels = channels
  }

  list(): Array<{ id: string; label: string; enabled: boolean; configured: boolean }> {
    return this.channels.map((c) => ({
      id: c.id,
      label: c.label,
      enabled: c.isEnabled(),
      configured: c.isConfigured()
    }))
  }

  async broadcast(reminder: Reminder): Promise<PushResult[]> {
    const results: PushResult[] = []
    for (const channel of this.channels) {
      if (!channel.isEnabled() || !channel.isConfigured()) continue
      results.push(await channel.send(reminder))
    }
    return results
  }

  async testAll(): Promise<PushResult[]> {
    const results: PushResult[] = []
    for (const channel of this.channels) {
      if (!channel.isEnabled() || !channel.isConfigured()) continue
      results.push(await channel.test())
    }
    return results
  }
}
