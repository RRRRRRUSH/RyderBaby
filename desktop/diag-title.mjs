// 诊断：当前会话标题是否存在（通过 sessionQuery.readTitleSnapshots）
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
}).then((res) => res.result?.value)

// 通过插件快照拿 sessionId，然后…… 插件没有暴露 sessionQuery。改用直接检查当前会话标题：
// 桌宠拿不到 DSH 内部，这里只验证插件最近事件有没有带 title
const state = await evaluate(`fetch('http://127.0.0.1:63726/pet/state').then(r => r.json())`)
const bySession = state.bySession
console.log('sessions:', Object.keys(bySession).length)
for (const [sid, v] of Object.entries(bySession)) {
  console.log(`  ${sid}: calls=${v.calls} title=${JSON.stringify(v.title ?? null)}`)
}
// 检查最近事件里有没有带 sessionTitle
const titled = state.recent.filter((e) => e.sessionTitle)
console.log('recent events with sessionTitle:', titled.length)
ws.close()
process.exit(0)
