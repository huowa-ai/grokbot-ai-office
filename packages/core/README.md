# @grokbot-ai-office/core

中转核心。定义端口、事件 schema 和错误，执行 `relay()`。本包不调用 CLI，也不发 HTTP 请求。

## 公开 API

- `relay(request, dependencies)`：按注入的注册表和适配器完成一次调用，并写出 `started`、`status`、`output_chunk`、`done` 或 `error`。
- `relayEventSchema`：事件的 zod schema，`v` 固定为 `1`。
- `handoff`、`requestApproval`、`resolveApproval`、`listApprovals`：交接文件和批准事项。
- `planHook`：把 CLI 钩子映射成状态事件。钩子优先于输出启发式。
- `reduceEvents`：把事件折成每个 `provider@host` 的当前快照，包含最近 8KB 终端尾部。
- `RelayError` 和 `ERROR_CODES`。
- `redactSecrets(text)`：把疑似密钥替换成 `[REDACTED]`。
- `noopEventSink`：空的事件槽。应用层应注入 JSONL 实现。
- `AdapterPort`、`EventSink`、`RelayRequest`、`RelayResult`。

`RelayRequest.onOutputChunk` 用来接收适配器推来的输出。最终回答仍是 `call()` 的返回值。

提示预览默认 80 个字符，上限 500，由 `promptPreviewChars` 或 `RELAY_PROMPT_PREVIEW_CHARS` 控制。输出分段默认不超过 1024 字符，同时不超过 1024 字节。
