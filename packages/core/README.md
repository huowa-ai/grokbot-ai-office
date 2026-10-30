# @grokbot-ai-office/core

中转核心。定义端口和错误，执行 `relay()`。本包不调用 CLI，也不发 HTTP 请求。

## 公开 API

- `relay(request, dependencies)`：按注入的注册表和适配器完成一次调用。
- `RelayError`：带 `code`、`message`、`cause`、`isOperational`。
- `ERROR_CODES`：架构第 8 节规定的 9 个错误码。
- `redactSecrets(text)`：把疑似密钥替换成 `[REDACTED]`。
- `noopEventSink`：空的事件槽。调用点会执行，但不会写 JSONL。
- `AdapterPort`、`EventSink`、`RelayRequest`、`RelayResult`。

`relay()` 的依赖由应用层注入：

1. `hasProvider`：注册表里有没有这个名字。没有则返回 `PROVIDER_NOT_FOUND`。
2. `requestedHost`：名字写成 `provider@host` 时的主机。与当前 `host` 不一致则返回 `CONFIG_INVALID`。
3. `isAvailableOnHost`：配置里的 `hosts` 是否允许当前主机。不允许则返回 `CONFIG_INVALID`。
4. `resolveAdapter`：按提供者配置创建适配器。
5. `events`：事件槽。不传时使用 `noopEventSink`。完整的 JSONL 写入留在下一步。

超时用 `AbortController`。成功时原样返回适配器文本。空文本返回 `EMPTY_RESPONSE`。可预期错误放在 `RelayResult.error` 里，不编造回答。

## 示例

```ts
import { noopEventSink, relay } from '@grokbot-ai-office/core';

const result = await relay(
  { provider: 'codex', prompt: '你好', timeoutMs: 30_000 },
  {
    hasProvider: (name) => name === 'codex',
    host: 'mac',
    events: noopEventSink,
    resolveAdapter: () => ({
      kind: 'cli',
      async call() {
        return '原文';
      },
      async selfcheck() {
        return { ok: true, detail: 'ok' };
      },
    }),
  },
);
```
