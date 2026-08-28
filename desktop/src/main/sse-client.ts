import { EventEmitter } from 'node:events'
import type { ConnectionState, PetEvent, SnapshotEvent } from '../shared/types'

export interface SseClientOptions {
  /** SSE 端点，如 http://127.0.0.1:63726/pet/events */
  url: string
  /** 初始重连延迟 ms */
  initialDelayMs?: number
  /** 最大重连延迟 ms */
  maxDelayMs?: number
  /** 心跳超时：超过该时长未收到任何数据视为断线 */
  heartbeatTimeoutMs?: number
}

/**
 * 极简 SSE 客户端（Node 原生，无第三方依赖）：
 * - 连接即收 snapshot
 * - 断线指数退避重连
 * - 心跳超时检测
 * - 状态机 connected / reconnecting / offline
 */
export class SseClient extends EventEmitter {
  private readonly options: Required<SseClientOptions>
  private aborted = false
  private retryCount = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private currentState: ConnectionState = 'offline'

  constructor(options: SseClientOptions) {
    super()
    this.options = {
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      heartbeatTimeoutMs: 15000,
      ...options
    }
  }

  get state(): ConnectionState {
    return this.currentState
  }

  get url(): string {
    return this.options.url
  }

  start(): void {
    this.aborted = false
    this.connect()
  }

  stop(): void {
    this.aborted = true
    this.clearTimers()
    this.setState('offline')
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return
    this.currentState = state
    this.emit('state', state)
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private connect(): void {
    if (this.aborted) return
    if (this.retryCount > 0) {
      this.setState('reconnecting')
    }
    this.armHeartbeat()

    let controller: AbortController | null = null
    const run = async (): Promise<void> => {
      try {
        controller = new AbortController()
        const timeout = setTimeout(() => controller?.abort(), 30000)
        const res = await fetch(this.options.url, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' }
        })
        clearTimeout(timeout)
        if (!res.ok || !res.body) {
          throw new Error(`SSE HTTP ${res.status}`)
        }
        // 连接成功：重置重连计数，宣布在线
        this.retryCount = 0
        this.setState('connected')
        this.emit('open')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          this.armHeartbeat() // 任何数据都算心跳
          buffer += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const rawEvent = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            this.dispatch(rawEvent)
          }
        }
        // 流正常结束（服务器关闭）
        throw new Error('SSE stream closed')
      } catch (err) {
        if (this.aborted) return
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
        this.scheduleReconnect()
      }
    }
    void run()
  }

  /** 解析单条 SSE 消息（只关心 data: 行） */
  private dispatch(raw: string): void {
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) return
    const data = dataLines.join('\n')
    try {
      const event = JSON.parse(data) as PetEvent | SnapshotEvent
      this.emit('event', event)
    } catch {
      // 非 JSON 数据忽略
    }
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = setTimeout(() => {
      // 心跳超时：认为连接已死，主动断开触发重连
      this.emit('error', new Error('heartbeat timeout'))
      this.scheduleReconnect()
    }, this.options.heartbeatTimeoutMs)
  }

  private scheduleReconnect(): void {
    if (this.aborted) return
    this.clearTimers()
    const delay = Math.min(
      this.options.initialDelayMs * 2 ** this.retryCount,
      this.options.maxDelayMs
    )
    this.retryCount += 1
    this.setState(this.retryCount >= 5 ? 'offline' : 'reconnecting')
    this.emit('reconnecting', { attempt: this.retryCount, delayMs: delay })
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }
}
