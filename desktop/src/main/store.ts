import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PetEvent, SnapshotEvent, TokenTotals } from '../shared/types'

/**
 * 事件存储抽象层：P1 用 JSON 文件落盘（零原生依赖，跨平台打包零障碍），
 * 接口按 SQLite 能力设计，数据量上来后换 better-sqlite3 实现无痛。
 */
export interface EventStore {
  /** 追加一条事件（内存 + 落盘） */
  append(event: PetEvent | SnapshotEvent): void
  /** 按时间范围查询事件 */
  query(fromTs?: number, toTs?: number, limit?: number): PetEvent[]
  /** 会话级聚合：token 总量 / 任务统计 / 会话摘要 */
  aggregate(): AggregateView
  /** 今日累计 token（自然日） */
  todayTokens(): TokenTotals
  /** 按时间桶聚合 token 消耗（曲线图数据） */
  tokenHistory(bucket: 'hour' | 'day', days: number): Array<{ ts: number; label: string; total: number; input: number; output: number; cacheRead: number }>
}

export interface AggregateView {
  totals: TokenTotals
  taskCount: number
  failCount: number
  byModel: Record<string, { input: number; output: number; calls: number }>
  sessions: Record<string, SessionAggregate>
}

/** 时间桶标签（本地时区） */
function fmtBucketLabel(ts: number, bucket: 'hour' | 'day'): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (bucket === 'hour') {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface SessionAggregate {
  id: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  calls: number
  taskOk: number
  taskFail: number
  firstSeen: number
  lastSeen: number
}

const MAX_EVENTS_ON_DISK = 20000

export class JsonEventStore implements EventStore {
  private events: PetEvent[] = []
  private totals: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
  private byModel: Record<string, { input: number; output: number; calls: number }> = {}
  private sessions: Record<string, SessionAggregate> = {}
  private taskOk = 0
  private taskFail = 0
  private filePath: string

  constructor(fileName = 'pet-events.json') {
    this.filePath = join(app.getPath('userData'), fileName)
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (Array.isArray(raw.events)) this.events = raw.events
      // totals/byModel/sessions 不从磁盘信任：插件重启会带零值 snapshot 覆盖，
      // 唯一可靠来源是事件表本身，每次启动全量重算。
      this.rebuildAggregates()
      if (raw.taskOk && typeof raw.taskOk === 'number' && this.events.length === 0) {
        this.taskOk = raw.taskOk
        this.taskFail = raw.taskFail ?? 0
      }
    } catch (err) {
      console.error('[store] load failed, starting fresh', err)
    }
  }

  /** 从事件表全量重算 totals / byModel / sessions / task 计数 */
  private rebuildAggregates(): void {
    this.totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
    this.byModel = {}
    this.sessions = {}
    this.taskOk = 0
    this.taskFail = 0
    for (const e of this.events) {
      this.accumulate(e)
    }
  }

  private persist(): void {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(
        this.filePath,
        JSON.stringify({
          events: this.events.slice(-MAX_EVENTS_ON_DISK),
          totals: this.totals,
          byModel: this.byModel,
          sessions: this.sessions,
          taskOk: this.taskOk,
          taskFail: this.taskFail
        }),
        'utf-8'
      )
    } catch (err) {
      console.error('[store] persist failed', err)
    }
  }

  append(event: PetEvent | SnapshotEvent): void {
    // snapshot 不是普通事件：携带插件进程内的 recent 窗口与进程内 totals。
    // 桌宠本地才是永久累计的权威（插件可能重启清零），所以：
    // 1) totals 不覆盖本地累计（除非本地完全没有数据）
    // 2) recent 按 seq 去重补录，弥合断线期间丢失的事件
    if (event.type === 'snapshot') {
      if (this.events.length === 0 && event.totals) {
        this.totals = event.totals
      }
      if (Array.isArray(event.recent)) {
        const known = new Set(this.events.map((e) => e.seq))
        for (const e of event.recent) {
          if (e && typeof e.seq === 'number' && !known.has(e.seq)) {
            this.events.push(e as PetEvent)
            known.add(e.seq)
            this.accumulate(e as PetEvent)
          }
        }
        if (event.recent.length > 0) {
          this.events.sort((a, b) => a.seq - b.seq)
        }
      }
      this.persist()
      return
    }
    this.events.push(event as PetEvent)
    this.accumulate(event as PetEvent)
    this.persist()
  }

  private accumulate(event: PetEvent): void {
    const ts = event.ts ?? Date.now()
    if (event.type === 'usage') {
      const u = event.usage
      this.totals.input += u.input
      this.totals.output += u.output
      this.totals.cacheRead += u.cacheRead
      this.totals.cacheWrite += u.cacheWrite
      this.totals.reasoning += u.reasoning
      this.totals.calls += 1
      const m = (this.byModel[event.model] ??= { input: 0, output: 0, calls: 0 })
      m.input += u.input
      m.output += u.output
      m.calls += 1
      const s = (this.sessions[event.sessionId] ??= {
        id: event.sessionId,
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        calls: 0, taskOk: 0, taskFail: 0, firstSeen: ts, lastSeen: ts
      })
      s.input += u.input
      s.output += u.output
      s.cacheRead += u.cacheRead
      s.cacheWrite += u.cacheWrite
      s.calls += 1
      s.lastSeen = ts
    } else if (event.type === 'task-end') {
      const ok = event.result === 'ok' || event.result === 'completed' || event.result === 'success'
      if (ok) this.taskOk += 1
      else this.taskFail += 1
      if (event.agentId) {
        const s = (this.sessions[event.agentId] ??= {
          id: event.agentId,
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
          calls: 0, taskOk: 0, taskFail: 0, firstSeen: ts, lastSeen: ts
        })
        if (ok) s.taskOk += 1
        else s.taskFail += 1
        s.lastSeen = ts
      }
    }
  }

  query(fromTs?: number, toTs?: number, limit = 500): PetEvent[] {
    let list = this.events
    if (fromTs !== undefined) list = list.filter((e) => e.ts >= fromTs)
    if (toTs !== undefined) list = list.filter((e) => e.ts <= toTs)
    return list.slice(-limit)
  }

  aggregate(): AggregateView {
    return {
      totals: { ...this.totals },
      taskCount: this.taskOk + this.taskFail,
      failCount: this.taskFail,
      byModel: JSON.parse(JSON.stringify(this.byModel)),
      sessions: JSON.parse(JSON.stringify(this.sessions))
    }
  }

  todayTokens(): TokenTotals {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const t: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, calls: 0 }
    for (const e of this.events) {
      if (e.type === 'usage' && e.ts >= start.getTime()) {
        t.input += e.usage.input
        t.output += e.usage.output
        t.cacheRead += e.usage.cacheRead
        t.cacheWrite += e.usage.cacheWrite
        t.reasoning += e.usage.reasoning
        t.calls += 1
      }
    }
    return t
  }

  /** 按时间桶聚合 token 消耗（曲线图数据） */
  tokenHistory(bucket: 'hour' | 'day', days: number): Array<{ ts: number; label: string; total: number; input: number; output: number; cacheRead: number }> {
    const now = Date.now()
    const start = now - days * 24 * 3600 * 1000
    const buckets = new Map<number, { total: number; input: number; output: number; cacheRead: number }>()
    const bucketSize = bucket === 'hour' ? 3600_000 : 24 * 3600_000

    for (const e of this.events) {
      if (e.type !== 'usage' || e.ts < start) continue
      const b = Math.floor(e.ts / bucketSize) * bucketSize
      const cur = buckets.get(b) ?? { total: 0, input: 0, output: 0, cacheRead: 0 }
      cur.total += e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite
      cur.input += e.usage.input
      cur.output += e.usage.output
      cur.cacheRead += e.usage.cacheRead
      buckets.set(b, cur)
    }

    const out: Array<{ ts: number; label: string; total: number; input: number; output: number; cacheRead: number }> = []
    const count = days * (bucket === 'hour' ? 24 : 1)
    for (let i = count - 1; i >= 0; i--) {
      const ts = Math.floor(start / bucketSize) * bucketSize + i * bucketSize
      const d = buckets.get(ts)
      out.push({
        ts,
        label: bucket === 'hour' ? fmtBucketLabel(ts, 'hour') : fmtBucketLabel(ts, 'day'),
        total: d?.total ?? 0,
        input: d?.input ?? 0,
        output: d?.output ?? 0,
        cacheRead: d?.cacheRead ?? 0
      })
    }
    return out
  }
}
