---
name: drudge
description: Drudge skill set for scheduling (drudge.clock) and tmux injection (drudge.inject). Use when you need deterministic reminders or direct tmux input via drudge.
---

# Drudge Skill

这个 Skill 提供两类能力：

- **drudge.clock**：定时任务（Alarm）
- **drudge.inject**：直接注入（Trigger）

> **重要前提**：所有注入必须是 drudge 启动的模型会话（tmux session）。
> 否则输入会被 shell 当命令执行。

---

## 如何确定/创建当前项目的 tmux session（建议显式确认）

**目标**：模型需要知道“当前项目对应哪个 tmux session”，如果不存在则创建或接管。

### 1) 先确认项目名与路径
```bash
pwd
basename "$(pwd)"   # projectName
```

### 2) 优先用 drudge 检查 session 是否就绪
```bash
drudge alarm check -p <project> --json
```
- `ready: true` → 说明 drudge session 已存在，可直接注入/定时
- `ready: false` → 说明未注册或未有 drudge session

### 3) 通过路径定位 tmux session（建议显式确认）
```bash
tmux list-panes -a -F '#S:#I.#P\t#{pane_current_path}'
```
找到 `pane_current_path` 与项目路径匹配的行，取对应的 `session:window.pane` 作为目标。

**推荐：用 drudge 内置命令反查（自动参数确认）**
```bash
drudge session resolve -C <project-dir> --json
```
输出示例：
```json
{ "ok": true, "target": "routecodex:0.0", "sessionName": "routecodex", "cwd": "/path" }
```

### 4) 如果 session 不存在：创建或接管

**推荐：创建 drudge 管理的 session**
```bash
drudge codex   # 或 drudge claude
```
它会自动创建 `<projectName>` session，并写入 `~/.drudge/sessions/<project>.json`。

**已有 tmux session 但不是 drudge 启动 → 接管**
```bash
drudge alarm adopt -p <project> -s <session> --force
```

> **结论**：
> - 推荐先确认 session（`drudge session resolve -C`）
> - review 可从路径自动解析 session，但解析失败会报错
> - 没有 session 就用 `drudge codex/claude` 创建

---

## 标记语法（Marker Syntax）

与 clock skill 保持一致的格式：

### 停止/清除
```
<drudge alarm clear>     # 清除当前项目的所有闹钟
<drudge clock clear>     # 同上（别名）
```

### 调度
```
<drudge alarm schedule "*/15 * * * *" "检查任务状态">  # 创建闹钟
```

---

## 自动停止配置

在 CLOCK.md 文件头部添加：

```markdown
Clock-Stop-When: no-open-tasks

[Alarm]
...提醒内容...
```

当 checklist 中没有未完成的 `- [ ]` 任务时，daemon 会自动禁用该闹钟。

---

## drudge.clock（定时任务）

通过 `drudge alarm` 系列命令实现定时提醒。

### 前置条件（必须）
1. **Session 必须是 drudge 启动**
2. **项目必须已注��**（config.json）
3. **必须先 check**

```bash
# 1) 检查是否可用
drudge alarm check -p <project>
# Ready for alarm: yes 才能继续
```

### 添加闹钟（cron）
```bash
# 写入提醒内容
mkdir -p <project>/.drudge
cat > <project>/.drudge/CLOCK.md <<'MD'
Clock-Stop-When: no-open-tasks

[Alarm]
请执行以下提醒任务：
1. 检查上次交付是否完成
2. 若未完成，继续修复
3. 更新 DELIVERY.md
MD

# 添加闹钟
drudge alarm add "0 9 * * 1-5" --id daily-check -p <project>
```

### 单次闹钟
```bash
drudge alarm add "15 14 * * *" --id one-shot-check -p <project> --once
```

### 清除闹钟
```bash
# 清除单个
drudge alarm remove <alarm-id>

# 清除所有（CLI）
drudge alarm clear -p <project>
```

### Adopt（接管非 drudge session）
当 check 失败但 session 实际存在：
```bash
drudge alarm adopt -p <project> -s <session> [--force]
```

---

## drudge.inject（直接注入）

直接向某个 tmux session 注入一条文本。

```bash
drudge trigger -s <session> -m "[Alarm] 立即检查任务状态"
```

> 默认会发送 Enter（提交输入）。
> 加 `--no-submit` 则仅注入不提交。

---

## drudge.review（review + codex + tmux 注入）

触发 review 流程（**独立工具，可配置**）：
1) 生成严格 review 提示词
2) 调用配置的 review 工具（默认 codex，可配置为 claude 或自定义）
3) 将输出注入到 tmux session

> **重要**：只有 drudge 启动的 tmux session 才能保证注入是“输入而非命令执行”。
> 若 session 不是 drudge 启动，请先 `drudge alarm check`，必要时 `drudge alarm adopt`。

> **配置文件**: `~/.drudge/review-config.json`
> 可自定义默认工具、工具路径、参数模板

**配置示例**:
```json
{
  "default": "codex",
  "tools": {
    "codex": {
      "name": "codex",
      "bin": "codex",
      "argsTemplate": ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--output-last-message", "{output}", "{prompt}"]
    },
    "claude": {
      "name": "claude",
      "bin": "claude",
      "argsTemplate": ["--dangerously-skip-permissions", "--print", "{prompt}"],
      "stdoutMode": "last-message"
    }
  }
}
```

```bash
# 推荐先显式解析 session（可用于确认参数）
drudge session resolve -C <project-dir> --json

# review 可省略 -s（会从路径自动解析 session）
drudge review -C <project-dir> --goal "检查交付是否完整" --focus "tests/build/evidence"
drudge review --tool claude  # 使用 claude 而非 codex

# 若需强制指定 session
drudge review -s <session> -C <project-dir> --goal "检查交付是否完整"
```

**参数**：
- `-s, --session <id>`：目标 tmux session（可选；不提供时按路径自动解析）
- `-C, --cwd <dir>`：review 工作目录（由 drudge 设置进程 cwd）
- `--tool <name>`：指定 review 工具（codex/claude/自定义）
- `-p, --profile <name>`：codex profile（可选；仅在目标 codex 支持 `--profile` 时传递）
- `--goal <text>`：review 目标（可选）
- `--focus <text>`：review 聚焦点（可选）
- `--context <text>`：补充上下文（可选）

**行为说明**：
- review 阻塞等待工具完成（最长约 15 分钟）
- review **只读**（prompt 明确禁止写操作/改文件）
- review 失败也会注入错误提示（不会卡住）
- 输出包含时间标签 + `[Review]` 前缀

**可选环境变量**：
- `DRUDGE_REVIEW_CODEX_BIN`：指定 codex 命令路径
- `DRUDGE_REVIEW_TOOL`：指定默认 review 工具（覆盖配置文件）
- `ROUTECODEX_STOPMESSAGE_AI_FOLLOWUP_CODEX_BIN`：兼容 routecodex 变量
- `CODEX_HOME`：指定 codex 配置目录（默认 `~/.codex`）

---

## 样本脚本（自动检查条件，满足后注入）

```bash
#!/usr/bin/env bash
set -e

PROJECT="routecodex"
SESSION="routecodex"
MESSAGE="[Alarm] 立即检查任务状态"

# 1. 先 check
CHECK_JSON=$(drudge alarm check -p "$PROJECT" --json)
READY=$(node -e "const c=JSON.parse(process.argv[1]); console.log(c.ready);" "$CHECK_JSON")

if [ "$READY" != "true" ]; then
  echo "Not ready, try adopt..."
  drudge alarm adopt -p "$PROJECT" -s "$SESSION" --force
fi

# 2. 写 CLOCK.md
mkdir -p "$HOME/github/$PROJECT/.drudge"
echo "$MESSAGE" > "$HOME/github/$PROJECT/.drudge/CLOCK.md"

# 3. 添加闹钟
drudge alarm add "*/15 * * * *" --id auto-check -p "$PROJECT" --once

# 4. 或直接注入
drudge trigger -s "$SESSION" -m "$MESSAGE"
```

---

## 常用 cron 示例
- `*/5 * * * *` 每 5 分钟
- `0 * * * *` 每小时整点
- `0 9 * * 1-5` 工作日 9:00
- `30 12 * * 5` 每周五 12:30

---

## 重要提醒
- **注入是输入式**：会发送 Enter
- **必须确保 session 为 drudge 启动的模型输入 pane**
- **必须先 check，再 add / trigger**
