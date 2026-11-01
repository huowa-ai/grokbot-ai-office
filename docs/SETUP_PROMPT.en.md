# Setup prompt

Paste everything below into Grok Bot or any coding AI. It installs grokbot-ai-office on your computer.

---

Please install and configure grokbot-ai-office on my computer. It needs Node.js 22 or newer. Do these in order:

1. Run `npx grokbot-ai-office init`. It creates `~/.grokbot-ai-office/` with `providers.yaml`, `.env`, and `.env.example`, and lists the AI CLIs it found on this machine.
2. From the init output, check which CLIs are installed and signed in: codex, claude, gemini, codebuddy, hermes, openclaw, grok. For any that are not signed in, tell me the login command. Do not sign in for me.
3. Ask me two things: this machine's `RELAY_HOST` (for example `mac` or `cloud`), and the shared working directory `RELAY_WORKSPACE`.
4. For providers that need an API key (for example deepseek), have me write the key into `~/.grokbot-ai-office/.env` myself. Only tell me the variable name.
5. Smoke-test each available provider: `npx grokbot-ai-office ask <name> "introduce yourself in one sentence"`.
6. Start MCP with `npx grokbot-ai-office mcp` and the office with `npx grokbot-ai-office office`. Tell me the URL it opened.
7. Finish with a status table: provider, installed, signed in, smoke result, next step.

Safety rules:

- Do not overwrite or print values in `.env`.
- Do not print or commit any secret.
- Do not kill unrelated processes. Do not use sudo.
- Keep the read-only flags in `safe_mode` for `auth: subscription` providers unless I explicitly ask to change them.
