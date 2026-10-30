# 架构设计规范与分层

本文说明 grokbot-ai-office 的整体架构、分层规则和三种接入方式。新增功能或接入新 AI 之前，请先读完本文。

## 1. 项目目标

grokbot-ai-office 是一个多 AI 协作办公室：任何 AI 都能以同一种方式接入 Grok Bot 群聊，并在实时的虚拟办公室界面里看到每个 AI 在做什么。

项目分两层：

1. 中转层是底座。`ai-relay`、注册表、适配器和状态事件把 Codex、CodeBuddy、Hermes、OpenClaw、DeepSeek、Claude、本地模型等接入 Grok Bot 群聊，并记下每个 AI 正在做什么。
2. 虚拟办公室界面是前端。它读取中转层的实时状态，展示每个 AI 正在做什么。

设计目标：

1. 接入一个新 AI，只需要加一行配置，不改核心代码。
2. 出错如实报告，不编造回答。
3. 密钥永不进仓库。
4. 界面只读状态事件，与中转逻辑解耦。

## 2. 分层总览

采用端口与适配器（六边形）架构：核心逻辑定义接口（端口），外部 AI 以适配器实现接口。（参考：sairyss/domain-driven-hexagon，“Ports and Adapters” 一节）

```
┌──────────────────────────────────────────┐
│ apps/relay-cli      apps/office-web      │  应用层：入口与界面
└───────┬───────────────────────┬──────────┘
        │ 调用                   │ 只读事件
┌───────▼──────────────┐        │
│ packages/core        │        │           核心层：中转流程、端口定义
│  - relay()           │        │
│  - AdapterPort 接口  │        │
└──┬────────┬────────┬─┘        │
   │        │        │          │
┌──▼─────┐┌─▼──────┐┌▼────────┐ │
│adapters││registry││ events  │◄┘           基础设施层
└────────┘└────────┘└─────────┘
```

分三层的做法也与 microsoft/autogen 的 `autogen-core` / `autogen-ext` / `autogen-agentchat` 拆分一致：核心稳定、扩展可插拔、应用在最外层。

### 2.1 各包职责

| 包 | 职责 | 不做什么 |
| --- | --- | --- |
| `packages/core` | 接收提示，按注册表选适配器，执行调用，处理超时与错误，发出事件；定义 `AdapterPort`、`EventSink` 接口 | 不直接调用任何 CLI 或 HTTP |
| `packages/adapters` | 每个 AI 或每类接入方式一个适配器，实现 `AdapterPort` | 不读其他适配器，不写事件文件 |
| `packages/registry` | 读取并校验 `configs/providers.yaml`，返回类型化配置 | 不读取密钥的值，只记录变量名 |
| `packages/events` | 定义事件结构，写入 JSONL 日志，提供读取/订阅 | 不含业务判断 |
| `apps/relay-cli` | 命令行入口 `ai-relay <名字> <提示>` | 不含中转逻辑，只组装依赖并调用 core |
| `apps/office-web` | 将来的虚拟办公室界面 | 不调用 AI，只读事件 |

### 2.2 依赖方向（强制）

1. `apps → core`，应用层只依赖核心层的公开 API。
2. `core` 只依赖自己定义的接口；适配器、注册表、事件由应用层在启动时注入（依赖倒置）。（参考：domain-driven-hexagon，“Dependency rule”）
3. 适配器实现 `core` 中的 `AdapterPort`，**任何适配器不得导入另一个适配器**。
4. `office-web` 只依赖 `packages/events` 的读取接口，不依赖 `core` 和 `adapters`。
5. 禁止循环依赖，CI 中用依赖检查（如 `dependency-cruiser` 或 eslint `import/no-restricted-paths`）强制。

### 2.3 包内结构

每个包按组件自包含，对外只暴露 `src/index.ts`。（参考：goldbergyoni/nodebestpractices 1.1“按业务组件组织”、1.2“分层组件”）

```
packages/core/
├── src/
│   ├── index.ts          # 唯一公开出口
│   ├── relay.ts          # 中转主流程
│   ├── ports.ts          # AdapterPort、EventSink 接口
│   └── errors.ts         # 错误类型
├── tests/
└── package.json
```

## 3. 核心接口

```ts
// packages/core/src/ports.ts
export interface RelayRequest {
  provider: string;      // 注册表中的名字，如 "codex"
  prompt: string;
  replyTo?: string;      // 正在回复谁（群成员或消息 id）
  timeoutMs?: number;
}

export interface RelayResult {
  ok: boolean;
  text?: string;         // 原样转发的回答
  error?: RelayError;
  durationMs: number;
}

export interface AdapterPort {
  readonly kind: 'cli' | 'http';
  call(req: RelayRequest, signal: AbortSignal): Promise<string>;
  selfcheck(): Promise<{ ok: boolean; detail: string }>;
}

export interface EventSink {
  emit(event: RelayEvent): Promise<void>;
}
```

中转主流程：

1. 从注册表取配置，找不到则返回 `PROVIDER_NOT_FOUND`。
2. 发出 `started` 事件；若有 `replyTo`，发出 `replying_to`。
3. 调用适配器，超时由 `AbortController` 控制。
4. 成功发出 `done`，失败发出 `error`，并返回原始错误信息，不编造回答。

## 4. 三种接入方式（设计核心）

注册表中每个 AI 必须声明 `auth` 字段，核心据此选择适配器。

| `auth` | 适配器 | 凭证位置 | 适用 |
| --- | --- | --- | --- |
| `subscription` | CLI 适配器，调用已登录的本地 CLI | 各 CLI 自己的登录文件，仓库不碰 | Codex、CodeBuddy、Hermes、OpenClaw |
| `api_key` | 官方 API 适配器 | 环境变量，配置里只写 `key_env` | DeepSeek、Anthropic、Gemini、Kimi、GLM、MiniMax、OpenRouter |
| `openai_compatible` | 通用 OpenAI 格式适配器 | `base_url` + 可选 `key_env` | 中转站、OpenRouter、本地 Ollama |

### 4.1 注册表示例

```yaml
# configs/providers.yaml
version: 1
defaults:
  timeout_ms: 180000

providers:
  codex:
    auth: subscription
    command: ["codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check", "-"]
    input: stdin
    safe_mode: "--sandbox read-only"

  codebuddy:
    auth: subscription
    command: ["codebuddy", "-p", "--permission-mode", "plan"]
    input: arg
    safe_mode: "--permission-mode plan"

  hermes:
    auth: subscription
    command: ["hermes", "-m", "gpt-5.6-sol", "--provider", "openai-codex", "-z"]
    input: arg
    safe_mode: "-z"

  openclaw:
    auth: subscription
    command: ["openclaw", "agent", "--local", "--message-file", "{file}", "--session-id", "grokbot-group"]
    input: file
    output_filter: "^\\["      # 去掉以 [ 开头的日志行
    safe_mode: "--local"

  deepseek:
    auth: api_key
    vendor: deepseek
    model: deepseek-chat
    key_env: DEEPSEEK_API_KEY

  ollama-local:
    auth: openai_compatible
    base_url: http://localhost:11434/v1
    model: qwen2.5:7b
    key_env: null
```

校验规则（`packages/registry` 用 zod 实现）：

- `subscription` 必须有 `command` 和 `safe_mode`；缺少安全参数视为配置错误。
- `api_key` 必须有 `key_env`，且值必须是变量名（全大写加下划线），不能像密钥。
- `openai_compatible` 必须有 `base_url` 和 `model`。
- 发现疑似密钥的字符串（如 `sk-` 开头）时直接报错。

### 4.2 接入新 AI 的固定流程

1. 选择三种接入方式之一。
2. 在 `configs/providers.yaml` 加一段配置。
3. 订阅方式去登录 CLI；密钥方式在本机 `.env` 填变量。
4. 运行 `pnpm selfcheck <名字>`。
5. 创建中转 bot，加入群聊。

只有出现前三种都覆盖不了的接入方式时，才新增适配器代码。

## 5. 状态事件

事件写入 JSONL，一行一个事件，默认路径 `~/.grokbot-ai-office/events.jsonl`（可用 `RELAY_EVENTS_PATH` 覆盖）。

```json
{"v":1,"id":"01J9Z…","ts":"2026-10-30T14:20:00+08:00","provider":"codex","host":"mac","type":"started","requestId":"r_123"}
{"v":1,"id":"01J9Z…","ts":"2026-10-30T14:20:00+08:00","provider":"codex","host":"mac","type":"replying_to","requestId":"r_123","replyTo":"huowa"}
{"v":1,"id":"01J9Z…","ts":"2026-10-30T14:20:41+08:00","provider":"codex","host":"mac","type":"done","requestId":"r_123","durationMs":41000}
{"v":1,"id":"01J9Z…","ts":"2026-10-30T14:21:05+08:00","provider":"deepseek","host":"cloud","type":"error","requestId":"r_124","error":{"code":"AUTH_MISSING","message":"DEEPSEEK_API_KEY 未设置"}}
```

规则：

- 类型只有 `started`、`replying_to`、`done`、`error` 四种；新增类型需升 `v`。
- 每条事件都带 `host`，取值是当时的 `RELAY_HOST`。未设置时为空字符串。这仍是 `v: 1`，因为还没有任何已发布的事件。
- 事件不包含提示原文和回答原文，只含元数据，避免泄露。
- 只追加，不修改；界面按 `requestId` 聚合。

## 6. 共享工作目录

多个 agent 要交换文件时，使用同一套工作目录，而不是各自写到临时路径。路径只来自环境变量，不写入 `configs/providers.yaml`。

### 6.1 同一台机器

一台机器上的所有 agent 共用一个目录。目录由环境变量 `RELAY_WORKSPACE` 指定，默认是 `~/.grokbot-ai-office/workspace`。`ai-relay` 调用每个适配器时，都把当前工作目录设为这个路径。`subscription` 方式的 CLI 在该目录内执行；HTTP 适配器也可以在这里读写文件。

建议布局：

```
~/.grokbot-ai-office/
├── events.jsonl                 # 状态事件，默认路径不变
└── workspace/                   # RELAY_WORKSPACE 的默认位置
    ├── shared/                  # 公共文件
    ├── agents/
    │   └── <provider>/          # 某个 AI 的草稿，例如 agents/codex/
    └── outbox/                  # 待交付的结果
```

- `shared/` 放所有 agent 都能读写的公共文件。
- `agents/<provider>/` 放该 AI 自己的草稿。`<provider>` 使用注册表中的名字，例如 `codex`。
- `outbox/` 放准备交付的结果。

状态事件默认仍写到 `~/.grokbot-ai-office/events.jsonl`，可用 `RELAY_EVENTS_PATH` 覆盖。事件文件和工作目录都位于 `~/.grokbot-ai-office/` 下，事件不写入 `workspace/`。

### 6.2 跨机器

使用者自己的 Mac 与云端环境不共享上述本地目录。GitHub 仓库是唯一的事实来源，每台机器通过分支和 PR 拉取、推送。体积大的临时二进制（图片、导出包）暂不放进仓库。以后如有需要，可以再增加一个网盘目录。

### 6.3 安全

- 工作目录中不得放入密钥、token 或 cookie。
- `.gitignore` 排除 `workspace/`，避免把本机文件提交进仓库。
- `subscription` 适配器仍然必须声明 `safe_mode`。

## 7. 本地与云端实例

注册表按 AI 名字共享，不按机器拆成两份。`codex`、`codebuddy`、`hermes`、`openclaw` 在 Mac 和云端用的是同一份 `configs/providers.yaml`。

机器身份来自环境变量 `RELAY_HOST`。用户的 Mac 写 `mac`，云端环境写 `cloud`。`ai-relay` 在启动时读取它。名字必须是小写字母、数字和连字符。

对外的完整标识是 `<provider>@<host>`，例如 `codex@mac`、`codex@cloud`。

Grok Bot 里的中转 bot 与实例标识对应如下：

| 群里的名字 | 实例标识 |
| --- | --- |
| 本地 Codex | `codex@mac` |
| 云端 Codex | `codex@cloud` |
| 本地 WorkBuddy | `codebuddy@mac` |
| 云端 WorkBuddy | `codebuddy@cloud` |
| 本地 Hermes | `hermes@mac` |
| 云端 Hermes | `hermes@cloud` |
| 本地小龙虾 | `openclaw@mac` |
| 云端小龙虾 | `openclaw@cloud` |

某个提供者如果只能在部分机器上运行，就加上可选字段 `hosts`。不写 `hosts` 表示所有主机都可用；写了就只在列出的主机上可用。

```yaml
codex:
  auth: subscription
  hosts: ["mac"]
```

虚拟办公室把每个 `provider@host` 显示成一个独立角色。同一份 `codex` 配置在两台机器上，会显示成两个角色。

## 8. 错误处理

（参考：nodebestpractices 第 2 节“错误处理”）

1. 统一使用 `RelayError`（继承 `Error`），带 `code`、`message`、`cause`、`isOperational`。
2. 错误码固定：`PROVIDER_NOT_FOUND`、`CONFIG_INVALID`、`AUTH_MISSING`、`AUTH_EXPIRED`、`TIMEOUT`、`CLI_NOT_INSTALLED`、`CLI_EXIT_NONZERO`、`HTTP_ERROR`、`EMPTY_RESPONSE`。
3. 运行时可预期的错误（超时、未登录）返回给调用方并写事件；程序错误（bug）直接抛出并退出非零码。
4. 永不吞错误，永不用默认文本冒充回答。
5. CLI 适配器保留 stderr 前 2000 字符作为 `cause`，但须先过滤疑似密钥。

## 9. 安全

- 密钥只放在 `.env` 或系统环境变量，永不写进仓库、配置文件或聊天。
- `.env.example` 只列变量名，值留空。
- 每个 `subscription` 提供者必须声明只读或安全模式参数。
- 日志与事件中不记录密钥、提示原文。
- 共享工作目录（见第 6 节）不得写入密钥，并且不要提交。
- （参考：elsewhencode/project-guidelines“环境变量”一节；github/gitignore）

## 10. 虚拟办公室界面（后续）

`apps/office-web` 采用 bulletproof-react 的按功能分目录方式（`src/features/<功能>/`），通过读取事件日志（或后续的 SSE 接口）把每个 `provider@host` 显示为一个角色。例如 `codex@mac` 和 `codex@cloud` 是两个角色。界面不得调用 AI、不得读取密钥。（参考：alan2207/bulletproof-react `docs/project-structure.md`）
