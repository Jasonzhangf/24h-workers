# Drudge 使用说明

## 安装

```bash
# 1. 进入项目目录
cd /path/to/24h-workers

# 2. 安装依赖
npm install

# 3. 全局安装
npm run install:global

# 4. 验证安装
drudge --version
```

## 基本使用

### 1. 启动 Heartbeat Daemon

```bash
# 启动独立模式（定时触发）
drudge start

# 启动代理模式（拦截 finish_reason 并触发）
drudge start --with-proxy
```

### 2. 查看状态

```bash
# 文本格式
drudge status

# JSON 格式（适合脚本解析）
drudge status --json
```

输出示例：
```
Daemon: running
Tick: 900000ms
Proxy: disabled
Sessions: 1 (1 enabled)
```

### 3. 管理 Session

```bash
# 启用 session
drudge on -s codex

# 禁用 session
drudge off -s codex

# 查看所有 session
drudge list

# 查看 session 详情
drudge show -s codex
```

### 4. 手动触发 Heartbeat

```bash
# 手动触发一次 heartbeat
drudge trigger -s codex
```

### 5. 停止 Daemon

```bash
drudge stop
```

## 配置文件

### 1. 创建配置文件

在项目根目录创建 `config.json`:

```json
{
  "tickMs": 900000,
  "promptFile": "HEARTBEAT.md",
  "proxy": {
    "enabled": false,
    "anthropicPort": 8081,
    "openaiPort": 8082,
    "geminiPort": 8083
  },
  "finishReason": {
    "triggerOn": ["stop"]
  }
}
```

### 2. 创建提示词文件

在工作目录创建 `HEARTBEAT.md`:

```markdown
[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。
```

## 工作流程

### 场景 1: 定时巡检

```bash
# 1. 启动 daemon
drudge start

# 2. 启用你的 tmux session
drudge on -s mysession

# 3. daemon 会每 15 分钟自动注入提示词到 tmux
# 4. 查看触发次数
drudge show -s mysession
```

### 场景 2: 代理模式（finish_reason 触发）

```bash
# 1. 启动代理模式
drudge start --with-proxy

# 2. 配置上游 provider API
# （在代码中设置上游 URL）

# 3. 当 LLM 返回 finish_reason=stop 时自动触发 heartbeat
```

## TMUX 格式支持

支持以下格式：
- `session` - session 名称
- `session:window` - session 和 window
- `session:window.pane` - 完整路径

```bash
# 使用完整路径
drudge on -s mysession:0.0

# 只使用 session
drudge on -s mysession
```

## 状态文件

Session 状态存储在 `~/.heartbeat/sessions/`:

```bash
# 查看所有 session 文件
ls ~/.heartbeat/sessions/

# 查看特定 session
cat ~/.heartbeat/sessions/mysession.json
```

## 故障排查

### Session 显示为 (dead)

- 检查 tmux session 是否存在: `tmux ls`
- 检查 session 名称是否正确

### 触发失败 (tmux_session_not_found)

- 确保 tmux session 正在运行
- 检查 session 名称拼写

### Daemon 无法启动

- 检查端口占用: `lsof -i :8081`（代理模式）
- 查看日志输出

## 卸载

```bash
npm run uninstall:global
```
