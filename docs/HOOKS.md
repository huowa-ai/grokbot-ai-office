# CLI 钩子

有的 CLI 会在提交提示、调用工具、请求权限或停止时执行一条本地命令。`ai-relay hook` 把这些时刻写成状态事件，办公室就能显示 `working`、`waiting_approval` 或 `idle`，而不必猜输出。

钩子状态的 `source` 是 `hook`。它优先于根据输出猜出来的状态。没有钩子的 CLI 仍使用输出启发式，例如输出里出现「等待批准」时记为 `waiting_approval`。

成功时命令不往标准输出打印任何内容，这样不会干扰 Claude Code 自己的钩子协议。状态只写入事件日志。

## 事件对照

| 钩子名 | 状态 |
| --- | --- |
| `UserPromptSubmit`、`SessionStart` | `working` |
| `PreToolUse`、`PostToolUse`、`PostToolUseFailure` | `working` |
| `PermissionRequest` | `waiting_approval` |
| `Stop`、`SubagentStop`、`SessionEnd` | `idle` |
| `StopFailure` | `stuck`，错误码默认 `CLI_EXIT_NONZERO` |
| `Notification` | 文本像批准请求时才是 `waiting_approval`，否则忽略 |

名字不区分大小写，下划线也会被去掉。所以 `permission_request` 和 `PermissionRequest` 是同一件事。

实例用 `--instance provider@host`，或者设置 `RELAY_HOOK_INSTANCE`。也可以同时给 `--provider` 和 `RELAY_HOST`。提示如果出现在钩子的标准输入里，日志只留短预览，不留全文。

## Claude Code

写在本机的 `~/.claude/settings.json`，不要提交。下面的例子没有密钥。把 `claude@mac` 换成你的实例标识。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ai-relay hook user_prompt_submit --instance claude@mac"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ai-relay hook tool_use --instance claude@mac"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ai-relay hook permission_request --instance claude@mac"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ai-relay hook stop --instance claude@mac"
          }
        ]
      }
    ]
  }
}
```

Claude Code 还会把 JSON 写到标准输入，里面可能有 `tool_name`。`ai-relay hook` 会读它，用来做批准摘要。命令本身仍然不往标准输出写决定，所以它不会替你允许或拒绝工具调用。

## 其他 CLI

Claude Code 有完整的命令钩子。Codex、Gemini CLI 或其他工具如果提供「执行一条命令」的通知，也可以调用同一个 `ai-relay hook`。没有这种能力的 CLI 继续用管道或伪终端的输出启发式。

本机事件服务也接受同样的 JSON：

```bash
curl -s -X POST http://127.0.0.1:8787/hook \
  -H 'content-type: application/json' \
  -d '{"event":"permission_request","instance":"claude@mac","tool_name":"Bash"}'
```

如果设置了 `RELAY_SERVER_TOKEN`，加上 `Authorization: Bearer` 头。这个接口只追加状态，不会运行 AI。
