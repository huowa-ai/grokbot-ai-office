# @grokbot-ai-office/events

状态事件的类型和路径。本包不做中转判断。写入 JSONL 与订阅留在后续步骤，避免现在就产生事件日志。

## 公开 API

- `EVENT_TYPES`：`started`、`replying_to`、`done`、`error`。
- `StatusEvent`：事件结构。不含提示原文和回答原文。
- `defaultEventsPath()`：默认 `~/.grokbot-ai-office/events.jsonl`。
- `resolveEventsPath(env)`：优先使用 `RELAY_EVENTS_PATH`。

## 示例

```ts
import { resolveEventsPath } from '@grokbot-ai-office/events';

const file = resolveEventsPath(process.env);
```
