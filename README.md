# Drudge (24h-workers)

**Tags**: codex, claude code, iflow, opencode

[English](#english) | [中文](#drudge-24h-workers)

Drudge 是一个基于 **tmux 注入 + 定时触发** 的 24 小时“牛马”工具：
- 任何支持 TTY 的编程工具都能被激活（Claude Code / Codex / iFlow 等）
- 本地依赖 tmux（Windows 不支持）
- 通过 **HEARTBEAT.md** / **CLOCK.md** 实现自动巡检与定时提醒

---

## 安装

```bash
npm i -g @jsonstudio/drudge
```


### Release 包使用方式

如果从 GitHub Release 下载了 tarball：

```bash
# 1) 解压
tar -xzf jsonstudio-drudge-<version>.tgz
cd package

# 2) 安装到全局
npm i -g .

# 3) 验证
drudge --help
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

### 3) Review（drudge.review）

独立 review 工具，**默认使用系统 codex**，也可配置为 Claude Code 或自定义工具。输出通过 tmux 注入到会话中。

#### 推荐流程
```bash
# 1) 先解析当前路径对应的 tmux session
drudge session resolve -C <project-dir> --json

# 2) 执行 review（不指定 -s 时会按路径自动解析）
drudge review -C <project-dir> --goal "检查交付是否完整" --focus "tests/build/evidence"

# 3) 或指定 session
drudge review -s <session> -C <project-dir> --goal "检查交付是否完整"
```

#### 配置 review 工具

配置文件：`~/.drudge/review-config.json`

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

**模板变量**：`{cwd}` / `{output}` / `{prompt}` / `{profile}`

#### 环境变量
- `DRUDGE_REVIEW_TOOL`：指定默认 review 工具
- `DRUDGE_REVIEW_CODEX_BIN`：指定 codex 路径
- `CODEX_HOME`：指定 codex 配置目录

> **依赖提醒**：review 工具需安装在系统 PATH 中（codex/claude）。

---

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

- `~/.codex/skills/drudge/SKILL.md`（主入口）
- `~/.codex/skills/drudge-alarm/SKILL.md`（与 drudge 同步）

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


## English

Drudge is a tmux-injection + scheduler tool for always-on agent workflows.

### Install

```bash
npm i -g @jsonstudio/drudge
```


### Release 包使用方式

如果从 GitHub Release 下载了 tarball：

```bash
# 1) 解压
tar -xzf jsonstudio-drudge-<version>.tgz
cd package

# 2) 安装到全局
npm i -g .

# 3) 验证
drudge --help
```


**tmux is required**:
```bash
# macOS
brew install tmux
# Ubuntu
sudo apt-get install tmux
# CentOS
sudo yum install tmux
```

### Usage

#### Heartbeat
```bash
drudge daemon start
drudge heartbeat status -s <project>
drudge heartbeat trigger -s <project>
```

#### Alarm / Scheduler
```bash
# Check readiness
 drudge alarm check -p <project>

# Write CLOCK.md
mkdir -p <project>/.drudge
echo "[Alarm] Do the task" > <project>/.drudge/CLOCK.md

# Add cron alarm
 drudge alarm add "0 9 * * 1-5" --id daily-9am -p <project>

# One-shot
 drudge alarm add "45 14 * * *" --id once-check -p <project> --once
```

#### Trigger (direct injection)
```bash
drudge trigger -s <session> -m "[Alarm] Check now"
```

#### Review (drudge.review)
```bash
# Resolve tmux session by path (recommended)
drudge session resolve -C <project-dir> --json

# Run review (session auto-resolve by path)
drudge review -C <project-dir> --goal "check delivery" --focus "tests/build/evidence"

# Or force specific session
drudge review -s <session> -C <project-dir>
```

**Review tool config**: `~/.drudge/review-config.json`

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

Template vars: `{cwd}` / `{output}` / `{prompt}` / `{profile}`

Env vars:
- `DRUDGE_REVIEW_TOOL`
- `DRUDGE_REVIEW_CODEX_BIN`
- `CODEX_HOME`

Note: the selected review tool must be installed and available in PATH (codex/claude).

### Release package usage
If you downloaded a release tarball from GitHub:

```bash
# 1) extract
 tar -xzf jsonstudio-drudge-<version>.tgz
 cd package

# 2) install globally
 npm i -g .

# 3) verify
 drudge --help
```

---
