# CLI hooks

Some CLIs run a local command when a prompt is submitted, a tool is used, permission is requested, or the turn stops. `ai-relay hook` turns those moments into status events, so the office can show `working`, `waiting_approval`, or `idle` without guessing from output.

Hook status uses `source: "hook"`. It wins over status guessed from output. CLIs without hooks still use that heuristic. For example, output that says "waiting for approval" becomes `waiting_approval`.

On success the command prints nothing to stdout, so it does not disturb Claude Code's own hook protocol. The status is written only to the event log.

## Event map

| Hook name | Status |
| --- | --- |
| `UserPromptSubmit`, `SessionStart` | `working` |
| `PreToolUse`, `PostToolUse`, `PostToolUseFailure` | `working` |
| `PermissionRequest` | `waiting_approval` |
| `Stop`, `SubagentStop`, `SessionEnd` | `idle` |
| `StopFailure` | `stuck`, default code `CLI_EXIT_NONZERO` |
| `Notification` | `waiting_approval` only when the text looks like an approval request; otherwise ignored |

Names are case-insensitive, and underscores are removed. `permission_request` and `PermissionRequest` are the same event.

Pass the instance with `--instance provider@host`, or set `RELAY_HOOK_INSTANCE`. You can also pass `--provider` together with `RELAY_HOST`. If the hook's stdin includes a prompt, the log keeps a short preview only.

## Claude Code

Put this in `~/.claude/settings.json` on your machine. Do not commit it. The example has no secrets. Replace `claude@mac` with your instance id.

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

Claude Code also writes JSON to stdin, which may include `tool_name`. `ai-relay hook` reads that and uses it as the approval summary. The command still does not print a decision to stdout, so it does not allow or deny the tool call for you.

## Other CLIs

Claude Code has full command hooks. If Codex, Gemini CLI, or another tool can run a command as a notification, it can call the same `ai-relay hook`. CLIs without that feature keep using the pipe or PTY output heuristic.

The local event server accepts the same JSON:

```bash
curl -s -X POST http://127.0.0.1:8787/hook \
  -H 'content-type: application/json' \
  -d '{"event":"permission_request","instance":"claude@mac","tool_name":"Bash"}'
```

If `RELAY_SERVER_TOKEN` is set, send `Authorization: Bearer`. This endpoint only appends status. It does not run an AI.
