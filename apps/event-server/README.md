# @grokbot-ai-office/event-server

尾随事件 JSONL，把新事件推给 WebSocket 客户端，并提供当前快照。本包不调用 AI。

## 公开 API

- `startEventServer({ eventsPath, host, port, token })`
- `GET /state`：每个 `provider@host` 的状态、任务预览、最近输出块和 `terminalTail`
- `WebSocket /events`：只推送连接之后的新事件
- `POST /hook`：把 CLI 钩子追加成状态事件。这是唯一的写入口

默认绑定 `127.0.0.1:8787`。监听其他地址时必须提供 `RELAY_SERVER_TOKEN`。令牌设置之后，本机请求也要带 `Authorization: Bearer <token>`。

通常不直接跑这个包，而是用 `ai-relay serve` 或 `pnpm serve`。
