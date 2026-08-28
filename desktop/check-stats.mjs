// 检查 token 统计正确性
const wsUrl = process.argv[2]
const ws = new WebSocket(wsUrl)
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data.toString())
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
  }
})
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
}).then((res) => {
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails))
  return res.result?.value
})

const state = await evaluate(`window.pet.getState()`)
console.log('aggregate.totals:', JSON.stringify(state.aggregate.totals))
console.log('aggregate.taskCount:', state.aggregate.taskCount, 'failCount:', state.aggregate.failCount)
console.log('todayTokens:', JSON.stringify(state.todayTokens))

// 从存储文件核对原始事件
const fs = await import('node:fs')
const path = await import('node:path')
const f = path.join(process.env.APPDATA, 'ryderbaby-desktop', 'pet-events.json')
const j = JSON.parse(fs.readFileSync(f, 'utf-8'))
const usage = j.events.filter((e) => e.type === 'usage')
const sum = usage.reduce((acc, e) => {
  acc.input += e.usage.input
  acc.output += e.usage.output
  acc.cacheRead += e.usage.cacheRead
  acc.cacheWrite += e.usage.cacheWrite
  acc.calls += 1
  return acc
}, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 })
console.log('--- 从事件文件重新计算 ---')
console.log('file sum:', JSON.stringify(sum))
console.log('file events:', usage.length)
// 检查是否有重复累加（store.load 时 rebuildAggregates + append 再累加？）
const first3 = usage.slice(0, 3)
console.log('--- 前3条 usage 事件 ---')
first3.forEach((e) => console.log(`ts=${e.ts} in=${e.usage.input} out=${e.usage.output} cache=${e.usage.cacheRead} seq=${e.seq}`))
ws.close()
process.exit(0)
