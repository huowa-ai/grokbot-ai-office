# @grokbot-ai-office/registry

读取并校验 `configs/providers.yaml`，返回类型化配置。本包不读取环境变量里的密钥，只检查 `key_env` 是不是合法变量名。

## 公开 API

- `loadProvidersConfig(filePath)`：从 YAML 文件加载。
- `parseProvidersConfig(input)`：校验已经解析的对象。
- `providersFileSchema`：zod schema。
- `ProvidersConfigError`：校验失败。错误文本会隐藏 `sk-` 片段。
- `isAvailableOn(provider, host)`：未写 `hosts` 时任意主机可用；写了则只匹配列出的主机。
- `formatInstanceId` / `parseInstanceId`：`provider@host`，例如 `codex@mac`。
- `readRelayHost(env)`：读取 `RELAY_HOST`。空值视为未设置，非法名字直接报错。

## 校验

1. `subscription` 必须有 `command` 和 `safe_mode`。
2. `api_key` 的 `key_env` 必须是全大写加下划线的变量名，且不能像密钥。
3. `openai_compatible` 必须有 `base_url` 和 `model`。
4. 任意字符串只要像 `sk-` 开头的密钥，就拒绝。

## 示例

```ts
import { loadProvidersConfig } from '@grokbot-ai-office/registry';

const config = loadProvidersConfig('configs/providers.yaml');
console.log(config.providers.deepseek?.auth);
```
