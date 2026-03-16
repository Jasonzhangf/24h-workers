# Drudge - 让你的 Codex 和 Claude Code 做 24 小时牛马

**只要你的 token 够用，它们就能一直干活！**

Drudge 是一个 heartbeat 工具，让你的 Codex 和 Claude Code 可以 24 小时不间断工作。它通过定时向 tmux session 注入心跳提示词，让 AI 助手持续执行任务巡检和修复工作。

## 核心功能

- 🔄 **自动心跳** - 定时注入提示词，让 AI 持续工作
- 📁 **多项目支持** - 每个项目独立配置心跳间隔
- 🖥️ **TMUX 集成** - 自动创建和管理 tmux session
- ⚙️ **灵活配置** - 支持项目级和全局配置
- 🔧 **透传参数** - 所有 codex/claude 参数完全透传

## 依赖

### 必需依赖

- **Node.js** >= 18
- **TMUX** - 用于 session 管理
- **Codex CLI** 或 **Claude Code CLI**

### 安装 Codex CLI

```bash
npm install -g @openai/codex
# 或
brew install codex
```

### 安装 Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

### 检查 TMUX

```bash
# macOS
brew install tmux

# Linux
apt install tmux  # Ubuntu/Debian
yum install tmux  # CentOS/RHEL
```

## 安装

```bash
# 克隆项目
git clone https://github.com/your-repo/drudge.git
cd drudge

# 安装依赖
npm install

# 全局安装
npm run install:global

# 验证安装
drudge --version
```

## 快速开始

### 1. 初始化

在你的项目目录运行：

```bash
cd /path/to/your/project
drudge init
```

这会创建：
- `~/.drudge/config.json` - 配置文件
- `~/.drudge/HEARTBEAT.md` - 默认提示词
- `~/.drudge/sessions/` - session 状态目录

并将当前项目添加到配置中。

### 2. 启动 Codex

```bash
drudge codex --model gpt-4
```

Drudge 会：
1. 创建 tmux session（名称为项目目录名）
2. 启动 heartbeat daemon
3. 启用当前 session 的心跳
4. 在 tmux 中启动 codex

### 3. 启动 Claude Code

```bash
drudge claude --model claude-3-opus
```

## 配置

### ~/.drudge/config.json

```json
{
  "version": "1.0.0",
  "projects": [
    {
      "path": "/Users/you/projects/myapp",
      "heartbeatIntervalMs": 60000,
      "promptFile": "~/.drudge/HEARTBEAT.md"
    },
    {
      "path": "/Users/you/projects/another",
      "heartbeatIntervalMs": 300000,
      "promptFile": "~/.drudge/HEARTBEAT.md"
    }
  ],
  "default": {
    "heartbeatIntervalMs": 900000,
    "promptFile": "~/.drudge/HEARTBEAT.md"
  }
}
```

### 配置字段说明

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `heartbeatIntervalMs` | 心跳间隔（毫秒） | 900000 (15分钟) |
| `promptFile` | 提示词文件路径 | ~/.drudge/HEARTBEAT.md |

### ~/.drudge/HEARTBEAT.md

默认提示词文件：

```markdown
[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。
```

你可以根据项目需要自定义这个文件。

## CLI 命令

```
drudge init                  初始化配置（添加当前项目）
drudge codex [args...]       启动 Codex（透传所有参数）
drudge claude [args...]      启动 Claude Code（透传所有参数）
drudge heartbeat <command>   管理心跳
drudge daemon <command>      管理 daemon
```

### heartbeat 子命令

```bash
drudge heartbeat list                # 列出所有 session
drudge heartbeat on -s <session>     # 启用 session
drudge heartbeat off -s <session>    # 禁用 session
drudge heartbeat trigger -s <session> # 手动触发心跳
drudge heartbeat status -s <session>  # 查看状态
```

### daemon 子命令

```bash
drudge daemon start    # 启动 daemon
drudge daemon stop     # 停止 daemon
drudge daemon status   # 查看状态
```

## 使用场景

### 场景 1：长时间代码重构

```bash
cd /path/to/large-project
drudge init
drudge codex --model gpt-4 "请重构 src/ 目录下的所有模块"
```

AI 会持续工作，每 15 分钟自动检查进度并继续执行。

### 场景 2：自动化测试修复

```bash
cd /path/to/project
drudge init
# 编辑 ~/.drudge/HEARTBEAT.md，添加测试修复任务
drudge claude --model claude-3-opus
```

### 场景 3：多项目并行

```bash
# 项目 A
cd /projects/project-a
drudge init
drudge codex &

# 项目 B
cd /projects/project-b
drudge init
drudge claude &
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DRUDGE_HEARTBEAT_INTERVAL` | 覆盖心跳间隔（毫秒） |

示例：

```bash
DRUDGE_HEARTBEAT_INTERVAL=60000 drudge codex  # 1 分钟心跳
```

## 工作原理

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   drudge    │────►│    tmux     │────►│   codex/    │
│   daemon    │     │   session   │     │   claude    │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │                   │
       ▼                   ▼
┌─────��───────┐     ┌─────────────┐
│  heartbeat  │     │   prompt    │
│   trigger   │     │  injection  │
└─────────────┘     └─────────────┘
```

1. `drudge codex` 启动时创建 tmux session
2. Heartbeat daemon 按配置间隔触发
3. 注入时间标签 + 提示词到 tmux
4. AI 接收提示词，继续执行任务

## 时间标签格式

每次心跳会注入时间标签：

```
[Time/Date]: utc=`2026-03-16T15:15:52.173Z` local=`2026-03-16 23:15:52.173 +08:00` tz=`Asia/Shanghai` nowMs=`1773674152173`
```

帮助 AI 了解当前时间，做出更好的决策。

## 卸载

```bash
npm run uninstall:global
rm -rf ~/.drudge
```

## 许可证

MIT

---

**让你的 AI 助手做 24 小时牛马，只要 token 够用！** 🚀
