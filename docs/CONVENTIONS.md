# 目录结构与工程规范

本文规定仓库目录、命名、提交、分支、测试和文档写法。所有人类和 AI 贡献者都要遵守。

## 1. 目录结构

```
grokbot-ai-office/
├── AGENTS.md              # 给 AI 编码助手的说明
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md           # 由 semantic-release 自动生成
├── .github/workflows/     # CI：lint、类型检查、测试、发版
├── .gitignore
├── .env.example           # 只列变量名
├── package.json           # 根脚本
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── packages/
│   ├── core/              # 中转核心与端口定义
│   ├── adapters/          # 各 AI 适配器
│   ├── registry/          # 注册表加载与校验
│   └── events/            # 状态事件
├── apps/
│   ├── relay-cli/         # ai-relay 命令
│   └── office-web/        # 虚拟办公室界面（后续）
├── configs/
│   └── providers.yaml     # AI 注册表
├── scripts/               # install、login、selfcheck
├── docs/                  # 架构与接入文档
└── tests/                 # 跨包集成测试与端到端测试
```

规则：

1. 可执行入口放 `apps/`，可复用库放 `packages/`。（参考：golang-standards/project-layout 的 `/cmd` 与 `/pkg`；vercel/turborepo 的 apps/packages 约定）
2. 配置模板放 `configs/`，脚本放 `scripts/`，文档放 `docs/`。（参考：project-layout 的 `/configs`、`/scripts`、`/docs`）
3. 根目录不建 `src/`；源码在各包自己的 `src/` 下。（参考：project-layout“Directories You Shouldn't Have”）
4. 单元测试与源码同包，放在 `packages/<包>/tests/`；跨包测试放根 `tests/`。
5. `apps/office-web/src/features/<功能>/` 按功能分目录，功能之间不互相导入。（参考：bulletproof-react `docs/project-structure.md`）

适配器目录：

```
packages/adapters/src/
├── cli/               # subscription：通用 CLI 执行器
├── official/          # api_key：deepseek、anthropic、gemini ……
├── openai-compatible/ # 通用 OpenAI 格式
└── index.ts           # 按 auth 字段返回适配器的工厂
```

## 2. 技术栈与工具

| 用途 | 选择 |
| --- | --- |
| 语言 | TypeScript（`strict: true`），Node.js 22 LTS |
| 包管理 | pnpm workspaces |
| 任务编排 | turborepo |
| 校验 | zod |
| 代码检查与格式化 | Biome（一个工具同时做 lint 和 format） |
| 测试 | vitest |
| 发版 | semantic-release |

根目录脚本：`pnpm install`、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm selfcheck [名字]`。

## 3. 命名规范

- 文件和目录：`kebab-case`，如 `openai-compatible.ts`。
- 类型、类、接口：`PascalCase`；接口不加 `I` 前缀。
- 变量、函数：`camelCase`；常量：`UPPER_SNAKE_CASE`。
- 环境变量：`UPPER_SNAKE_CASE`，项目专用的以 `RELAY_` 开头。
- 包名：`@grokbot-ai-office/<包名>`，如 `@grokbot-ai-office/core`。
- 注册表中的 AI 名字：小写加连字符，如 `ollama-local`。
- 事件类型：`snake_case`，如 `replying_to`。

（参考：nodebestpractices 第 3 节“代码风格”）

## 4. 提交信息

使用约定式提交（Conventional Commits 1.0.0）：

```
<类型>(<范围>): <简短描述>

[正文]

[脚注]
```

- 类型：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`ci`、`perf`。
- 范围用包名：`core`、`adapters`、`registry`、`events`、`relay-cli`、`office-web`、`configs`。
- 不兼容改动加 `!` 或脚注 `BREAKING CHANGE:`。
- 示例：`feat(adapters): 新增 openai-compatible 通用适配器`。

semantic-release 据此自动决定版本号：`fix` 升补丁号，`feat` 升次版本号，`BREAKING CHANGE` 升主版本号，并生成 `CHANGELOG.md`。（参考：conventional-commits 规范；semantic-release README）

## 5. 分支与 PR 流程

1. `main` 受保护，禁止直接推送。
2. 每项工作新建分支：`feat/<简述>`、`fix/<简述>`、`docs/<简述>`。
3. 写代码的云端 agent 在分支上提交并开 PR；由仓库主人审阅并合并。
4. PR 必须通过 CI（lint、typecheck、test），描述写清改了什么、怎么验证。
5. 一个 PR 只做一件事，尽量小。
6. 合并方式用 squash，标题即约定式提交信息。

（参考：elsewhencode/project-guidelines“Git”一节）

## 6. 测试

- 用 vitest；每个包至少覆盖公开 API。
- 测试名用三段式：被测对象、场景、预期。（参考：nodebestpractices 第 4 节）
- 适配器单元测试不调用真实 AI：CLI 用假命令（如 `echo`），HTTP 用 mock。
- 真实调用只在 `pnpm selfcheck` 中进行，不进 CI。
- 注册表校验必须测试：缺安全参数、`key_env` 写成密钥、未知 `auth` 都要报错。

## 7. 错误处理

- 只抛 `RelayError` 或其子类，带固定错误码，详见 `ARCHITECTURE.md` 第 6 节。
- `async` 函数一律 `await`，不留悬空 Promise。
- CLI 入口捕获所有错误，打印错误码和说明，以非零码退出。
- 禁止空 `catch`；禁止用默认文本冒充 AI 回答。

## 8. 密钥与安全

1. 密钥只放 `.env` 或环境变量；`.env` 已在 `.gitignore` 中。
2. `.env.example` 只写变量名：

   ```
   DEEPSEEK_API_KEY=
   ANTHROPIC_API_KEY=
   GEMINI_API_KEY=
   OPENROUTER_API_KEY=
   RELAY_EVENTS_PATH=
   ```

3. 不在 issue、PR、聊天、日志中粘贴密钥。
4. CI 中加入密钥扫描（如 gitleaks）。
5. 新增 `subscription` 提供者必须配置只读或安全模式参数。

## 9. 文档写作

中文文档遵循阮一峰《中文技术文档的写作规范》：

- 中英文之间加空格，如“调用 Codex 适配器”。
- 使用全角中文标点；代码、命令、路径用反引号。
- 标题层级不超过四级；步骤用有序列表。
- 每个包有自己的 `README.md`，说明用途、公开 API 和示例。

（参考：ruanyf/document-style-guide）

## 10. AGENTS.md

根目录的 `AGENTS.md` 面向 AI 编码助手，写明构建、测试和约束；修改脚本或规范时同步更新。（参考：agentsmd/agents.md）
