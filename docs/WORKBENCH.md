# 工作台（Workbench）v1

## 概念

- **Grok Bot 群聊 = 派活和对话。** CEO 和「本地codex / 本地grok / 本地codebuddy」等 bot 都在群里，任务在群里下达。
- **工作台 = 你 Mac 上的实时视图 + 产出箱。** 本地 bot 通过远程 shell 在 Mac 上把任务放进 tmux 会话里跑；工作台把这些会话排成一面终端墙，并列出 `~/grokbot-outbox/` 里的产出。
- 云端 bot（跑在 Grok Bot 自己电脑上的）以后只以状态的形式出现，v1 不显示。

工作台只监听 `127.0.0.1`，不对外开放。

## 准备（Mac）

```bash
brew install tmux        # 必需
npx grokbot-ai-office init
```

终端墙用 node-pty + xterm.js 直接接到 tmux 会话（macOS arm64 / x64 有预编译包，无需编译）。如果 node-pty 加载失败，会自动退回只读预览（每 1.5 秒抓一次画面），页面左上角会提示。

## 命令

```bash
# 打开工作台（默认 8790 端口，自动打开浏览器）
npx grokbot-ai-office workbench [--port 8790] [--no-open]

# bot 用：在 tmux 会话 gb-<名字>-<slug> 里非交互地跑任务
npx grokbot-ai-office run codex --task unit-tests --file /tmp/prompt.txt [--wait] [--cwd ~/code/项目] [--timeout 3600]

# 交互式会话 gb-<名字>-interactive，并在「终端」App 里打开（群里的 /终端）
npx grokbot-ai-office term codex [--cwd ~/code/项目]
```

`run` 做的事：

1. 建目录 `~/grokbot-outbox/<YYYY-MM-DD>-<slug>/`，复制提示到 `prompt.txt`，写一个「运行中」的 `README.md`。
2. 起 tmux 会话 `gb-<名字>-<slug>`，按 `providers.yaml` 里的命令（全权限、非交互）跑模型。标准输出写 `answer.txt`，标准输出加标准错误写 `log.txt`，终端里同时能看到。
3. 结束时写 `exit_code`，把 README 更新成「完成 / 失败（退出码）」。会话保留，方便回看，可在工作台里关闭。
4. 加 `--wait` 时阻塞到结束，把 `answer.txt` 打印到标准输出；失败时退出码非零。

会话命名约定：`gb-<agent>-<task-slug>`，agent 为小写字母数字，slug 为小写字母数字和连字符，例如 `gb-codex-unit-tests`。工作台只显示 `gb-` 开头的会话，你自己手动建的同名会话也会出现。

产出箱位置可用 `GROKBOT_OUTBOX` 改。

## 页面

- **状态栏**：每个 AI（codex、grok、codebuddy、claude）一个小圆点，悬停看名字和路径。绿 = 完成，橙 `#FF5A1F` = 运行中，灰 = 空闲，红 = 出错，空心 = 未安装。
- **终端墙**：每个 gb- 会话一块面板，标题是 AI 名、任务 slug 和状态圆点；可全屏、可关闭会话（会二次确认，会终止里面的任务）。
- **产出箱**：最新的在上面，展开看 README，点文件名看内容。

## bot 人设片段（用 run）

```
长任务（写代码、跑测试、改多个文件）不要用 ask，改用 run，这样用户能在工作台里实时看到：
1. 把用户的任务原文写进临时文件（heredoc，不要拼进命令行）：
   cat > /tmp/gb-<slug>.txt <<'GROKBOT_PROMPT'
   <任务原文>
   GROKBOT_PROMPT
2. 起一个简短的英文 slug（小写、连字符），执行：
   npx -y grokbot-ai-office run <模型> --task <slug> --file /tmp/gb-<slug>.txt --cwd <项目目录> --wait
3. 先在群里回一句「已开始：gb-<模型>-<slug>，可在工作台查看」，结束后把标准输出原样发回。
4. 退出码非零：回复「<模型>任务失败：<标准错误最后一行>」，并给出产出目录 ~/grokbot-outbox/<日期>-<slug>/。
5. 「会话已存在」时换一个 slug，不要关掉别人的会话。
```
