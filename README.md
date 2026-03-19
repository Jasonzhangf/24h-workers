# Drudge (24h-workers)

Drudge 是一个基于 **tmux 注入 + 定时触发** 的 24 小时“牛马”工具：
- 任何支持 TTY 的编程工具都能被激活（Claude Code / Codex / iFlow 等）
- 本地依赖 tmux（Windows 不支持）
- 通过 **HEARTBEAT.md** / **CLOCK.md** 实现自动巡检与定时提醒

---

## 安装

```bash
npm i -g @jsonstudio/drudge
```

**依赖**：必须安装 tmux

```bash
# macOS
brew install tmux

# Ubuntu
sudo apt-get install tmux

# CentOS
sudo yum install tmux
```

---

## 核心功能

### 1) 心跳（Heartbeat）
周期性激活模型执行 HEARTBEAT.md 中的任务。

```bash
# 启动 daemon
drudge daemon start

# 查看心跳状态
drudge heartbeat status -s <project>

# 手动触发
 drudge heartbeat trigger -s <project>
```

HEARTBEAT.md 示例：
```md
[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。
```

---

### 2) 闹钟（Alarm / 定时提醒）
定时将 CLOCK.md 内容注入到 tmux 会话中。

#### 前提条件（必须满足）
1. **tmux session 必须由 drudge 启动**（drudge codex / drudge claude）
2. **项目必须已注册**（drudge init 或 config.json）
3. **必须先 check**

```bash
drudge alarm check -p <project>
```

#### 写入 CLOCK.md
```bash
mkdir -p <project>/.drudge
cat > <project>/.drudge/CLOCK.md <<'MD'
[Alarm]
请执行以下提醒任务：
1. 检查待办
2. 若未完成，继续执行
3. 更新 DELIVERY.md
MD
```

#### 添加闹钟
```bash
drudge alarm add "0 9 * * 1-5" --id daily-9am -p <project>
```

#### 单次闹钟
```bash
drudge alarm add "45 14 * * *" --id once-check -p <project> --once
```

#### Adopt（接管非 drudge session）
当 session 存在但非 drudge 启动：
```bash
drudge alarm adopt -p <project> -s <session> --force
```

---

### 3) Trigger（直接注入）
直接向指定 tmux session 注入一条提示词。

```bash
drudge trigger -s <session> -m "[Alarm] 立即检查任务状态"
```

默认会发送 Enter（提交输入）。

---

## 技能（Skills）

将 skill 放入后，模型可自行执行定时/激活，无需人工手动。

- `~/.codex/skills/drudge/SKILL.md`
- `~/.codex/skills/drudge-alarm/SKILL.md`

内容包含完整案例：
- check / adopt / add / trigger
- Cron 使用示例
- 条件检查脚本样本

---

## 检查脚本示例（满足条件后注入）

```bash
#!/usr/bin/env bash
set -e

PROJECT="routecodex"
SESSION="routecodex"
MESSAGE="[Alarm] 立即检查任务状态"

# 1. check
CHECK_JSON=$(drudge alarm check -p "$PROJECT" --json)
READY=$(node -e "const c=JSON.parse(process.argv[1]); console.log(c.ready);" "$CHECK_JSON")

if [ "$READY" != "true" ]; then
  echo "Not ready, try adopt..."
  drudge alarm adopt -p "$PROJECT" -s "$SESSION" --force
fi

# 2. 写 CLOCK.md
mkdir -p "$HOME/github/$PROJECT/.drudge"
echo "$MESSAGE" > "$HOME/github/$PROJECT/.drudge/CLOCK.md"

# 3. 添加单次闹钟
 drudge alarm add "*/15 * * * *" --id auto-check -p "$PROJECT" --once

# 4. 或直接注入
 drudge trigger -s "$SESSION" -m "$MESSAGE"
```

---

## 常用 Cron 示例
- `*/5 * * * *` 每 5 分钟
- `0 * * * *` 每小时整点
- `0 9 * * 1-5` 工作日 9:00
- `30 12 * * 5` 每周五 12:30

---

## License
MIT
