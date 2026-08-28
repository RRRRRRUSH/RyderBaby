import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import { readFileSync, statSync } from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { homedir } from 'node:os'
import type { PetEvent } from '../shared/types'

/** 外部工具监视器的统一输出事件 */
export interface ExternalWatchEvent {
  /** 统一为 PetEvent 形态，直接汇入现有 store/notifier 链路 */
  event: PetEvent
  /** 来源工具标识：claude-code / codex / … */
  source: string
}

export interface ExternalWatcherOptions {
  /** 是否监控 Claude Code */
  watchClaude?: boolean
  /** 是否监控 Codex */
  watchCodex?: boolean
  /** 扫描间隔 ms（目录结构可能不触发 fs.watch，做轮询兜底） */
  pollIntervalMs?: number
  /** 自定义数据根目录（测试用） */
  claudeRoot?: string
  codexRoot?: string
}

interface FileCursor {
  /** 已读字节偏移 */
  offset: number
}

/**
 * 外部工具监视器：
 * - Claude Code: ~/.claude/projects 下所有 jsonl（Anthropic 结构，message.usage）
 * - Codex: ~/.codex/sessions/&lt;id&gt;/rollout.jsonl（OpenAI 结构，payload.usage）
 * 宽容解析两种 usage 结构，增量读取（append-only jsonl 天然适合），
 * 统一产出 PetEvent 汇入现有提醒/推送/存储链路。
 */
export class ExternalWatcher extends EventEmitter {
  private readonly options: Required<ExternalWatcherOptions>
  private cursors = new Map<string, FileCursor>()
  private watchers: FSWatcher[] = []
  private pollTimer: NodeJS.Timeout | null = null
  private knownFiles = new Set<string>()
  private started = false

  constructor(options: ExternalWatcherOptions = {}) {
    super()
    this.options = {
      watchClaude: true,
      watchCodex: true,
      pollIntervalMs: 5000,
      claudeRoot: join(homedir(), '.claude', 'projects'),
      codexRoot: join(homedir(), '.codex', 'sessions'),
      ...options
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.scan()
    // fs.watch 对深层新目录不可靠，轮询兜底
    this.pollTimer = setInterval(() => this.scan(), this.options.pollIntervalMs)
  }

  stop(): void {
    this.started = false
    if (this.pollTimer) clearInterval(this.pollTimer)
    for (const w of this.watchers) w.close()
    this.watchers = []
  }

  private scan(): void {
    if (this.options.watchClaude) this.scanRoot(this.options.claudeRoot, '.jsonl', 'claude-code')
    if (this.options.watchCodex) this.scanRoot(this.options.codexRoot, '.jsonl', 'codex')
  }

  private scanRoot(root: string, ext: string, source: string): void {
    let files: string[] = []
    try {
      files = collectJsonl(root, ext)
    } catch {
      return // 目录不存在等，静默
    }
    for (const file of files) {
      if (!this.knownFiles.has(file)) {
        this.knownFiles.add(file)
        try {
          const w = watch(file, () => this.ingest(file, source))
          this.watchers.push(w)
        } catch {
          // 文件可能刚被删，忽略
        }
      }
      // 每次 scan 都 ingest 已知文件：fs.watch 在部分平台不可靠，
      // 靠 offset 去重实现幂等，轮询天然兜底
      this.ingest(file, source)
    }
    // 清理已消失文件的 watcher（惰性：交给下次 scan 自然跳过）
  }

  private ingest(file: string, source: string): void {
    let cursor = this.cursors.get(file)
    if (!cursor) {
      cursor = { offset: 0 }
      this.cursors.set(file, cursor)
    }
    let content: string
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      return
    }
    const total = content.length
    // 文件变短（被截断/轮转/替换）时重置游标，从头解析
    if (total < cursor.offset) {
      cursor.offset = 0
    }
    if (total <= cursor.offset) return
    if (process.env.PET_EXT_DEBUG) console.log(`[ext-debug] ingest ${basename(file)} offset=${cursor.offset} total=${total}`)
    const slice = content.slice(cursor.offset)
    // 处理所有行（含无结尾换行的最后一行）；某行解析失败说明写入中
    // 读到半行 → 回退 offset 到该行起点，下轮重试（不丢数据）
    let pos = cursor.offset
    for (const line of slice.split('\n')) {
      if (!line.trim()) {
        pos += line.length + 1
        continue
      }
      const lineStart = pos
      pos += line.length + 1
      const ok = this.parseLine(line, source, file)
      if (!ok) {
        cursor.offset = lineStart
        return
      }
    }
    cursor.offset = total
  }

  /** 返回 false 表示 JSON 解析失败（可能写入中） */
  private parseLine(line: string, source: string, file: string): boolean {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      return false
    }
    if (!obj || typeof obj !== 'object') return true

    if (source === 'claude-code') {
      this.parseClaudeLine(obj, file)
    } else if (source === 'codex') {
      this.parseCodexLine(obj, file)
    }
    return true
  }

  // ---------- Claude Code（Anthropic 结构） ----------
  private parseClaudeLine(obj: Record<string, unknown>, file: string): void {
    const type = obj.type as string | undefined
    // usage 可能在 assistant 消息的 message.usage，或 summary/系统消息
    const usage: unknown = (obj as { message?: { usage?: unknown } }).message?.usage ?? obj.usage
    const ts = parseTs(obj.timestamp)

    if (type === 'assistant' && usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>
      const input = num(u.input_tokens ?? u.inputTokens)
      const output = num(u.output_tokens ?? u.outputTokens)
      const cacheRead = num(u.cache_read_input_tokens ?? u.cacheReadTokens)
      if (input > 0 || output > 0) {
        this.emitEvent({
          type: 'usage',
          seq: 0,
          ts: ts ?? Date.now(),
          sessionId: `claude:${basename(file).replace(/\.jsonl$/, '')}`,
          model: (obj.model as string) ?? 'claude',
          provider: 'claude-code',
          usage: { input, output, cacheRead, cacheWrite: 0, reasoning: 0 },
          totalTokens: input + output + cacheRead
        }, 'claude-code')
      }
    } else if (type === 'summary') {
      // 会话结束（summary 行通常是最后一行）
      const result = (obj as { is_error?: boolean }).is_error ? 'failed' : 'completed'
      this.emitEvent({
        type: 'task-end',
        seq: 0,
        ts: ts ?? Date.now(),
        kind: 'agent-session',
        label: basename(file).replace(/\.jsonl$/, ''),
        result,
        source: 'claude-code'
      } as PetEvent, 'claude-code')
    }
  }

  // ---------- Codex（OpenAI 结构） ----------
  private parseCodexLine(obj: Record<string, unknown>, file: string): void {
    const ts = parseTs(obj.timestamp)
    const type = obj.type as string | undefined
    // 顶层 usage 或 response_item.payload.usage
    let usage: unknown = obj.usage
    if (!usage && type === 'response_item') {
      const payload = obj.payload as Record<string, unknown> | undefined
      usage = payload?.usage
    }
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>
      const input = num(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens)
      const output = num(u.output_tokens ?? u.outputTokens ?? u.completion_tokens)
      const cacheRead = num(u.cache_read_input_tokens ?? u.cacheReadTokens)
      if (input > 0 || output > 0) {
        this.emitEvent({
          type: 'usage',
          seq: 0,
          ts: ts ?? Date.now(),
          sessionId: `codex:${basename(file).replace(/\.jsonl$/, '')}`,
          model: (obj.model as string) ?? 'codex',
          provider: 'codex',
          usage: { input, output, cacheRead, cacheWrite: 0, reasoning: 0 },
          totalTokens: input + output + cacheRead
        }, 'codex')
      }
    }
    // 会话结束：rollout.jsonl 的 event_msg 含 "session finished" 或 item 里带 end_reason
    const payload = (obj.payload ?? obj) as Record<string, unknown> | undefined
    const endReason = (payload?.end_reason ?? payload?.stop_reason) as string | undefined
    if (type === 'event_msg' && endReason) {
      const result = endReason === 'finished' || endReason === 'stop' ? 'completed' : 'failed'
      this.emitEvent({
        type: 'task-end',
        seq: 0,
        ts: ts ?? Date.now(),
        kind: 'agent-session',
        label: basename(file).replace(/\.jsonl$/, ''),
        result,
        source: 'codex'
      } as PetEvent, 'codex')
    }
  }

  private emitEvent(event: PetEvent, source: string): void {
    this.emit('event', { event, source } satisfies ExternalWatchEvent)
  }
}

// ---------- 工具函数 ----------

function collectJsonl(root: string, ext: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && extname(e.name) === ext) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

function parseTs(ts: unknown): number | undefined {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const t = Date.parse(ts)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
