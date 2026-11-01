# 路线图

本文是已经定下来的计划。当前实现到第 4 步。第 5 步之后都还没做。

## 第一步 骨架（完成）

仓库结构、设计规范、注册表校验和错误码。

## 第二步 中转核心与接入适配器（完成）

`ai-relay` 能按 `configs/providers.yaml` 调用 AI。三种接入都已接通：

- `subscription`：本地 CLI
- `api_key`：DeepSeek、Kimi、GLM、Claude（Anthropic）、Gemini
- `openai_compatible`：OpenAI 兼容接口，包括本地 Ollama

## 第三步 实时事件（完成）

事件写入 `~/.grokbot-ai-office/events.jsonl`，也可用 `RELAY_EVENTS_PATH` 改路径。`ai-relay serve` 把新事件推到本机 WebSocket，并用 `GET /state` 给后加入的客户端一份快照。

这一步还包含两件从 MIT 项目 [munder-difflin](https://github.com/HarnessMD/munder-difflin) 学来、但按我们自己的端口重新实现的能力：

1. **伪终端**。`subscription` 可设 `pty: true`。原始终端输出（颜色、光标）进入 `output_chunk`，并保留最近 8KB，供第 4 步的 xterm.js 重放。`node-pty` 加载失败时退回管道。超时、中止或退出时结束整个进程组。
2. **CLI 钩子**。`ai-relay hook` 和 `POST /hook` 接收 Claude Code 等 CLI 的钩子，把提交提示、调用工具、请求权限、停止映射成 `working`、`waiting_approval`、`idle`。钩子状态优先于输出启发式。配置见 [HOOKS.md](./HOOKS.md)。

交接和批准也在这一步：`ai-relay handoff`、`ai-relay approval request|resolve|list`。还没有界面。

## 第 3.5 步 ai-relay 作为 MCP 服务器（完成）

`ai-relay mcp` 把中转做成 MCP 服务器。工具有 `ask`、`list_agents`、`office_status`，以及交接和批准。传输有 stdio，也有默认只监听本机的 Streamable HTTP。Grok Bot 的中转 bot 调用这个 MCP，不再拼接 Shell 命令。说明见 [MCP.md](./MCP.md)。

## 第四步 3D 办公室第一版（完成）

用 three.js 做真 3D，低多边形卡通风，默认正交等距视角。本地区和云端区在同一层楼。每台显示器嵌一个实时的 xterm.js 终端（CSS3DRenderer）。状态有动画：卡住变红、等批准举手、长期空闲睡觉、新 AI 接入时装修工位。交接时拿着文件走过去。每个提供者有自己的角色和桌子。用法见 [OFFICE.md](./OFFICE.md)。老板视角还没有做。

## 第五步 老板视角

同一场景切到第一人称透视镜头，用 WASD 和鼠标走动。走近可以看清屏幕，也可以跟随一次交接。点老板电脑进入控制台，里面有状态总表、批准事项、交接记录和派活输入框。控制台使用本地口令，并且只监听 localhost。

## 第 5.5 步 macOS 原生 SwiftUI 灵动岛

屏幕顶部一条胶囊。每个 AI 一个状态点。悬停展开，可以一键批准或拒绝，能看到交接动画。点击后打开 3D 办公室里对应的工位。这一步要在 Mac 上用 Xcode 编译。

## 第六步 分发

> 进度：打包已准备好。`apps/npm` 产出单个 npm 包 `grokbot-ai-office`（命令 `grokbot-ai-office`，别名 `ai-relay`），已实现 `init`、`ask`、`mcp`、`office`，安装提示见 `docs/SETUP_PROMPT.md`。发布工作流 `.github/workflows/release.yml` 在推送 `v*` 标签时用 `NPM_TOKEN` 发布。尚未发布，等决定仓库是否公开。Grok Bot 模板导出还没做。

发布 npm 包。用法是 `npx grokbot-ai-office init | mcp | office | ask`。同时导出 Grok Bot 模板。每个用户在自己的电脑上用自己的 AI 账号和 key 运行，不做托管 SaaS。npm 发布前需要先决定仓库是否公开。

交付物还包括安装提示 `docs/SETUP_PROMPT.md` 和英文版 `docs/SETUP_PROMPT.en.md`。用户把它贴进 Grok Bot 或任何编程 AI，由对方按提示安装。这个写法受到 rakazo 仓库里 SETUP_PROMPT.md 的启发，只借鉴「一份可粘贴的安装提示」这个想法。

提示要求对方：

1. 运行 `npx grokbot-ai-office init`。
2. 检测本机已经安装并登录的 CLI：codex、claude、gemini、codebuddy、hermes、openclaw。
3. 询问 `RELAY_HOST` 和工作目录。
4. 让用户自己把 API key 写进 `.env`。
5. 用 `ask` 对每个提供者做一次冒烟。
6. 启动 `mcp` 和 `office`。
7. 用一张状态表结束。

提示里的安全约束：不覆盖、不打印 `.env` 里的值；不打印、不提交密钥；不结束无关进程；不用 sudo；`subscription` 保持 `safe_mode`。
