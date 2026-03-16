# Drudge 快速入门

## 一、安装

```bash
cd /Volumes/extension/code/24h-workers
npm install
npm run install:global
```

## 二、基本命令

| 命令 | 说明 |
|------|------|
| `drudge start` | 启动 daemon |
| `drudge stop` | 停止 daemon |
| `drudge status` | 查看状态 |
| `drudge list` | 列出所有 session |
| `drudge on -s <name>` | 启用 session |
| `drudge off -s <name>` | 禁用 session |
| `drudge trigger -s <name>` | 手动触发 |
| `drudge show -s <name>` | 查看 session 详情 |

## 三、快速上手

```bash
# 1. 启动 daemon
drudge start

# 2. 启用你的 tmux session
drudge on -s mysession

# 3. 手动触发一次测试
drudge trigger -s mysession

# 4. 查看状态
drudge status --json

# 5. 查看所有 session
drudge list
```

## 四、配置文件

### config.json（项目根目录）

```json
{
  "tickMs": 900000,
  "promptFile": "HEARTBEAT.md"
}
```

### HEARTBEAT.md（工作目录）

```markdown
[Heartbeat]
请进行任务巡检。
检查上次交付是否完整。
完成后更新 DELIVERY.md。
```

## 五、工作原理

1. **独立模式**: 每 15 分钟自动向 tmux 注入提示词
2. **代理模式**: 拦截 LLM 响应，finish_reason=stop 时触发

## 六、状态存储

- 位置: `~/.heartbeat/sessions/`
- 格式: JSON 文件

## 七、卸载

```bash
npm run uninstall:global
```
