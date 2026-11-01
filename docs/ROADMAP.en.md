# Roadmap

This is the agreed plan. The project currently implements step 4. Nothing from step 5 onward is built yet.

## Step 1. Skeleton (done)

Repository layout, design docs, registry validation, and error codes.

## Step 2. Relay core and adapters (done)

`ai-relay` calls an AI from `configs/providers.yaml`. All three auth methods work:

- `subscription`: a local CLI
- `api_key`: DeepSeek, Kimi, GLM, Claude (Anthropic), and Gemini
- `openai_compatible`: OpenAI-compatible endpoints, including local Ollama

## Step 3. Live events (done)

Events append to `~/.grokbot-ai-office/events.jsonl`. Override the path with `RELAY_EVENTS_PATH`. `ai-relay serve` pushes new events over a local WebSocket and serves `GET /state` for clients that join late.

This step also includes two ideas learned from the MIT-licensed project [munder-difflin](https://github.com/HarnessMD/munder-difflin) and reimplemented behind our own ports:

1. **PTY.** A `subscription` provider may set `pty: true`. Raw terminal output, including color and cursor sequences, is stored as `output_chunk` events. The last 8KB is kept so step 4 can replay it in xterm.js. If `node-pty` fails to load, the adapter falls back to pipes. Timeout, cancel, and exit kill the process group.
2. **CLI hooks.** `ai-relay hook` and `POST /hook` accept hooks from CLIs such as Claude Code. Prompt submit, tool use, permission request, and stop map to `working`, `waiting_approval`, and `idle`. Hook status wins over output heuristics. See [HOOKS.en.md](./HOOKS.en.md).

Handoff and approval are in this step too: `ai-relay handoff` and `ai-relay approval request|resolve|list`. There is no UI yet.

## Step 3.5. ai-relay as an MCP server (done)

`ai-relay mcp` exposes the relay as an MCP server. The tools are `ask`, `list_agents`, `office_status`, plus handoff and approval. Transports are stdio and Streamable HTTP bound to loopback by default. A Grok Bot relay bot calls this MCP server instead of assembling shell commands. See [MCP.en.md](./MCP.en.md).

## Step 4. First 3D office (done)

A real three.js scene: low-poly, cartoon-like, orthographic isometric by default. The local zone and the cloud zone share one floor. Each monitor embeds a live xterm.js terminal through CSS3DRenderer. Status has motion: stuck turns red, waiting for approval raises a hand, a long idle sleeps, and a newly connected AI gets its desk fitted out. A handoff walks a file across the room. Each provider has its own character and desk. See [OFFICE.en.md](./OFFICE.en.md). The boss view is not built.

## Step 5. Boss view

The same scene switches to a first-person perspective camera (WASD and mouse). Walk up to read a screen, or follow a handoff. Click the boss computer to open a console: a status table, approval items, handoff history, and a dispatch box. The console uses a local passphrase and binds to localhost only.

## Step 5.5. Native macOS SwiftUI Dynamic Island

A capsule along the top of the screen. Each AI is one status dot. Hover to expand, approve or deny in one click, and watch a handoff animation. A click opens the matching desk in the 3D office. This step is compiled on a Mac with Xcode.

## Step 6. Distribution

> Status: packaging is ready. `apps/npm` builds a single npm package `grokbot-ai-office` (bin `grokbot-ai-office`, alias `ai-relay`) with `init`, `ask`, `mcp`, and `office`. The setup prompt is `docs/SETUP_PROMPT.en.md`. `.github/workflows/release.yml` publishes with `NPM_TOKEN` when a `v*` tag is pushed. Not published yet, pending the visibility decision. The Grok Bot template export is not done.

Publish an npm package: `npx grokbot-ai-office init | mcp | office | ask`. Also export a Grok Bot template. Each person runs it on their own computer with their own AI accounts and keys. This is not a hosted SaaS. Before the npm publish, decide whether the repository is public.

The deliverables also include a setup prompt, `docs/SETUP_PROMPT.md`, and an English copy, `docs/SETUP_PROMPT.en.md`. A person pastes it into Grok Bot or any coding AI, and that AI installs grokbot-ai-office. The pasteable-prompt idea comes from rakazo's SETUP_PROMPT.md. This step keeps the idea only.

The prompt tells the AI to:

1. Run `npx grokbot-ai-office init`.
2. Detect CLIs that are installed and logged in: codex, claude, gemini, codebuddy, hermes, and openclaw.
3. Ask for `RELAY_HOST` and the workspace.
4. Have the person fill API keys into `.env` themselves.
5. Smoke-test each provider with `ask`.
6. Start `mcp` and `office`.
7. Finish with a status table.

Safety rules in the prompt: never overwrite or print `.env` values, never print or commit secrets, do not kill unrelated processes, no sudo, and keep `safe_mode` on.
