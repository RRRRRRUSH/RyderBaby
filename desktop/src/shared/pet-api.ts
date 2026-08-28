/** 渲染层可见的 window.pet 接口（与 preload/index.ts 的 api 对象保持一致） */
export interface PetApiShape {
  getState(): Promise<unknown>
  getSettings(): Promise<unknown>
  setSettings(patch: unknown): Promise<{ ok: boolean; settings?: unknown; error?: string }>
  testPush(): Promise<{ results: Array<{ ok: boolean; channel: string; error?: string }> }>
  listChannels(): Promise<Array<{ id: string; label: string; enabled: boolean; configured: boolean }>>
  listAgents(): Promise<Array<{ id: string; name: string; detected: boolean; active: boolean; detail: string }>>
  getTokenHistory(opts?: { bucket?: 'hour' | 'day'; days?: number }): Promise<
    Array<{ ts: number; label: string; total: number; input: number; output: number; cacheRead: number }>
  >
  setMuted(muted: boolean): Promise<{ ok: boolean }>
  setPaused(paused: boolean): Promise<{ ok: boolean }>
  quit(): Promise<{ ok: boolean }>
  onEvent(channel: string, cb: (payload: unknown) => void): () => void
}
