# ai-relay MCP server

`ai-relay mcp` exposes the relay as an [MCP](https://modelcontextprotocol.io) server. A relay bot in Grok Bot calls the `ask` tool instead of assembling a shell command.

The server is an inbound adapter. It calls `relay()`, the event log, and the office snapshot in `packages/core`. The only AIs it can call are names registered in `configs/providers.yaml`. Tool arguments have no command field. A string from the caller is never started as a process.

## Run

Install and build first: `pnpm install`, then `pnpm build`. Keep secrets in a local `.env`. Do not commit that file.

### stdio

```bash
ai-relay mcp
```

Stdout is reserved for the MCP protocol. Logs go to stderr. This fits a client that can spawn a local process:

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

The process working directory must be able to see `configs/providers.yaml`. That directory is the one the client uses when it starts the process.

### Streamable HTTP

```bash
ai-relay mcp --http
```

The default bind is `127.0.0.1:8788` and the path is `/mcp`. The URL is `http://127.0.0.1:8788/mcp`.

```bash
ai-relay mcp --http --host 127.0.0.1 --port 8788
```

| Variable or flag | Role |
| --- | --- |
| `--host`, `RELAY_SERVER_HOST` | Bind address. Default `127.0.0.1` |
| `--port`, `RELAY_MCP_PORT` | Port. Default `8788`, separate from the event server's `8787` |
| `RELAY_SERVER_TOKEN` | Bearer token. The same variable as `ai-relay serve` |

Binding any address other than `127.0.0.1`, `localhost`, or `::1` requires `RELAY_SERVER_TOKEN`. Without it the process exits. Once a token is set, local requests must send it too:

```
Authorization: Bearer <token>
```

The token is not accepted in the query string, so it does not land in access logs. Read it from the environment. Do not put it in config, chat, or command-line arguments.

## Tools

`provider` is a registry name such as `codex`, or `provider@host` such as `codex@mac`. The host in `provider@host` must equal the current `RELAY_HOST`. A provider that sets `hosts` runs only on those machines. The timeout is the registry `timeout_ms`. A `subscription` provider still needs `safe_mode`.

`ask` writes the same events as the CLI. The version stays `v: 1`: `started`, `status` (`working`), zero or more `output_chunk` events, then `done` and `status` (`idle`). Failure writes `error` and `status` (`stuck`). Likely secrets are replaced with `[REDACTED]` before they are stored. The text returned to the client is redacted the same way.

When the client sends a progress token, each `output_chunk` becomes an MCP progress notification. With no token, no notification is sent.

| Tool | Role |
| --- | --- |
| `ask` | Arguments `provider`, `prompt`, and optional `taskId`. On success the result is `text`, `instance` (`provider@host`), and `taskId` |
| `list_agents` | Registry name, `auth`, `hosts`, the instance name on this machine, and whether it is usable on the current host |
| `office_status` | The same per-instance snapshot as `GET /state`: status, last activity, and a capped `terminalTail`. Also includes `pendingApprovals` |
| `handoff` | Copies a file into `outbox/<recipient>/` in the workspace. It does not execute the file |
| `approval_request` | Records a pending approval |
| `approval_resolve` | Approves or denies. `approved` is `true` or `false` |
| `approval_list` | Lists every approval record |

On failure the tool result has `isError` set, and the text is `CODE message`, for example `PROVIDER_NOT_FOUND 未找到提供者：missing-bot`. The code is the `RelayError` code. The server does not invent an answer.

`list_agents` does not return the command line, `key_env`, or `base_url`.

## Add it in Grok Bot

A relay bot adds this server as a custom connector (链接应用) and then calls `ask`. This repository has not walked through that flow on a live Grok Bot. The steps below follow public descriptions. Use the labels you actually see.

Public descriptions usually say: tell the bot, in chat, to add an MCP server and give it a Streamable HTTP URL such as `https://example.example/mcp`. Some connector pages also offer a custom option with a URL field. Tools show up on the next turn.

Grok Bot runs in the cloud. It cannot open `127.0.0.1` on a person's Mac. Reaching a server on that Mac needs a tunnel the person runs, exposing local `/mcp` as public HTTPS, or a client that can start a connector on the machine. Neither path has been verified in this project.

stdio `ai-relay mcp` works only for a client that can spawn a process on the same machine. A cloud Grok Bot does not start that command on the person's Mac.

A non-local bind requires `RELAY_SERVER_TOKEN`. Do not paste the token into chat. Public descriptions also say custom connectors may authenticate only with OAuth and may not send a custom `Authorization` header. That is unverified too. If Grok Bot cannot send the Bearer token, do not expose the server on the public internet.

## Sample relay-bot instruction

Put this in the relay bot's instructions. It calls tools instead of building a shell command.

```text
You are a relay bot. When another AI needs to do something, call MCP tools only. Do not run a shell, do not assemble an ai-relay command, and do not read environment variables.

1. Call list_agents first. Ask only instances whose usable field is true.
2. Call ask. provider is a registry name. prompt is the question. Pass taskId when several calls belong to one task.
3. On success, structuredContent.text is the answer and instance is provider@host. On failure the text starts with an error code. Report that code as-is. Do not invent an answer.
4. Before you reply, call office_status. Read each instance status and any pendingApprovals.
5. Do not put secrets in the prompt or the chat.
```

## Security

- Only registered providers can be called. An unknown name returns `PROVIDER_NOT_FOUND` and is not executed.
- Timeouts, `hosts`, and `RELAY_HOST` match the CLI.
- Events, progress notifications, and tool results use the existing redaction. Logs do not record prompts, tokens, or secrets.
- stdio has no network authentication. It is the process's own stdin and stdout. Do not hand that process to an untrusted user.
- HTTP binds to loopback by default. Any other address requires `RELAY_SERVER_TOKEN`.
- `RELAY_WORKSPACE` must not hold secrets. Do not commit `.env`, event logs, or the workspace.
