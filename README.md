# Drudge - Heartbeat 独立工具

一个最小化的 heartbeat 工具，核心是定时巡检 + tmux 注入。代理拦截作为可选的增强模式。

## 安装

```bash
npm install
npm run build
npm link  # 全局安装为 drudge 命令
```

## 使用

```bash
# 启动 daemon
drudge start

# 启动 daemon + 代理
drudge start --with-proxy

# 查看状态
drudge status --json

# 启用 session
drudge on -s <session-name>

# 手动触发
drudge trigger -s <session-name>

# 列出所有 session
drudge list

# 显示 session 详情
drudge show -s <session-name>

# 禁用 session
drudge off -s <session-name>

# 停止 daemon
drudge stop
```

## 配置

编辑 `config.json`:

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

## 测试

```bash
npm test
```

## 许可证

MIT
