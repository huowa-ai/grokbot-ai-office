# @grokbot-ai-office/relay-cli

命令行入口 `ai-relay <名字> <提示>`。这里只加载注册表、选择适配器并调用 `relay()`，不写中转规则。

在仓库根目录构建后：

```bash
pnpm --filter @grokbot-ai-office/relay-cli build
pnpm relay codex "你好"
pnpm relay deepseek@cloud "你好"
echo "你好" | pnpm relay ollama-local
```

名字可以是 `provider`，也可以是 `provider@host`。`provider@host` 里的主机必须等于当前 `RELAY_HOST`，否则以 `CONFIG_INVALID` 退出。

提示写在参数里。省略提示时，从标准输入读取。成功时，回答原样写到标准输出。失败时，标准错误打印 `错误码 说明`，进程以非零码退出。

启动时会读取当前目录的 `.env`，但不会覆盖已经存在的环境变量。密钥不会打印出来。

调用会把事件追加到 `RELAY_EVENTS_PATH`，默认是 `~/.grokbot-ai-office/events.jsonl`。

```bash
ai-relay serve
ai-relay handoff codex@mac kimi@cloud ./notes.txt 请继续
ai-relay approval request claude@mac "允许读取仓库"
ai-relay approval resolve <id> true
ai-relay approval list
ai-relay hook stop --instance claude@mac
```

`serve`、`handoff`、`approval`、`hook` 是保留的子命令，不能当作提供者名字。`hook` 成功时不打印标准输出，方便接到 Claude Code 的钩子里。详见 `docs/HOOKS.md`。

## 自检

`pnpm selfcheck` 检查全部提供者，`pnpm selfcheck deepseek` 只检查一个。它会打印一张表：命令是否存在、变量是否设置、端点是否可达。探测请求不携带密钥。自检不进入 CI。
