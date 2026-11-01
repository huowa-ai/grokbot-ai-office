# AGENTS.md

给 AI 编码助手（Codex、CodeBuddy 等）的项目说明。

## 项目

grokbot-ai-office 是一个多 AI 协作办公室：任何 AI 都能以同一种方式接入 Grok Bot 群聊，并在实时的虚拟办公室界面里看到每个 AI 在做什么。

中转层是底座：`ai-relay <名字> <提示>` 按 `configs/providers.yaml` 调用对应 AI，并写状态事件。虚拟办公室界面是前端，只读这些事件。架构见 `docs/ARCHITECTURE.md`，规范见 `docs/CONVENTIONS.md`。

## 环境与命令

- Node.js 22，pnpm 9。
- 安装：`pnpm install`
- 构建：`pnpm build`
- 检查：`pnpm lint && pnpm typecheck`
- 测试：`pnpm test`（单包：`pnpm --filter @grokbot-ai-office/core test`）
- 真实调用自检：`pnpm selfcheck <名字>`（不在 CI 中运行）
- 事件服务：`pnpm serve`（即 `ai-relay serve`，默认 `127.0.0.1:8787`）
- MCP 服务器：`ai-relay mcp`（stdio），或 `ai-relay mcp --http`（默认 `127.0.0.1:8788`）。说明见 `docs/MCP.md`
- 3D 办公室：`pnpm office`（默认 `127.0.0.1:8789`），演示用 `pnpm office:demo`。说明见 `docs/OFFICE.md`

## 必须遵守

- 依赖方向：`apps → core`；适配器实现 `core` 的 `AdapterPort`；适配器之间不互相导入；`office` 只读事件服务，不调用 AI。
- 接入新 AI 优先只改 `configs/providers.yaml`，三种 `auth`：`subscription`、`api_key`、`openai_compatible`。
- 每个 `subscription` 提供者必须有只读或安全模式参数。
- 同一台机器上，适配器的工作目录是 `RELAY_WORKSPACE`（默认 `~/.grokbot-ai-office/workspace`）。不要把密钥放进该目录。
- 启动时读取 `RELAY_HOST`（如 `mac`、`cloud`）。对外标识是 `<provider>@<host>`。注册表仍按 AI 名字共享；可选 `hosts` 限定可用机器。
- 状态事件写入 `RELAY_EVENTS_PATH`，默认 `~/.grokbot-ai-office/events.jsonl`。不要提交事件日志。`subscription` 的 `pty: true` 才使用伪终端，失败则回退管道。
- 出错返回 `RelayError` 和错误码，不编造回答，不写空 `catch`。
- 单元测试不调用真实 AI。
- 提交信息用约定式提交，如 `feat(adapters): ...`；在分支上工作并开 PR，不直接推 `main`。

## 禁止

- 禁止把任何密钥、token、cookie 写进代码、配置、测试、日志或 PR 描述。密钥只从环境变量读取，`.env.example` 只列变量名。
- 禁止提交 `.env`、CLI 登录文件或事件日志。

## PR 前检查

`pnpm lint && pnpm typecheck && pnpm test` 全部通过。
