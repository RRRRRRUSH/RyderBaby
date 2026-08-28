import type { PricingSettings } from '../shared/settings'
import type { TokenTotals } from '../shared/types'

/**
 * 花费估算：按实际计价规则（每 1M tokens 价格，元）。
 * DSH 的 TokenUsage 字段天然对应：inputTokens=未命中输入、cacheReadTokens=命中输入、outputTokens=输出。
 */
export interface CostInput {
  input: number
  output: number
  cacheRead: number
}

export function calcCost(t: CostInput, pricing: PricingSettings): number {
  const hit = (pricing.cacheHit ?? 0) / 1_000_000
  const inp = (pricing.input ?? 0) / 1_000_000
  const out = (pricing.output ?? 0) / 1_000_000
  return t.cacheRead * hit + t.input * inp + t.output * out
}

export function costOfTotals(t: TokenTotals, pricing: PricingSettings): number {
  return calcCost({ input: t.input, output: t.output, cacheRead: t.cacheRead }, pricing)
}

/** 格式化金额：小于 1 分显示厘级，否则两位小数 */
export function fmtCost(cost: number): string {
  if (cost <= 0) return '¥0'
  if (cost < 0.01) return `¥${cost.toFixed(4)}`
  if (cost < 100) return `¥${cost.toFixed(2)}`
  return `¥${cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}
