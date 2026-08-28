# RyderBaby

一个桌面宠物，专门盯着你的 AI 编程助手。

DeepSeek Harness（DSH）、Claude Code、Codex 同时在跑的时候，token 花了多少、哪个任务做完了、哪个失败了、烧钱是不是太快——这些信息散在各个终端和网页里。RyderBaby 把它们收拢到屏幕角落的一只小宠物身上：干活时它敲键盘，任务完成它撒花，失败它叹气，烧钱太快它会着急。任务结束推送一条卡片到钉钉，写清楚是哪个项目、哪一轮对话、花了多少 token、大概多少钱。

## 它解决什么

- **多 agent 并行**：DSH、Claude Code、Codex 可以同时监控，各自独立的监控/推送开关，互不干扰
- **会话级归因**：每个回合（哪一轮对话）消耗多少 token 独立统计，推送卡片带「对话名称」，多项目一眼分清
- **花费估算**：按真实计价规则（缓存命中输入 / 未命中输入 / 输出三档价格，可手动配置），HUD、统计页、推送卡片统一显示
- **分级提醒**：任务级（回合/工作流/子任务）结束推卡片；命令级（npm、脚本等）默认静默不打扰，可单独开启
- **不打扰**：透明窗口点击穿透，宠物只占屏幕角落，不挡操作

## 快速开始

```bash
cd desktop
npm install
npm run dev        # 开发运行
npm run dist:win   # 打包 Windows 安装包
```

1. 安装后运行，托盘里出现猫图标
2. 右键托盘 → 设置 → 推送渠道，填入钉钉群机器人 webhook（可选加签）
3. 点"发送测试推送"验证
4. 完事——DSH 里的任务结束会自动推卡片到钉钉

数据来源：DSH 侧的 pet-bridge 插件（挂在 llm/stream 瀑布流上取厂商 usage + 事件折叠），Claude Code / Codex 走本地 jsonl 日志。只记录用量数字和事件标量，**不落盘任何 prompt 内容**。

## 界面

- **桌宠**：Emoji 状态机（空闲/工作/完成/失败/预警/离线），每个状态的图标和文字都可自定义；HUD 显示今日 token 与估算花费
- **设置**：中英文、7 个页面（常规/Agent/提醒/推送/统计/外观/关于）、无边框窗口
- **统计**：ECharts 曲线，按天/按小时，1-30 天范围

## 技术栈

Electron · React · TypeScript · ECharts · electron-vite · electron-builder

## 架构

```
DSH (llm/stream 瀑布流 + 事件) ──SSE──► Electron 桌宠
Claude Code / Codex (jsonl 日志) ──────►  ├─ 提醒引擎（分级/去重）
                                          ├─ PushRouter（钉钉等渠道）
                                          ├─ 本地事件存储（JSON，离线可用）
                                          └─ 统计/设置（React + ECharts）
```

## License

MIT
