# @grokbot-ai-office/core

中转核心。定义端口和错误，执行 `relay()`。本包不调用 CLI，也不发 HTTP 请求。

## 公开 API

- `relay(request, dependencies)`：找不到提供者时返回 `PROVIDER_NOT_FOUND`。
- `RelayError`：带 `code`、`message`、`cause`、`isOperational`。
- `ERROR_CODES`：架构第 7 节规定的 9 个错误码。
- `AdapterPort`、`EventSink`、`RelayRequest`、`RelayResult`。

可预期错误通过 `RelayResult.error` 返回。未注入适配器这类程序错误会抛出 `isOperational: false` 的 `RelayError`。

## 示例

```ts
import { relay } from '@grokbot-ai-office/core';

const result = await relay(
  { provider: 'codex', prompt: '你好' },
  { hasProvider: () => false },
);

console.log(result.error?.code); // PROVIDER_NOT_FOUND
```
