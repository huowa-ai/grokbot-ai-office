# 变更日志

## 0.1.1 — 2026-11-01

- **工作台**：本机 `workbench`——tmux 终端墙、产出箱、状态圆点；新增 `run` / `term` 命令（见 docs/WORKBENCH.md）
- **一模型一 Bot**：`ask --stdin` / `--file`；providers 默认全权限非交互；docs/BOT_RELAY.md
- **MCP**：无状态 HTTP、`/mcp/<agent>` 固定模型、init 生成 `RELAY_SERVER_TOKEN`、拒绝无令牌隧道
- **fix**：不再把 `undefined` 写进 `RELAY_PROVIDERS_PATH`

## 0.1.0

- 首次 npm 发布：`init` / `ask` / `mcp` / `office`
