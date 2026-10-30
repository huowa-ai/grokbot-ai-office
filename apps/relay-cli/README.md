# @grokbot-ai-office/relay-cli

命令行入口 `ai-relay <名字> <提示>`。这里只加载注册表、选择适配器并调用 `relay()`，不写中转规则。

在仓库根目录构建后：

```bash
pnpm --filter @grokbot-ai-office/relay-cli build
pnpm relay codex "你好"
```

提供者不存在时退出码为 1，并打印 `PROVIDER_NOT_FOUND`。骨架阶段已登记的提供者会打印适配器尚未实现的错误码，不会编造回答。
