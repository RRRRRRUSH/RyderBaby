# RyderBaby

一个桌面宠物，专门盯着你的 AI 编程助手。

DeepSeek Harness（DSH）、Claude Code、Codex 同时在跑的时候，token 花了多少、哪个任务做完了、哪个失败了、烧钱是不是太快——这些信息散在各个终端和网页里。RyderBaby 把它们收拢到屏幕角落的一只小宠物身上：干活时它敲键盘，任务完成它撒花，失败它叹气，烧钱太快它会着急。任务结束推送一条卡片到钉钉，写清楚是哪个项目、哪一轮对话、花了多少 token、大概多少钱。

> ⚠️ **开发中**：核心功能可用，界面和细节还在打磨。欢迎试用、提 issue、参与二开。

## 功能

- **多 agent 并行监控**：DSH、Claude Code、Codex 可同时监控，各自独立的监控/推送开关
- **会话级归因**：每个回合（哪一轮对话）消耗多少 token 独立统计；推送卡片带「对话名称」，多项目一眼分清
- **花费估算**：按真实计价规则（缓存命中输入 / 未命中输入 / 输出三档价格，可手动配置），HUD、悬浮卡、统计页、推送卡片统一显示
- **分级提醒**：任务级（回合/工作流/子任务）结束推卡片；命令级（npm、脚本等）默认静默不打扰，可单独开启
- **桌面悬浮详情**：鼠标悬停在宠物上，弹出当前 token、花费与各会话明细；平时只显示一行基础状态
- **不打扰**：透明窗口点击穿透，宠物可拖到任意位置，不挡操作

## 使用教程

### 1. 安装

| 方式 | 说明 |
|---|---|
| 安装包 | 从 [Releases](https://github.com/RRRRRRUSH/RyderBaby/releases) 下载 `RyderBaby Setup x.x.x.exe`，双击安装 |
| 免安装 | `desktop/dist/win-unpacked/RyderBaby.exe` 直接运行 |
| 源码运行 | 见下方「从源码构建」 |

### 2. 连接钉钉机器人（推送提醒）

1. 打开钉钉群 → 群设置 → **智能群助手** → **添加机器人** → **自定义机器人**
2. 填写机器人名称（如"RyderBaby"），安全设置选 **加签**（推荐）或自定义关键词
3. 复制 **Webhook 地址**（`https://oapi.dingtalk.com/robot/send?access_token=...`）和 **加签 Secret**（`SEC...`）
4. 右键托盘猫图标 → **设置** → **推送渠道**：
   - 填入 Webhook 和 Secret
   - 勾选"启用"
5. 点 **发送测试推送**——群里应该立刻收到一条测试消息

之后 DSH 里任意会话的任务回合结束，都会推一张卡片到群里：

```
✅ DSH · 回合完成 ·「电脑桌宠监控与提醒构思」
**修复 electron-builder 双平台出包**
- 💬 对话：电脑桌宠监控与提醒构思
- 🔄 回合：第 7 轮
- ⏱ 耗时：45分
- ⚡ Token：86.40M · ≈¥17.28
- ✅ 结果：成功
```

### 3. 配置价格（花费估算）

设置 → 常规 → 价格设置，按实际计价规则填三档价格（每 1M tokens，元）：

| 档位 | 默认值 | 对应 |
|---|---|---|
| 输入（缓存命中） | 0.20 | 厂商 usage 的 cacheReadTokens |
| 输入（未命中） | 2.00 | usage 的 inputTokens |
| 输出 | 8.00 | usage 的 outputTokens |

### 4. 自定义外观

设置 → 外观：每个状态（空闲/工作/完成/失败/预警/离线）可单独设置图标（emoji 或图片路径）和状态文字。鼠标悬停宠物可预览。

## 从源码构建

```bash
cd desktop
npm install
npm run dev        # 开发运行
npm run build      # 构建产物
npm run dist:win   # 打包 Windows 安装包（NSIS）
npm run dist:mac   # 打包 macOS（需在 mac 上执行）
```

## 数据来源与隐私

- **DSH**：pet-bridge 插件挂在 `llm/stream` 瀑布流上，直接取厂商 usage（input / output / cacheRead / cacheWrite / reasoning），并监听 agent/subagent/workflow 事件
- **Claude Code / Codex**：读取本地 jsonl 会话日志（`~/.claude/projects`、`~/.codex/sessions`），增量解析
- **隐私**：只记录用量数字与事件标量字段，**不落盘任何 prompt / 响应内容**；所有数据本地存储，不联网上报

## 架构

```
DSH (llm/stream 瀑布流 + 事件) ──SSE──► Electron 桌宠
Claude Code / Codex (jsonl 日志) ──────►  ├─ 提醒引擎（分级/去重）
                                          ├─ PushRouter（钉钉等渠道）
                                          ├─ 本地事件存储（JSON，离线可用）
                                          └─ 统计/设置（React + ECharts）
```

```
desktop/
├── src/main/       # Electron 主进程：SSE 客户端、提醒引擎、推送、存储、成本计算
├── src/renderer/   # 渲染层：桌宠动画、悬浮卡、统计（ECharts）、设置页
├── src/preload/    # IPC 桥（contextBridge）
└── src/shared/     # 类型与设置定义
```

## 二开指南

- **加推送渠道**：实现 `PushChannel` 接口（见 `src/main/push.ts`），在 `setupDataPlumbing` 注册进 `PushRouter` 即可。内置了钉钉示例（webhook + 加签）
- **加 Agent 数据源**：实现 jsonl 日志解析器（参考 `src/main/external-watcher.ts`），统一产出 `PetEvent`
- **改卡片内容**：`src/main/task-card.ts` 的 `buildTaskCard`，钉钉 markdown 格式
- **改桌宠状态**：`src/main/index.ts` 的 `petMood` 与 `src/renderer/src/App.tsx` 的 `MOOD_TEXT_KEYS`（新增状态需同步 settings 的 `PetMoodKey`）

## Roadmap

- [x] token 监控与花费估算
- [x] 会话级归因（回合明细）
- [x] 钉钉推送卡片
- [ ] DSH 宿主级持久插件（免手动安装）
- [ ] 飞书 / 企业微信渠道
- [ ] 双向机器人（群内 @ 查询状态）
- [ ] 开机自启
- [ ] macOS 打包验证

## License

MIT
