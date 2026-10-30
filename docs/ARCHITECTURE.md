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
┌────────────────────────────────────────────────┐
│ relay-cli       mcp-server       office-web    │  应用层：入口与界面
└───────┬──────────────┬──────────────┬──────────┘
        │ 调用          │ ask 调用      │ 只读事件
┌───────▼──────────────▼──────────────┐
│ packages/core                       │  核心层：中转流程、端口定义
│  - relay()                          │
│  - AdapterPort 接口                 │
└──┬────────────┬────────────┬────────┘
   │            │            │
┌──▼─────┐  ┌───▼────┐  ┌────▼───┐
│adapters│  │registry│  │ events │◄── 界面与事件服务只读   基础设施层
└────────┘  └────────┘  └────────┘
```

分三层的做法也与 microsoft/autogen 的 `autogen-core` / `autogen-ext` / `autogen-agentchat` 拆分一致：核心稳定、扩展可插拔、应用在最外层。

### 2.1 各包职责

| 包 | 职责 | 不做什么 |
| --- | --- | --- |
| `packages/core` | 接收提示，按注册表选适配器，执行调用，处理超时与错误，发出事件；定义 `AdapterPort`、`EventSink` 接口 | 不直接调用任何 CLI 或 HTTP |
| `packages/adapters` | 每个 AI 或每类接入方式一个适配器，实现 `AdapterPort` | 不读其他适配器，不写事件文件 |
| `packages/registry` | 读取并校验 `configs/providers.yaml`，返回类型化配置 | 不读取密钥的值，只记录变量名 |
| `packages/events` | 把 `core` 里的事件写入 JSONL，并提供读取 | 不含业务判断，不调用 AI |
| `apps/relay-cli` | 命令行入口 `ai-relay` | 不含中转逻辑，只组装依赖并调用 core |
| `apps/mcp-server` | MCP 入站适配器。`ask` 调用 `relay()`，并读事件快照 | 不接受命令参数，不按调用方的字符串起进程 |
| `apps/event-server` | 尾随事件日志，用 WebSocket 推送，提供 `GET /state` 和 `POST /hook` | 不调用 AI |
| `apps/office-web` | 将来的虚拟办公室界面 | 不调用 AI，只读事件 |

### 2.2 依赖方向（强制）

1. `apps → core`，应用层只依赖核心层的公开 API。
2. `core` 只依赖自己定义的接口；适配器、注册表、事件由应用层在启动时注入（依赖倒置）。（参考：domain-driven-hexagon，“Dependency rule”）
3. 适配器实现 `core` 中的 `AdapterPort`，**任何适配器不得导入另一个适配器**。
4. `office-web` 只依赖 `packages/events` 的读取接口，不依赖 `core` 和 `adapters`。`event-server` 也只读事件日志；唯一的写入是 `POST /hook`，它只追加状态，不运行 AI。`mcp-server` 可以调用 `relay()`，工具参数不能变成一条命令。
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

事件写入 JSONL，一行一个事件。默认路径是 `~/.grokbot-ai-office/events.jsonl`，可用 `RELAY_EVENTS_PATH` 覆盖。结构由 `packages/core` 的 zod schema 定义，版本号是 `v: 1`。现在还没有对外发布过事件，所以本阶段新增的类型仍使用 `v: 1`。以后再增加类型时升版本。

每条事件都有这些字段：

| 字段 | 含义 |
| --- | --- |
| `v` | 固定为 `1` |
| `id` | 事件 id |
| `ts` | ISO 8601 时间 |
| `type` | 事件类型 |
| `instance` | `provider@host`。未设置 `RELAY_HOST` 时只有提供者名字 |
| `provider` | 注册表里的名字 |
| `host` | 当时的 `RELAY_HOST`，未设置时为空字符串 |
| `taskId` | 可选。同一次调用或同一次交接的关联 id |
| `payload` | 跟 `type` 有关的内容 |

类型有六种：`started`、`replying_to`、`done`、`error`、`output_chunk`、`status`。

```json
{"v":1,"id":"8f0c","ts":"2026-10-30T08:00:00.000Z","type":"started","instance":"codex@mac","provider":"codex","host":"mac","taskId":"r_123","payload":{"promptPreview":"用一句话介绍…"}}
{"v":1,"id":"8f0d","ts":"2026-10-30T08:00:00.100Z","type":"status","instance":"codex@mac","provider":"codex","host":"mac","taskId":"r_123","payload":{"state":"working","source":"lifecycle","taskPreview":"用一句话介绍…"}}
{"v":1,"id":"8f0e","ts":"2026-10-30T08:00:00.100Z","type":"replying_to","instance":"codex@mac","provider":"codex","host":"mac","taskId":"r_123","payload":{"replyTo":"huowa"}}
{"v":1,"id":"8f0f","ts":"2026-10-30T08:00:01.000Z","type":"output_chunk","instance":"codex@mac","provider":"codex","host":"mac","taskId":"r_123","payload":{"seq":1,"text":"部分输出"}}
{"v":1,"id":"8f10","ts":"2026-10-30T08:00:41.000Z","type":"done","instance":"codex@mac","provider":"codex","host":"mac","taskId":"r_123","payload":{"durationMs":41000}}
{"v":1,"id":"8f11","ts":"2026-10-30T08:00:41.000Z","type":"status","instance":"codex@mac","provider":"codex","host":"mac","taskId":"r_123","payload":{"state":"idle","source":"lifecycle"}}
{"v":1,"id":"8f12","ts":"2026-10-30T08:01:05.000Z","type":"error","instance":"deepseek@cloud","provider":"deepseek","host":"cloud","taskId":"r_124","payload":{"code":"AUTH_MISSING","message":"DEEPSEEK_API_KEY 未设置","durationMs":10}}
{"v":1,"id":"8f13","ts":"2026-10-30T08:01:05.000Z","type":"status","instance":"deepseek@cloud","provider":"deepseek","host":"cloud","taskId":"r_124","payload":{"state":"stuck","source":"lifecycle","code":"AUTH_MISSING","reason":"DEEPSEEK_API_KEY 未设置"}}
```

`status.payload.state` 只能是 `idle`、`working`、`stuck`、`waiting_approval`、`handoff`。

- `stuck` 带 `code`（`RelayError` 错误码）和短 `reason`，并可以带终端尾部 `tail`。
- `waiting_approval` 带 `approvalId` 和 `summary`。
- `handoff` 带 `from`、`to` 和 `filePath`。`filePath` 是 `RELAY_WORKSPACE` 下的 `outbox/<to>/...`。
- `source` 是 `lifecycle`、`heuristic` 或 `hook`。钩子写来的状态优先于输出启发式。启发式只会把 `working` 推到 `waiting_approval`。一次调用以 `idle` 或 `stuck` 结束时，钩子锁定解除。

规则：

- 找到提供者之后才写事件。名字不存在、主机不一致时直接返回错误，不写事件。
- 一次成功调用的顺序是 `started`、`status working`、可选的 `replying_to`、若干 `output_chunk`、`done`、`status idle`。失败则在最后写 `error` 和 `status stuck`。
- `started.payload.promptPreview` 默认只保留提示的前 80 个字符，可用 `RELAY_PROMPT_PREVIEW_CHARS` 调整，最大 500。设为 `0` 则不记录预览。事件里不放完整提示。
- `output_chunk` 有从 1 开始的 `seq`。每段最多 1024 个字符，并且不超过 1024 字节。CLI 适配器按标准输出到达的顺序推送。HTTP 适配器通常把整段回答作为一块或数块推送。返回给调用方的最终回答仍是完整文本，不受分段影响。
- 疑似密钥在写入前替换成 `[REDACTED]`。
- 只追加，不修改。同一进程里的写入会排队；每次写入都是带换行的一整行。
- 最近 8192 字节的输出留在内存环里。失败时放进 `error` 和 `stuck` 的 `tail`。`GET /state` 的 `terminalTail` 给后加入的界面重放屏幕。

### 5.1 伪终端

`subscription` 可以写 `pty: true`。这时用 `node-pty` 跑命令，颜色和光标序列原样进入 `output_chunk`，留给第 4 步的 xterm.js。没写 `pty` 时仍用管道。`node-pty` 是可选依赖；加载失败就打一行日志并退回管道，不让这次调用失败。

超时、中止或进程退出时，结束整个进程组（POSIX 上对进程组发信号），而不只结束直接子进程。

### 5.2 交接与批准

`handoff(from, to, filePath, note)` 把文件复制到 `outbox/<to>/`，并写一条 `handoff` 状态。复制而不是做符号链接，这样源文件稍后被删，收件方仍留着副本。

`requestApproval(instance, summary)` 写 `waiting_approval`。`resolveApproval(id, approved)` 写回 `idle`，并带上 `approvalId` 和 `approved`。拒绝也记成 `idle`，避免和调用失败的 `stuck` 混在一起。

命令行：

```bash
ai-relay handoff codex@mac kimi@cloud ./notes.txt 请继续
ai-relay approval request claude@mac "允许读取仓库"
ai-relay approval resolve appr_123 false
ai-relay approval list
```

### 5.3 实时推送

`ai-relay serve` 或 `pnpm serve` 启动 `apps/event-server`。它尾随事件文件，把新事件从 WebSocket `/events` 推出去。`GET /state` 返回每个 `provider@host` 的当前状态、任务预览、最近若干块输出和 `terminalTail`。

默认只监听 `127.0.0.1:8787`。可用 `RELAY_SERVER_HOST` 和 `RELAY_SERVER_PORT` 改地址。绑到其他地址时必须设置 `RELAY_SERVER_TOKEN`。令牌一旦设置，本机请求也要带 `Authorization: Bearer <token>`，WebSocket 可以用 `?token=`。

`POST /hook` 是这个服务上唯一会写日志的入口。它只追加状态事件，不能启动 AI。钩子配置见 [HOOKS.md](./HOOKS.md)。

### 5.5 MCP

`ai-relay mcp` 启动 `apps/mcp-server`。它是另一个入站适配器：stdio，或默认绑定 `127.0.0.1:8788` 的 Streamable HTTP。工具 `ask` 只对注册表里的提供者调用 `relay()`，并写出同一套 `v: 1` 事件。`office_status` 读事件日志，快照与 `GET /state` 相同。非本机绑定必须设置 `RELAY_SERVER_TOKEN`，规则与 `ai-relay serve` 相同。说明见 [MCP.md](./MCP.md)。

### 5.4 命令行钩子

`ai-relay hook <事件> --instance <provider@host>` 给 Claude Code 这类 CLI 用。成功时标准输出保持空白，避免干扰对方自己的钩子协议。事件名会映射成上面的状态，例如 `UserPromptSubmit` 和 `PreToolUse` 是 `working`，`PermissionRequest` 是 `waiting_approval`，`Stop` 是 `idle`。没有钩子的 CLI 仍靠输出里的批准语句做启发式判断。

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
- `outbox/` 放准备交付的结果。`ai-relay handoff` 会把文件复制到 `outbox/<收件实例>/`。

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
5. CLI 适配器保留 stderr 前 2000 字符作为 `cause`，但须先过滤疑似密钥。失败事件里的 `tail` 同样先过滤。

## 9. 安全

- 密钥只放在 `.env` 或系统环境变量，永不写进仓库、配置文件或聊天。
- `.env.example` 只列变量名，值留空。
- 每个 `subscription` 提供者必须声明只读或安全模式参数。
- 日志与事件中不记录密钥，也不记录完整提示。提示只留可配置的短预览，输出只留有长度上限的分段。
- 共享工作目录（见第 6 节）不得写入密钥，并且不要提交。
- （参考：elsewhencode/project-guidelines“环境变量”一节；github/gitignore）

## 10. 虚拟办公室界面（后续）

`apps/office-web` 采用 bulletproof-react 的按功能分目录方式（`src/features/<功能>/`）。第 4 步会通过 `GET /state` 和 WebSocket `/events` 把每个 `provider@host` 显示为一个角色，并用 `terminalTail` 重放屏幕。例如 `codex@mac` 和 `codex@cloud` 是两个角色。界面不得调用 AI、不得读取密钥。（参考：alan2207/bulletproof-react `docs/project-structure.md`）
