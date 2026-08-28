/**
 * 用 Web Audio API 合成提示音（零素材依赖，跨平台）。
 * - 成功音：两个上行音符（欢快）
 * - 失败音：两个下行音符（低沉）
 */

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  volume = 0.18,
  type: OscillatorType = 'sine'
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(volume, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.05)
}

/** 任务成功：C5 → E5 欢快上行 */
export function playSuccessSound(): void {
  const ctx = getCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  tone(ctx, 523.25, t, 0.18)
  tone(ctx, 659.25, t + 0.14, 0.22)
  tone(ctx, 783.99, t + 0.28, 0.3)
}

/** 任务失败：A4 → F4 低沉下行 */
export function playFailureSound(): void {
  const ctx = getCtx()
  if (!ctx) return
  const t = ctx.currentTime + 0.02
  tone(ctx, 440, t, 0.3, 0.16, 'triangle')
  tone(ctx, 349.23, t + 0.22, 0.42, 0.16, 'triangle')
}
