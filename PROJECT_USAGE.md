# Drudge 项目使用说明

## 一、项目概述

Drudge 是一个独立的 heartbeat 工具，核心功能是定时巡检 + tmux 注入。支持两种模式：
- **独立模式**：定时（默认 15 分钟）向 tmux session 注入提示词
- **代理模式**：拦截 LLM 响应，当 finish_reason=stop 时触发 heartbeat

## 二、安装与基本使用

### 2.1 安装

```bash
# 进入项目目录
cd /Volumes/extension/code/24h-workers

# 安装依赖
npm install

# 全局安装
npm run install:global

# 验证安装
drudge --version
```

### 2.2 基本命令

| 命令 | 说明 |
|------|------|
| `drudge start` | 启动 daemon（独立模式） |
| `drudge start --with-proxy` | 启动 daemon（代理模式） |
| `drudge stop` | 停止 daemon |
| `drudge status` | 查看状态 |
| `drudge list` | 列出所有 session |
| `drudge on -s <name>` | 启用 session |
| `drudge off -s <name>` | 禁用 session |
| `drudge trigger -s <name>` | 手动触发 |
| `drudge show -s <name>` | 查看 session 详情 |
| `--json` | 输出 JSON 格式（适合脚本） |

### 2.3 快速上手

```bash
# 1. 启动 daemon
drudge start

# 2. 启用你的 tmux session
drudge on -s mysession

# 3. 手动触发一次测试
drudge trigger -s mysession

# 4. 查看状态
drudge status

# 5. 停止
drudge stop
```

## 三、配置文件

### 3.1 config.json（项目根目录）

```json
{
  "tickMs": 900000,           // 触发间隔（毫秒），默认 15 分钟
  "promptFile": "HEARTBEAT.md", // 提示词文件名
  "proxy": {
    "enabled": false,          // 是否启用代理模式
    "anthropicPort": 8081,     // Anthropic 代理端口
    "openaiPort": 8082,        // OpenAI 代理端口
    "geminiPort": 8083         // Gemini 代理端口
  },
  "finishReason": {
    "triggerOn": ["stop"]      // 触发的 finish_reason 值
  }
}
```

### 3.2 HEARTBEAT.md（工作目录）

```markdown
[Heartbeat]
请进行任务巡检。
检查上次交付是否完整。
完成后更新 DELIVERY.md。
```

## 四、工作流程

### 4.1 独立模式（定时触发）

1. 启动 daemon：`drudge start`
2. 启用 session：`drudge on -s mysession`
3. daemon 每 15 分钟自动注入提示词到 tmux
4. 查看触发次数：`drudge show -s mysession`

### 4.2 代理模式（finish_reason 触发）

1. 修改 config.json：`proxy.enabled = true`
2. 启动代理模式：`drudge start --with-proxy`
3. 配置上游 provider API
4. 当 LLM 返回 finish_reason=stop 时自动触发

## 五、状态存储

- **位置**：`~/.heartbeat/sessions/`
- **格式**：JSON 文件，每个 session 一个文件
- **字段**：
  - `version`: 版本号
  - `sessionId`: session ID
  - `enabled`: 是否启用
  - `createdAtMs`: 创建时间
  - `updatedAtMs`: 更新时间
  - `triggerCount`: 触发次数
  - `lastTriggeredAtMs`: 最后触发时间
  - `lastError`: 最后错误

## 六、卸载

```bash
npm run uninstall:global
```

## 七、故障排查

### Session 显示为 (dead)
- 检查 tmux session 是否存在：`tmux ls`
- 检查 session 名称是否正确

### 触发失败 (tmux_session_not_found)
- 确保 tmux session 正在运行
- 检查 session 名称拼写

### Daemon 无法启动
- 检查端口占用（代理模式）：`lsof -i :8081`
- 查看日志输出
