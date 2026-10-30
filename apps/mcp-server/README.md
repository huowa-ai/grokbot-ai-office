# @grokbot-ai-office/mcp-server

把 `relay()`、事件日志和办公室快照暴露成 MCP 工具。本包是入站适配器，不另写一套中转规则。

## 公开 API

- `createRelayMcpServer(options)`：注册 `ask`、`list_agents`、`office_status`、`handoff`、`approval_request`、`approval_resolve`、`approval_list`
- `startMcpStdio(options)`：标准输入输出
- `startMcpHttp(options)`：Streamable HTTP，路径 `/mcp`
- `resolveMcpBind(env, flags)`：默认 `127.0.0.1:8788`

通常不直接跑这个包，而是用 `ai-relay mcp` 或 `ai-relay mcp --http`。说明见 `docs/MCP.md`。

绑定非本机地址时必须提供 `RELAY_SERVER_TOKEN`。令牌设置之后，本机请求也要带 `Authorization: Bearer <token>`。
