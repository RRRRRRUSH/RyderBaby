# RyderBaby 产品设计文档

> 版本：v0.3 · 状态：开发中 · 平台：Windows + macOS（Electron）

### 已定决策（v0.3 确认）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 平台范围 | 第一版**只做 DeepSeek**（DSH 场景），架构预留多 provider 抽象 |
| D2 | 桌宠画风 | **先简单**：Emoji + CSS 动画起步，后期可升级 SVG/Live2D |
| D3 | 用量与任务提醒的数据来源 | **DSH 插件直连为主通道**：挂在 `llm/stream` 瀑布流上直接拿厂商 usage（chunk 即 token 增量），事件折叠推断任务状态；不再走本地代理（DSH 环境下无需改 base_url） |
| D4 | 台词风格 | **多风格模板可切换**：内置多套性格模板（毒舌老运维 / 暖心萌宠 / 冷淡极客等），用户自选 |
| D5 | 桌面技术栈 | **Electron + TypeScript + React + Vite**（放弃 Tauri：开发速度优先，Rust 意向让位于交付效率） |
| D6 | Token 计量 | **先只统计数量，不算钱**：记录 prompt/completion/cache/reasoning tokens，费用估算推迟到后续版本 |
| D7 | 提醒覆盖 | 任务失败、断线、token 阈值预警必须提醒；任务完成 L1 提醒 |
| D8 | 对话总结 | **会话级结构化总结**（零 LLM 调用，纯事件折叠），不做 AI 散文总结 |
| D9 | 可扩展性 | **多 agent 并发监控**（按 sessionId 折叠多路）+ 用户自定义插件系统 |
| D10 | 离线能力 | 桌宠本地持久化事件与统计，断线/离线仍可浏览历史 |

### 已定决策（v0.2 确认，保留）

RyderBaby 是给程序员的桌面宠物（桌宠），尤其面向喜欢 vibecoding（AI 辅助编码）的开发者：
**把 AI 用量监控、额度预警、任务提醒变成一只"活着"的、趴在屏幕角落的伙伴。**

---

## 1. 项目定位

### 1.1 一句话定位

> 一只会吐槽、会着急、会庆祝的桌面宠物，替你盯着 AI 编码的 token 消耗、额度和任务进度，让你不用频繁切窗口。

### 1.2 为什么是"桌宠"，而不是又一个监控面板

vibecoding 的场景是：人盯着编辑器/浏览器，agent 在后台跑，人需要频繁切到终端、平台控制台、任务列表去看进度和烧钱情况。

桌宠的本质是把**运维信息变成可一眼扫过的陪伴存在**，它有三个普通 widget 没有的价值：

1. **注意力分级**：信息不是平铺的，而是有"性格"地推送——烧钱快了它急，任务完成了它庆祝，闲着它打盹。
2. **情绪化反馈**：数字本身没有情感，桌宠把"这个月额度快没了"翻译成"姐，这趟要烧钱了啊"，更容易被记住和在意。
3. **陪伴感**：长时间 vibecoding 是孤独的，一只可靠的"工位生物"降低疲劳感。

### 1.3 目标用户

| 用户画像 | 核心诉求 |
|---|---|
| vibecoding 重度用户 | 实时知道 token 烧了多少、还剩多少、任务多久完 |
| 多 agent / 多会话并行用户 | 同时盯多个任务的进度与成本 |
| 预算敏感的自由开发者 | 额度预警，避免超额扣费 |
| 桌宠 / 桌面美化爱好者 | 好看、有个性、有互动 |

---

## 2. 核心设计原则

### 2.1 性格边界：一个"工程师味的老运维"

桌宠必须有立人设，这是差异化核心。建议性格原型：

- **可靠**：数据必须准确，不许虚报。
- **有点毒舌但很专业**：token 烧得快时吐槽"这个循环再跑下去，余额要报警了"。
- **会求表扬**：任务完成时"快夸我，我可盯着它跑完了"。
- **有分寸**：不刷屏，大事才出声（见 2.2）。

### 2.2 打扰分级（信息优先级）

| 级别 | 内容 | 呈现方式 |
|---|---|---|
| **L0 常驻** | token 曲线、余额、会话状态 | 静静趴着，小面板常显，不打扰 |
| **L1 轻提醒** | 任务完成、单个任务失败 | 桌宠动作切换 + 小气泡，自动消失 |
| **L2 强提醒** | 额度预警、成本异常飙升、任务卡死超时 | 桌面通知 + 声音 + 桌宠"叼账单"跑动 |

> 原则：**级别越高越少出现**。桌宠最怕变成"又一个通知轰炸器"。

### 2.3 桌宠感：状态必须与真实数据联动

桌宠"活"的核心：动作状态机由真实数据驱动（见第 6 节）。

---

## 3. 功能清单与优先级

| 优先级 | 功能 | 说明 |
|---|---|---|
| **P0** | 余额/额度实时监控 | 轮询 DeepSeek 官方余额接口，展示剩余额度、赠送额度、充值额度 |
| **P0** | 桌宠主体 + 状态机 | 半透明无边框小窗，点击穿透，动作随状态切换 |
| **P0** | 额度预警 | 余额低于阈值（可配）→ L2 强提醒 |
| **P0** | 托盘常驻 | 系统托盘图标，右键菜单：显示/隐藏/退出/设置 |
| **P1** | token 消耗记录与曲线 | 本地代理记录每次请求 usage，画出历史曲线 |
| **P1** | 任务结束提醒 | 监控 agent 任务（见 4.3 数据源），完成/失败 → L1/L2 提醒 |
| **P1** | 成本估算 | 按模型单价估算每次会话花费，预测"这活儿还要烧多少" |
| **P2** | 多平台支持 | OpenAI / Anthropic / Gemini 适配器 |
| **P2** | 多会话聚合视图 | 同时跑的 agents 一览（点桌宠展开） |
| **P3** | 自定义皮肤/性格 | 用户自配表情、台词、颜色主题 |
| **P3** | 桌宠互动 | 点击、拖拽、喂食（随机彩蛋） |

---

## 4. 系统架构

### 4.1 总体架构（Electron + React）

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 桌面应用                      │
│                                                         │
│  ┌─────────────┐   ┌────────────────────────────────┐   │
│  │ Main 进程    │   │      Web 前端 (React/TS)        │   │
│  │             │   │  ┌──────────────────────────┐  │   │
│  │ · SSE 客户端 │◄──┤  │ 桌宠渲染 (Emoji/CSS)      │  │   │
│  │ · 断线重连   │   │  │ 面板 UI (余额/曲线/任务)   │  │   │
│  │ · 事件总线   │   │  │ 设置页                    │  │   │
│  │ · 本地存储   │   │  └──────────────────────────┘  │   │
│  │ · 托盘       │   └────────────────────────────────┘   │
│  │ · 系统通知   │                                        │
│  └──────┬──────┘                                        │
│         │ Electron IPC (preload / contextBridge)         │
└─────────┼───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│              DSH 数据源插件 (pet-bridge)                  │
│                                                         │
│  · llm/stream 瀑布流 → 厂商 usage（token 计数）           │
│  · agent/subagent/workflow/jobs/goal 事件 → 状态折叠     │
│  · 按 sessionId 多路累加（多 agent 并发）                 │
│  · SSE /pet/events + GET /pet/state + POST /pet/cmd      │
└─────────────────────────────────────────────────────────┘
```

### 4.2 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 应用壳 | **Electron**（最新稳定版 + TypeScript） | 跨平台 Win/macOS，透明置顶窗/通知/托盘全成熟；本机 Node v24 就绪 |
| 前端 | Vite + React + TypeScript | 生态成熟，开发快；宠物动画 + 面板 + 统计图表都要组件化 |
| 构建打包 | electron-vite + electron-builder | 一条流水线出 Win (NSIS) + mac (DMG) |
| 数据通道 | **SSE**（DSH→桌宠，主通道）+ **POST 命令**（桌宠→DSH） | 动态插件环境无法 import WS 库，SSE 自带自动重连语义；后续可升级 WebSocket |
| 事件总线 | mitt | 主进程/渲染层各自轻量总线 |
| 设置存储 | electron-store | 静音、预算阈值、台词风格等 JSON 配置 |
| 历史存储 | 存储抽象层：先 JSON（lowdb），数据量上来换 better-sqlite3 | 接口先行，切换无痛；避免 P1 就背上原生模块 |
| 统计图表 | ECharts（按需引入） | 趋势/分布/成功率图 |
| 通知 | Electron Notification + 托盘 | L2 强提醒 |
| 断线检测 | SSE onerror + 心跳 + 指数退避重连 | 状态机 connected/reconnecting/offline |

### 4.3 数据源设计（关键！v0.3 重写）

> ✅ **重要事实更新**：本项目的目标环境是 DeepSeek Harness（DSH）。DSH 自身的 `llm/stream` 瀑布流会经过**每一次**模型调用（重试、回放、路由都走这里），且 StreamChunk 带专用 `usage` chunk（`inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens`）。因此**不再需要本地代理**——直接在 DSH 进程内挂一个插件即可拿到全部厂商 usage，零侵入、不丢数据、不落盘 prompt 内容。

**Adapter 1（主线）：DSH pet-bridge 插件**
- 挂 `llm/stream` 瀑布流：包装 chunk 流，抽取 `usage` chunk → 按 sessionId/model 累加
- 任务状态：监听 `agent/status`（idle⇄running）、`subagent/end`、`workflow/end`、`jobs.onJobDone`、`goal/changed`、`agent/error`
- 通过 `webServer` 暴露：
  - `GET /pet/state` — 全量快照（宠物上线时拉取）
  - `GET /pet/events` — SSE 事件流（usage / agent-status / task-end / error / heartbeat）
  - `POST /pet/cmd` — 桌宠反向命令（静音、暂停提醒）
- 成本：DSH 内一个动态插件即可跑通；**生产化时迁移为宿主级持久插件**（llm/stream 与 jobs 本就进程级，agent 事件需宿主级作用域），协议层不变
- ⚠️ 隐私：只抽取 usage 数字与事件标量字段，**不落盘任何 prompt/响应内容**

**Adapter 2：官方余额查询**（后续版本，D6 决定先不做费用计算）
- `GET https://api.deepseek.com/user/balance`，参考：[DeepSeek 查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)
- 轮询间隔 60s；余额展示与预警是 P1 之后的事

**Adapter 3（未来）：多平台**
- OpenAI / Anthropic / Gemini 各自适配，统一 `ProviderAdapter` 接口

**数据契约（v0.3 草案）**

```ts
// DSH→桌宠（SSE 事件）
interface UsageEvent {
  type: 'usage';
  sessionId: string; agentId?: string;
  model: string; provider: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number };
  totalTokens: number;   // 进程累计
  ts: number;
}
interface TaskEndEvent {
  type: 'task-end';
  kind: 'workflow' | 'subagent' | 'job' | 'goal';
  result: 'ok' | 'failed' | 'aborted' | 'max-tokens' | ...;
  label?: string; detail?: string; sessionId?: string;
  ts: number;
}
interface StatusEvent { type: 'agent-status'; agentId: string; state: 'running' | 'idle'; ts: number }
interface ErrorEvent   { type: 'agent-error'; agentId: string; message: string; turn: number; ts: number }
interface Snapshot     { type: 'snapshot'; totals: TokenTotals; agents: Record<string, AgentState>; recent: Event[]; ts: number }

// 桌宠→DSH（POST /pet/cmd）
interface PetCommand { action: 'mute' | 'unmute' | 'pause-reminders' | 'resume' | 'get-state' }
```

### 4.4 核心数据结构（草案）

```ts
// 余额快照
interface BalanceSnapshot {
  provider: string;
  currency: string;
  totalBalance: number;      // 总余额
  grantedBalance: number;    // 赠送余额
  toppedUpBalance: number;   // 充值余额
  isAvailable: boolean;
  fetchedAt: number;
}

// 单次用量记录
interface UsageRecord {
  id: string;
  provider: string;
  sessionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;          // 按单价估算
  occurredAt: number;
}

// 任务事件（来自日志/代理）
interface TaskEvent {
  id: string;
  source: 'agent-log' | 'proxy' | 'manual';
  agentName: string;         // 如 claude-code / dsh-agent
  status: 'running' | 'success' | 'failed' | 'timeout';
  startedAt: number;
  finishedAt?: number;
  summary?: string;
}

// 桌宠状态（由以上数据推导）
interface PetState {
  mood: 'idle' | 'working' | 'happy' | 'worried' | 'panicked' | 'sleeping';
  activity: 'sleeping' | 'typing' | 'watching' | 'running' | 'celebrating';
  currentText: string;       // 台词气泡
  since: number;
}
```

---

## 5. 提醒系统设计

### 5.1 提醒规则引擎（可配置）

| 规则 | 默认阈值 | 触发级别 | 桌宠表现 |
|---|---|---|---|
| 余额低 | < 总余额 20% 或 < ¥10 | L2 | 叼账单跑动 + 通知 |
| 余额极低 | < ¥2 | L2+ | 哭脸 + 声音 + 通知 |
| token 消耗速率异常 | 5 分钟内 > 200k tokens | L2 | 冒汗 + 吐槽 |
| 任务完成 | — | L1 | 庆祝动作 + 气泡 |
| 任务失败 | — | L1 | 叹气 + 安慰台词 |
| 任务卡死 | 无输出 > 10 分钟 | L2 | 着急跺脚 + 通知 |
| 会话空闲 | > 30 分钟 | L0→sleeping | 打盹 |

### 5.2 台词库设计（多风格模板）

- **风格模板系统（D4）**：每套模板 = 一组"状态 → 台词池"映射 + 语气参数，用户在设置页一键切换
  - 模板示例：**毒舌老运维**（"姐，这趟要烧钱了啊"）、**暖心萌宠**（"别急，我帮你盯着呢~"）、**冷淡极客**（"warning: token 消耗超预期"）
  - MVP 内置 2–3 套，模板以 JSON 文件形式存放，用户可自定义（P3）
- 台词可引用真实数据：`"这个循环已经烧了 {tokens} tokens 了，余额剩 {balance}"`
- 防止刷屏：同状态台词去重 + 冷却时间

---

## 6. 桌宠状态机

### 6.1 状态机

```
                任务进行中
    ┌─────────┐ ─────────► ┌─────────┐
    │         │            │ working │
    │ idle    │ ◄───────── │ (typing)│
    │ (打盹)   │  完成/失败  └────┬────┘
    └────┬────┘                 │ 卡死/超时
         │ 空闲>30min            ▼
         ▼                  ┌─────────┐
    ┌─────────┐             │ worried │
    │ sleeping│             │ (跺脚)   │
    └─────────┘             └────┬────┘
                                 │ 恢复
                                 ▼
                            ┌─────────┐
                            │ working │
                            └─────────┘
    完成 → happy (庆祝) → 冷却 → idle
    余额低 → panicked (叼账单) → 通知 → idle
```

### 6.2 状态→数据映射

| 桌宠状态 | 触发数据条件 | 动画 |
|---|---|---|
| `idle` | 无任务、余额正常 | 眨眼、晃尾巴 |
| `working` | 有任务 running | 敲键盘、冒热气 |
| `happy` | 任务 success | 跳起来、撒花 |
| `worried` | 任务 failed / 无输出 | 叹气、低头 |
| `panicked` | 余额预警 / 速率异常 | 流汗、叼账单跑 |
| `sleeping` | 空闲 > 30min | Zzz 动画 |

---

## 7. 隐私与安全

- **API Key 本地存储**：用系统钥匙串/DPAPI 加密存储，绝不上传
- **本地代理不记录请求体内容**：只记录 usage 统计字段，不落盘 prompt 内容
- **不联网上报任何数据**：所有统计本地完成
- 开源时提供**代码审计友好**的架构说明

---

## 8. 开发路线图

### 里程碑 M0（数据管线，进行中）
- [x] 契约核实：`llm/stream` usage chunk、事件 payload、webServer 路由签名
- [ ] DSH pet-bridge 动态插件：usage 捕获 + 生命周期折叠 + `GET /pet/state` + `GET /pet/events`(SSE) + `POST /pet/cmd`
- [ ] 造真实流量验证：usage/事件经 SSE 流出
- **验收**：curl 能拉到全量快照，对话过程中 SSE 实时推送 usage 与任务事件

### 里程碑 M1（MVP，2–3 周）
- [ ] Electron 工程骨架（electron-vite + React + TS）+ 透明无边框置顶窗
- [ ] 主进程 SSE 客户端 + 断线重连状态机 + 事件存储（存储抽象层，先 JSON）
- [ ] 桌宠 Emoji 主体 + `idle/working/happy/worried` 四态（CSS 动画）
- [ ] 任务完成 L1 提醒 + 任务失败/断线/token 阈值 L2 通知 + 托盘
- [ ] 台词模板框架 + 首版 2 套风格（可切换）
- **验收**：桌宠趴在屏幕角落，实时显示 token 消耗，任务跑完会提醒，失败/断线/超预算会急会通知

### 里程碑 M2（有用，+2 周）
- [ ] 会话级结构化总结卡片（零 LLM 调用，事件折叠生成）
- [ ] 消耗曲线面板（近 7 天 / 近 24h）+ 多 agent 卡片墙
- [ ] 成本估算（按模型单价，D6 解禁后）
- [ ] 存储切换 better-sqlite3（若数据量需要）
- **验收**：能看到"今天这个会话烧了多少 token / 任务总结"，任务结束有提醒

### 里程碑 M3（有灵魂，+2 周）
- [ ] 完整状态机 + 台词库 + 冷却防刷屏
- [ ] 任务卡死检测 + 强提醒
- [ ] 设置页（阈值、台词、皮肤）
- [ ] 多 provider 抽象
- **验收**：桌宠"活"了，性格立住

### 里程碑 M4（打磨）
- [ ] 多会话聚合视图
- [ ] 用户自定义插件系统（onEvent / ui / trayItems / notifiers / priceProvider）
- [ ] 自定义皮肤/性格
- [ ] 互动彩蛋（点击/拖拽/喂食）
- [ ] DSH 插件生产化：会话级 → 宿主级持久插件

---

## 9. 风险与待决问题

| 风险 | 缓解 |
|---|---|
| 动态插件是会话级的，重启即失 | pet-bridge 协议层与宿主级无关；M4 迁移为宿主级持久插件，桌宠侧零改动 |
| SSE 在 Electron 渲染层的 CORS/生命周期问题 | 主进程持有 SSE 连接，渲染层走 IPC；主进程做重连 |
| 桌宠沦为"好看的玩具" | 提醒价值做硬（L2 强提醒）+ 数据准确（厂商 usage 直取） |
| 透明置顶窗跨平台差异 | Win 用 `setAlwaysOnTop` + 透明，mac 用 `setVisibleOnAllWorkspaces`，抽象平台适配层 |
| 点击穿透与交互冲突 | 宠物本体可点（拖拽/互动），周边透明区域穿透 |

### 待决问题（已定 10 项，余下待定）

已定（v0.3）：DeepSeek（DSH）优先 · Emoji 起步 · DSH 插件直连 · 台词多模板 · Electron+TS · token 只计数 · 提醒覆盖失败/断线/阈值 · 会话级结构化总结 · 多 agent 并发 + 插件系统 · 离线能力

待定：
1. 任务"完成 vs 失败"的区分：DSH 事件直接给出 `result`（workflow stopReason / subagent stopReason / job status），无需推断 ✅ 已解决
2. token 预算阈值默认值：任务级/日级各设多少？预警分级 50%/80%/100% 是否合理？
3. 台词模板首版做哪 2–3 套？（建议：毒舌老运维 + 暖心萌宠 + 冷淡极客）
4. 桌宠默认贴边位置：屏幕右下角还是底部中间？
5. 开机自启默认开还是关？

---

## 10. 参考项目

- [DeepSeek 查询余额 API 文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/) — 官方余额接口
- [CodexBar](https://github.com/Zpankz/CodexBar) — macOS 菜单栏监控 Claude Code / Codex 用量（解析本地日志，无需登录），同赛道强参考
- [CodexBar-Win](https://raw.githubusercontent.com/babakarto/CodexBar-Win/master/README.md) — Windows 托盘版，直接竞品参考
- [Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) — 实时多 agent 监控看板（React + WS + 原生 app），形态强参考
- [MaiBot Deskpet](https://github.com/Maboroshinatsu/maibot-deskpet-plugin) — Electron 桌宠插件（宿主桥接架构参考）
- [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) — DeepSeek Harness 会话费用统计插件，验证"会话级费用"需求
- [dsh-plugin-quota-monitor](https://raw.githubusercontent.com/DoggyHU/dsh-plugin-quota-monitor/main/README.md) — DSH 配额监控插件
- [deepseek-usage](https://github.com/shajanjp/deepseek-usage) — DeepSeek 用量统计工具
