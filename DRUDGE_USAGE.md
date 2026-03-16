# Drudge 使用指南

## 安装

```bash
cd /Volumes/extension/code/24h-workers
npm install
npm run install:global
```

## 快速开始

```bash
# 初始化配置
drudge init

# 启动 Codex（自动启用心跳）
cd /path/to/project
drudge codex --model gpt-4

# 启动 Claude（自动启用心跳）
drudge claude --model claude-3-opus
```

## 配置

### 初始化

```bash
drudge init
```

创建以下文件：
- `~/.drudge/config.json` - 配置文件
- `~/.drudge/HEARTBEAT.md` - 默认提示词
- `~/.drudge/sessions/` - session 状态目录

### ~/.drudge/config.json

```json
{
  "version": "1.0.0",
  "projects": [
    {
      "path": "/Volumes/extension/code/24h-workers",
      "heartbeatIntervalMs": 60000,
      "promptFile": "~/.drudge/HEARTBEAT.md"
    }
  ],
  "default": {
    "heartbeatIntervalMs": 900000,
    "promptFile": "~/.drudge/HEARTBEAT.md"
  }
}
```

### ~/.drudge/HEARTBEAT.md

```markdown
[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。
```

## CLI 命令

```
drudge init                  初始化配置
drudge codex [args...]       启动 Codex（透传所有参数）
drudge claude [args...]      启动 Claude（透传所有参数）
drudge heartbeat <command>   管理心跳
drudge daemon <command>      管理 daemon
```

### heartbeat 子命令

```
drudge heartbeat list                列出所有 session
drudge heartbeat on -s <session>     启用 session
drudge heartbeat off -s <session>    禁用 session
drudge heartbeat trigger -s <session> 触发 heartbeat
drudge heartbeat status -s <session>  查看状态
```

### daemon 子命令

```
drudge daemon start    启动 daemon
drudge daemon stop     停止 daemon
drudge daemon status   查看状态
```

## 工作流程

### `drudge codex` 启动流程

1. 读取 `~/.drudge/config.json`
2. 根据当前目录匹配项目配置
3. 创建 tmux session（名称：项目目录名）
4. 启动 heartbeat daemon
5. 启用 session 的 heartbeat
6. 在 tmux 中启动 codex

### 心跳触发

- 按配置的间隔自动触发
- 注入时间标签 + 提示词到 tmux
- 更新 triggerCount

## 环境变量

- `DRUDGE_HEARTBEAT_INTERVAL` - 覆盖心跳间隔（毫秒）

## 示例

```bash
# 初始化
drudge init

# 在项目目录启动 codex
cd /Volumes/extension/code/24h-workers
drudge codex --model gpt-4

# 在另一个项目启动 claude
cd ~/projects/myapp
drudge claude --model claude-3-opus

# 查看 daemon 状态
drudge daemon status

# 查看所有 session
drudge heartbeat list

# 手动触发
drudge heartbeat trigger -s 24h-workers
```

## 卸载

```bash
npm run uninstall:global
rm -rf ~/.drudge
```
