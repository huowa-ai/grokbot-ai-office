# ai-relay MCP 服务器

`ai-relay mcp` 把中转做成 [MCP](https://modelcontextprotocol.io) 服务器。Grok Bot 里的中转 bot 调用工具 `ask`，不再自己拼接 Shell 命令。

服务器是入站适配器。它只调用 `packages/core` 的 `relay()`、事件日志和办公室快照。能问的 AI 只有 `configs/providers.yaml` 里登记过的名字。工具参数里没有命令字段，不会按调用方给的字符串起进程。

## 启动

需要先完成本地安装：`pnpm install` 然后 `pnpm build`。密钥放在本机 `.env`，不要写进仓库。

### 标准输入输出

```bash
ai-relay mcp
```

标准输出只留给 MCP 协议。日志走标准错误。适合和本机进程连在一起的客户端，例如：

```json
{
  "mcpServers": {
    "ai-relay": {
      "command": "ai-relay",
      "args": ["mcp"]
    }
  }
}
```

这条命令和 `configs/providers.yaml` 要在同一个工作目录里能找到。客户端启动进程时的当前目录，就是读取注册表的目录。

### Streamable HTTP

```bash
ai-relay mcp --http
```

默认监听 `127.0.0.1:8788`，路径是 `/mcp`。完整地址是 `http://127.0.0.1:8788/mcp`。

```bash
ai-relay mcp --http --host 127.0.0.1 --port 8788
```

| 变量或参数 | 作用 |
| --- | --- |
| `--host`、`RELAY_SERVER_HOST` | 绑定地址，默认 `127.0.0.1` |
| `--port`、`RELAY_MCP_PORT` | 端口，默认 `8788`。与事件服务的 `8787` 分开 |
| `RELAY_SERVER_TOKEN` | Bearer 令牌。和 `ai-relay serve` 用同一个变量 |

绑定 `127.0.0.1`、`localhost`、`::1` 以外的地址时，必须设置 `RELAY_SERVER_TOKEN`，否则进程直接退出。令牌一旦设置，本机请求也要带请求头：

```
Authorization: Bearer <令牌>
```

这里不接受查询字符串里的令牌，避免它出现在访问日志里。令牌只放环境变量，不要写进配置、聊天或命令行参数。

## 工具

`provider` 只能是注册表里的名字，例如 `codex`，或者 `provider@host`，例如 `codex@mac`。`provider@host` 里的主机必须等于当前 `RELAY_HOST`。写了 `hosts` 的提供者，只在列出的机器上可用。超时用注册表的 `timeout_ms`。`subscription` 仍然必须有 `safe_mode`。

一次 `ask` 写出的事件和命令行相同，版本仍是 `v: 1`：`started`、`status`（working）、若干 `output_chunk`、然后 `done` 与 `status`（idle），失败则是 `error` 与 `status`（stuck）。疑似密钥在写入前打成 `[REDACTED]`。返回给客户端的正文也会打码。

客户端如果在调用里带了进度令牌，每个 `output_chunk` 会发一条 MCP 进度通知。没有进度令牌时不发。

| 工具 | 作用 |
| --- | --- |
| `ask` | 参数 `provider`、`prompt`，可选 `taskId`。成功时返回 `text`、`instance`（`provider@host`）和 `taskId` |
| `list_agents` | 注册表里的名字、`auth`、`hosts`、本机实例名，以及当前主机上是否可用 |
| `office_status` | 与 `GET /state` 相同的实例快照：状态、最近活动、有长度上限的 `terminalTail`。另附 `pendingApprovals` |
| `handoff` | 把文件复制到工作目录的 `outbox/<收件实例>/`。不执行文件 |
| `approval_request` | 记一条待批准事项 |
| `approval_resolve` | 同意或拒绝。`approved` 为 `true` 或 `false` |
| `approval_list` | 列出全部批准事项 |

失败时工具结果的 `isError` 为真，正文是 `错误码 说明`，例如 `PROVIDER_NOT_FOUND 未找到提供者：missing-bot`。错误码和 `RelayError` 一致。服务器不编造回答。

`list_agents` 不返回命令行、`key_env` 或 `base_url`。

## 在 Grok Bot 里添加

中转 bot 把这个服务器加为自定义链接应用（custom connector），然后调用 `ask`。本仓库没有在真实的 Grok Bot 里走过添加流程，下面按公开描述来写，以你自己界面上的文字为准。

公开资料里常见的加法是：在 bot 对话里说明要添加一个 MCP 服务器，并给出 Streamable HTTP 地址，例如 `https://example.example/mcp`。也有连接器页面让人选择自定义并填写 URL。添加之后，下一轮对话才能用这些工具。

Grok Bot 跑在云端。用户 Mac 上的 `127.0.0.1` 它访问不到。要让云端 bot 调用这台 Mac，需要用户自己准备一条隧道，把本机 `/mcp` 暴露成公网 HTTPS；或者客户端支持在本机拉起连接器。这两种做法都还没有在本项目里验证。

`ai-relay mcp` 这种 stdio 方式，只在能够于同一台机器上启动进程的客户端里可用。云端的 Grok Bot 不会在用户的 Mac 上启动这条命令。

非本机绑定必须设置 `RELAY_SERVER_TOKEN`。不要把令牌贴进聊天。公开资料还提到，自定义连接器可能只走 OAuth，发不出自定义的 `Authorization` 头。这一点同样没有验证。如果 Grok Bot 发不出 Bearer，就不要把服务暴露到公网。

## 中转 bot 说明示例

把下面这段写进中转 bot 的说明。它用工具提问，不再拼 Shell。

```text
你是中转 bot。需要其他 AI 做事时，只调用 MCP 工具。不要执行 shell，不要拼接 ai-relay 命令，不要读取环境变量。

1. 先调用 list_agents。只向 usable 为 true 的实例提问。
2. 用 ask 提问。provider 填注册表里的名字，prompt 填要问的内容。同一次任务要串起来时，再传 taskId。
3. ask 成功时，structuredContent.text 才是对方的回答，instance 是 provider@host。失败时正文以错误码开头。把错误码原样告诉用户，不要编造回答。
4. 回复用户之前，调用 office_status，看每个实例的状态，以及 pendingApprovals 里有没有待批准事项。
5. 不要把密钥写进提示或聊天。
```

## 安全

- 只调用注册表里的提供者。未知名字返回 `PROVIDER_NOT_FOUND`，不会当命令执行。
- 超时、`hosts` 和 `RELAY_HOST` 与命令行一致。
- 事件、进度通知和工具返回值都走现有的打码。日志不记录提示、令牌或密钥。
- stdio 没有网络鉴权，因为它只是本进程的标准输入输出。不要把这个进程交给不信任的用户。
- HTTP 默认只绑本机。暴露到其他地址时必须有 `RELAY_SERVER_TOKEN`。
- 工作目录 `RELAY_WORKSPACE` 不放密钥。不要提交 `.env`、事件日志或工作目录。
