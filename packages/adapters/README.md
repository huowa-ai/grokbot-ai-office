# @grokbot-ai-office/adapters

按 `auth` 返回适配器。三个目录互不导入。

| 目录 | `auth` | 当前状态 |
| --- | --- | --- |
| `src/cli/` | `subscription` | 占位，调用会抛出 `CLI_NOT_INSTALLED` |
| `src/official/` | `api_key` | 占位，调用会抛出 `HTTP_ERROR` |
| `src/openai-compatible/` | `openai_compatible` | 占位，调用会抛出 `HTTP_ERROR` |

## 公开 API

```ts
import { createAdapter } from '@grokbot-ai-office/adapters';

const adapter = createAdapter('subscription');
const check = await adapter.selfcheck();
```

骨架阶段 `selfcheck()` 只说明尚未实现，不会启动本机 CLI，也不会访问网络。
