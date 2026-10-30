# AGENTS.md

给 AI 编码助手（Codex、CodeBuddy 等）的项目说明。

## 项目

可复用的多 AI 中转层：`ai-relay <名字> <提示>` 按 `configs/providers.yaml` 调用对应 AI，并写状态事件。架构见 `docs/ARCHITECTURE.md`，规范见 `docs/CONVENTIONS.md`。

## 环境与命令

- Node.js 22，pnpm 9。
- 安装：`pnpm install`
- 构建：`pnpm build`
- 检查：`pnpm lint && pnpm typecheck`
- 测试：`pnpm test`（单包：`pnpm --filter @grokbot-ai-office/core test`）
- 真实调用自检：`pnpm selfcheck <名字>`（不在 CI 中运行）

## 必须遵守

- 依赖方向：`apps → core`；适配器实现 `core` 的 `AdapterPort`；适配器之间不互相导入；`office-web` 只读事件。
- 接入新 AI 优先只改 `configs/providers.yaml`，三种 `auth`：`subscription`、`api_key`、`openai_compatible`。
- 每个 `subscription` 提供者必须有只读或安全模式参数。
- 同一台机器上，适配器的工作目录是 `RELAY_WORKSPACE`（默认 `~/.grokbot-ai-office/workspace`）。不要把密钥放进该目录。
- 出错返回 `RelayError` 和错误码，不编造回答，不写空 `catch`。
- 单元测试不调用真实 AI。
- 提交信息用约定式提交，如 `feat(adapters): ...`；在分支上工作并开 PR，不直接推 `main`。

## 禁止

- 禁止把任何密钥、token、cookie 写进代码、配置、测试、日志或 PR 描述。密钥只从环境变量读取，`.env.example` 只列变量名。
- 禁止提交 `.env`、CLI 登录文件或事件日志。

## PR 前检查

`pnpm lint && pnpm typecheck && pnpm test` 全部通过。
