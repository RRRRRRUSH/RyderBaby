import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/settings'

/**
 * 极简 JSON 设置存储（零依赖，避免 electron-store ESM 在 CJS 主进程的坑）。
 * 与 EventStore 同为存储抽象层的一部分，接口简单，后续可换 better-sqlite3。
 */
export class SettingsStore {
  private settings: AppSettings
  private readonly filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), 'settings.json')
    this.settings = this.load()
  }

  get(): AppSettings {
    // 返回副本，防止调用方直接改内部状态；缺失的可选嵌套对象补默认空值
    const out: AppSettings = JSON.parse(JSON.stringify(this.settings))
    out.appearance.petIcons ??= {}
    out.appearance.moodTexts ??= {}
    out.appearance.idleText ??= ''
    return out
  }

  /** 深合并部分更新并落盘 */
  update(patch: Partial<AppSettings>): AppSettings {
    this.settings = deepMerge(this.settings, patch)
    this.persist()
    return this.get()
  }

  private load(): AppSettings {
    try {
      if (!existsSync(this.filePath)) return structuredClone(DEFAULT_SETTINGS)
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      return deepMerge(structuredClone(DEFAULT_SETTINGS), raw)
    } catch (err) {
      console.error('[settings] load failed, using defaults', err)
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  private persist(): void {
    try {
      const dir = app.getPath('userData')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[settings] persist failed', err)
    }
  }
}

/** 递归深合并：src 覆盖 dst，对象按 key 合并，其余类型直接替换 */
function deepMerge<T>(dst: T, src: Partial<T>): T {
  if (typeof dst !== 'object' || dst === null || Array.isArray(dst)) {
    return (src === undefined ? dst : src) as T
  }
  const out: Record<string, unknown> = { ...(dst as Record<string, unknown>) }
  for (const key of Object.keys(src as Record<string, unknown>)) {
    const sv = (src as Record<string, unknown>)[key]
    if (sv === undefined) continue
    // null = 显式删除该键（用于清空嵌套对象如 petIcons）
    if (sv === null) {
      delete out[key]
      continue
    }
    const dv = out[key]
    if (typeof dv === 'object' && dv !== null && !Array.isArray(dv) && typeof sv === 'object' && sv !== null && !Array.isArray(sv)) {
      out[key] = deepMerge(dv, sv as Partial<typeof dv>)
    } else {
      out[key] = sv
    }
  }
  return out as T
}
