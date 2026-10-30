# @grokbot-ai-office/events

把 `core` 定义的事件追加到 JSONL，并提供读取。本包不做中转判断，也不调用 AI。

## 公开 API

- `EVENT_TYPES`：`started`、`replying_to`、`done`、`error`、`output_chunk`、`status`。
- `relayEventSchema`、`RelayEvent`：从 core 重新导出。
- `createJsonlEventSink(file)`：校验、打码，然后追加一行。同一进程内的写入会排队。
- `readEvents(file)`：读回合法事件，跳过坏行。文件不存在时返回空数组。
- `defaultEventsPath()`：默认 `~/.grokbot-ai-office/events.jsonl`。
- `resolveEventsPath(env)`：优先使用 `RELAY_EVENTS_PATH`。

## 示例

```ts
import { createJsonlEventSink, resolveEventsPath } from '@grokbot-ai-office/events';

const sink = createJsonlEventSink(resolveEventsPath(process.env));
```
