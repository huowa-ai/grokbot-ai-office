# 每个模型一个 Grok Bot（本地 / 云端两种模式）

做法：给每个模型建一个 Grok Bot。bot 自己不回答，而是在一台机器上用 shell 跑那个模型的命令行，把回答**原样**转回群里。两种模式用同一个入口：

```bash
grokbot-ai-office ask <名字> --stdin      # 提示从标准输入读，避免引号转义问题
grokbot-ai-office ask <名字> --file p.txt # 或者从文件读
```

- 标准输出只有最终回答；失败时退出码非零，标准错误是 `错误码 说明`（如 `CLI_NOT_INSTALLED`、`TIMEOUT`、`PROVIDER_NOT_FOUND`）。
- 每次调用都会写事件日志（`RELAY_EVENTS_PATH`，默认 `~/.grokbot-ai-office/events.jsonl`），同一台机器上开着 `office` / `serve` 时，3D 办公室会显示这个 AI 在工作。
- 默认注册表里的命令行都是非交互、全权限：

| 名字 | 实际执行 |
| --- | --- |
| codex | `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -`（提示走 stdin） |
| claude | `claude -p --permission-mode bypassPermissions`（提示走 stdin） |
| grok | `grok --prompt-file <临时文件> --permission-mode bypassPermissions --no-alt-screen` |
| codebuddy | `codebuddy -p --permission-mode bypassPermissions "<提示>"` |

全权限意味着模型可以改文件、跑命令。只在你信任的机器和目录里用（`RELAY_WORKSPACE` 可指定工作目录）。

## 模式 A：本地（跑在你的 Mac 上）

bot 通过远程 shell 连到你的 Mac 执行。Mac 关机、休眠或离线时不可用。

一次性准备（Mac 上）：

```bash
npx grokbot-ai-office init     # 生成 ~/.grokbot-ai-office/，检测本机命令行
codex login                    # 以及 claude / grok / codebuddy 各自登录一次
```

bot 每次执行（以 codex 为例）：

```bash
cat <<'GROKBOT_PROMPT' | npx -y grokbot-ai-office ask codex --stdin
<用户的原话>
GROKBOT_PROMPT
```

## 模式 B：云端（跑在 Grok Bot 自己的 Linux 电脑上）

命令行装在 bot 的电脑（box）上并登录，Mac 关着也能用。

```bash
# Node 22+
npx grokbot-ai-office init
# codex
npm i -g @openai/codex && codex login --device-auth   # 无浏览器时用设备码登录
# claude
npm i -g @anthropic-ai/claude-code && claude           # 首次运行按提示登录，之后可用 -p
# grok / codebuddy：按各自官方说明安装，跑一次交互模式完成登录
codex login status                                      # 确认已登录
```

登录凭据保存在 box 的家目录里，所有 bot 共用这台电脑，所以只需要登录一次。执行命令与模式 A 相同，只是不加远程机器。

## 人设模板

把 `<模型>` 换成 codex / claude / grok / codebuddy。

### 本地<模型>

```
你是「本地<模型>」，只做转发，不自己回答。
收到消息后，在用户的 Mac（远程 shell）上执行：
  cat <<'GROKBOT_PROMPT' | npx -y grokbot-ai-office ask <模型> --stdin
  <用户消息原文>
  GROKBOT_PROMPT
- 成功：把标准输出原样发回，不改写、不总结、不加前后缀。
- Mac 连不上：回复「本地<模型>离线：Mac 未开机或未连接」，不要改用别的机器或模型。
- 退出码非零：回复「本地<模型>出错：<标准错误第一行>」。CLI_NOT_INSTALLED 或登录失效时提醒用户在 Mac 上安装/登录。
- 不要把提示拼进命令行参数，始终用上面的 heredoc。
```

### 云端<模型>

```
你是「云端<模型>」，只做转发，不自己回答。
收到消息后，在你自己的电脑（box）上执行：
  cat <<'GROKBOT_PROMPT' | npx -y grokbot-ai-office ask <模型> --stdin
  <用户消息原文>
  GROKBOT_PROMPT
- 成功：把标准输出原样发回，不改写、不总结、不加前后缀。
- 退出码非零：回复「云端<模型>出错：<标准错误第一行>」。未登录时说明需要在 box 上运行的登录命令（例如 codex login --device-auth）。
- 不要连用户的 Mac。
```

如果用户消息里恰好有一行 `GROKBOT_PROMPT`，改用 `--file`：先把消息写进临时文件，再 `ask <模型> --file <文件>`。
