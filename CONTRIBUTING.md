# 贡献指南

欢迎改进 grokbot-ai-office。提交前请先读 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 和 [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)。

## 环境

1. 安装 Node.js 22。
2. 安装 pnpm 9。
3. 在仓库根目录执行 `pnpm install`。

## 开发步骤

1. 从 `main` 拉出分支，命名为 `feat/<简述>`、`fix/<简述>` 或 `docs/<简述>`。
2. 修改代码，并为公开行为补上测试。单元测试不得调用真实 AI。
3. 提交前运行 `pnpm lint && pnpm typecheck && pnpm test`。
4. 用约定式提交，例如 `feat(registry): 校验 key_env 变量名`。
5. 推送分支并打开 PR。不要直接推送 `main`。
6. PR 描述写清改了什么、怎么验证。合并使用 squash，标题就是约定式提交信息。

## 约定式提交

类型使用 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`ci`、`perf`。范围使用包名，例如 `core`、`adapters`、`registry`、`events`、`relay-cli`、`office-web`、`configs`。

`semantic-release` 根据这些信息生成 `CHANGELOG.md`。发布配置在 `.releaserc.json`，其中 `@semantic-release/npm` 设置了 `npmPublish: false`，不会把包发到 npm。

## 安全

1. 密钥只放在本机 `.env` 或环境变量里。
2. `.env.example` 只保留变量名，值留空。
3. 不要提交 `.env`、CLI 登录文件、`events.jsonl` 或 `workspace/`。共享文件目录由 `RELAY_WORKSPACE` 指定。
4. 不要在 issue、PR、聊天或日志里粘贴密钥。
5. 新增 `subscription` 提供者时必须写上 `safe_mode`。

## 常用命令

- `pnpm lint`：Biome 检查格式和代码。
- `pnpm typecheck`：TypeScript 严格类型检查。
- `pnpm test`：运行 vitest。
- `pnpm --filter @grokbot-ai-office/core test`：只测一个包。
- `pnpm selfcheck <名字>`：预留的真实调用自检，不进入 CI。当前骨架不会发起请求。
