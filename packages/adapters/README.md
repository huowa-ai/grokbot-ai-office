# @grokbot-ai-office/adapters

按 `auth` 创建适配器。三个目录互不导入。HTTP 细节放在内部的 `src/http/`，不算一个适配器。

| 目录 | `auth` | 行为 |
| --- | --- | --- |
| `src/cli/` | `subscription` | 执行 `command`。工作目录是 `RELAY_WORKSPACE` |
| `src/official/` | `api_key` | 官方 HTTP。DeepSeek、Kimi、GLM、Anthropic、Gemini |
| `src/openai-compatible/` | `openai_compatible` | `POST {base_url}/chat/completions` |

## 公开 API

```ts
import { createAdapter, resolveWorkspace } from '@grokbot-ai-office/adapters';

const adapter = createAdapter(
  {
    auth: 'subscription',
    command: ['codex', 'exec', '--sandbox', 'read-only', '-'],
    input: 'stdin',
    safe_mode: '--sandbox read-only',
  },
  'codex',
  { env: process.env },
);

const answer = await adapter.call(
  { provider: 'codex', prompt: '你好' },
  new AbortController().signal,
);
const check = await adapter.selfcheck();
console.log(resolveWorkspace(process.env));
```

## CLI 适配器

1. `input` 省略时当作 `stdin`。`arg` 把提示追加为最后一个参数。`file` 把提示写到工作目录，并替换命令里的 `{file}`。
2. `safe_mode` 按空白拆开，每一段都必须出现在 `command` 里，否则返回 `CONFIG_INVALID`。
3. 调用前会创建 `shared/`、`agents/<provider>/`、`outbox/`。
4. `output_filter` 是正则。匹配到的行会从标准输出里去掉。
5. 找不到命令返回 `CLI_NOT_INSTALLED`。退出码非 0 返回 `CLI_EXIT_NONZERO`，`cause` 是脱敏后的 stderr 前 2000 个字符。没有输出返回 `EMPTY_RESPONSE`。中止返回 `TIMEOUT`。

## 官方 API 与 OpenAI 兼容

密钥只从 `process.env[key_env]` 读取。未设置返回 `AUTH_MISSING`。HTTP 401 或 403 返回 `AUTH_EXPIRED`。其他非 2xx 返回 `HTTP_ERROR`。

已接通的官方 vendor：

| vendor | 地址 | 默认模型 | 默认 `key_env` |
| --- | --- | --- | --- |
| `deepseek` | `https://api.deepseek.com` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `kimi` | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | `MOONSHOT_API_KEY` |
| `glm` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | `ZHIPU_API_KEY` |
| `anthropic` | `https://api.anthropic.com/v1/messages` | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `gemini-2.5-flash` | `GEMINI_API_KEY` |

Anthropic 使用 `x-api-key` 和 `anthropic-version: 2023-06-01`，请求体包含 `model`、`max_tokens`（4096）和 `messages`。Gemini 把密钥放在 `x-goog-api-key` 头里，不放进 URL。回答分别从 content 块和 `candidates[0].content.parts` 读取。

`selfcheck()` 只检查命令是否存在、变量是否已设置，以及对端点发一个不带密钥的 GET。单元测试不访问真实模型。
