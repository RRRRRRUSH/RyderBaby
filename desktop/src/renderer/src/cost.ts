/** 渲染层费用估算（与主进程 cost.ts 一致）：每 1M tokens 价格，元 */
import type { PricingSettings } from '../../shared/settings'

export interface CostInput {
  input: number
  output: number
  cacheRead: number
}

export function calcCost(t: CostInput, pricing: PricingSettings | undefined): number {
  if (!pricing) return 0
  const hit = (pricing.cacheHit ?? 0) / 1_000_000
  const inp = (pricing.input ?? 0) / 1_000_000
  const out = (pricing.output ?? 0) / 1_000_000
  return t.cacheRead * hit + t.input * inp + t.output * out
}

export function fmtCost(cost: number): string {
  if (cost <= 0) return '¥0'
  if (cost < 0.01) return `¥${cost.toFixed(4)}`
  if (cost < 100) return `¥${cost.toFixed(2)}`
  return `¥${cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}
