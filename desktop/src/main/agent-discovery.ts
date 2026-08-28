import { existsSync, readdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { homedir } from 'node:os'

export interface AgentInfo {
  id: string
  name: string
  /** 是否检测到（DSH 连接 / 日志目录存在且有内容） */
  detected: boolean
  /** 是否有活跃活动（最近有事件） */
  active: boolean
  /** 最近活跃时间戳 */
  lastActiveTs?: number
  detail: string
}

/**
 * Agent 发现：检测当前环境可监控的 agent。
 * - dsh: SSE 连接状态
 * - claude-code: ~/.claude/projects 存在且非空
 * - codex: ~/.codex/sessions 存在且非空
 */
export class AgentDiscovery {
  private lastActivity = new Map<string, number>()

  constructor(
    private readonly getDshConnected: () => boolean,
    private readonly getDshActive: () => boolean
  ) {}

  markActivity(id: string): void {
    this.lastActivity.set(id, Date.now())
  }

  list(): AgentInfo[] {
    const now = Date.now()
    return [
      {
        id: 'dsh',
        name: 'DeepSeek Harness',
        detected: this.getDshConnected(),
        active: this.getDshActive(),
        lastActiveTs: this.lastActivity.get('dsh'),
        detail: this.getDshConnected() ? 'SSE 已连接' : '未连接'
      },
      {
        id: 'claude-code',
        name: 'Claude Code',
        detected: hasJsonl(join(homedir(), '.claude', 'projects')),
        active: this.isRecentlyActive('claude-code'),
        lastActiveTs: this.lastActivity.get('claude-code'),
        detail: hasJsonl(join(homedir(), '.claude', 'projects')) ? '检测到会话日志' : '未检测到日志'
      },
      {
        id: 'codex',
        name: 'OpenAI Codex',
        detected: hasJsonl(join(homedir(), '.codex', 'sessions')),
        active: this.isRecentlyActive('codex'),
        lastActiveTs: this.lastActivity.get('codex'),
        detail: hasJsonl(join(homedir(), '.codex', 'sessions')) ? '检测到会话日志' : '未检测到日志'
      }
    ]
  }

  private isRecentlyActive(id: string): boolean {
    const ts = this.lastActivity.get(id)
    return ts !== undefined && Date.now() - ts < 5 * 60_000
  }
}

function hasJsonl(root: string): boolean {
  if (!existsSync(root)) return false
  try {
    return readdirSync(root, { recursive: true }).some((e) => extname(String(e)) === '.jsonl')
  } catch {
    return false
  }
}
