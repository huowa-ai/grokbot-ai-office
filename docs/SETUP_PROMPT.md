# 安装提示

把下面整段贴进 Grok Bot 或任何编程 AI，由它在你的电脑上安装 grokbot-ai-office。

---

请在我的电脑上安装并配置 grokbot-ai-office。要求 Node.js 22 或更高。按顺序做：

1. 运行 `npx grokbot-ai-office init`。它会创建 `~/.grokbot-ai-office/`，写入 `providers.yaml`、`.env` 和 `.env.example`，并列出本机找到的 AI 命令行。
2. 根据 init 的输出，确认哪些 CLI 已安装并已登录：codex、claude、gemini、codebuddy、hermes、openclaw、grok。没登录的只告诉我登录命令，不要替我登录。
3. 问我两件事：这台机器的 `RELAY_HOST`（例如 `mac`、`cloud`），以及 AI 之间共享文件的工作目录 `RELAY_WORKSPACE`。
4. 需要 API key 的提供者（例如 deepseek），让我自己把 key 写进 `~/.grokbot-ai-office/.env`。你只告诉我变量名。
5. 对每个可用的提供者跑一次冒烟：`npx grokbot-ai-office ask <名字> "用一句话介绍你自己"`。
6. 启动 MCP：`npx grokbot-ai-office mcp`；启动办公室：`npx grokbot-ai-office office`，把打开的地址告诉我。
7. 最后给我一张状态表：提供者、是否安装、是否登录、冒烟结果、下一步。

安全约束：

- 不覆盖、不打印 `.env` 里的值。
- 不打印、不提交任何密钥。
- 不结束与本任务无关的进程，不用 sudo。
- `auth: subscription` 的提供者保持 `safe_mode` 里写的只读参数，除非我明确要求改。
