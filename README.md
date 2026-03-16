# Drudge - Heartbeat 独立工具

一个最小化的 heartbeat 工具，核心是定时巡检 + tmux 注入。

## 快速入门

```bash
# 安装
npm install
npm run install:global

# 启动
drudge start

# 启用 session
drudge on -s mysession

# 手动触发
drudge trigger -s mysession

# 查看状态
drudge status
```

## 命令列表

| 命令 | 说明 |
|------|------|
| `drudge start` | 启动 daemon |
| `drudge stop` | 停止 daemon |
| `drudge status` | 查看状态 |
| `drudge list` | 列出 session |
| `drudge on -s <name>` | 启用 session |
| `drudge off -s <name>` | 禁用 session |
| `drudge trigger -s <name>` | 手动触发 |
| `drudge show -s <name>` | 查看 session 详情 |

## 详细文档

- [QUICKSTART.md](./QUICKSTART.md) - 快速入门
- [USAGE.md](./USAGE.md) - 详细使用说明

## 配置

创建 `config.json`:

```json
{
  "tickMs": 900000,
  "promptFile": "HEARTBEAT.md"
}
```

创建 `HEARTBEAT.md`:

```markdown
[Heartbeat]
请进行任务巡检。
检查上次交付是否完整。
完成后更新 DELIVERY.md。
```

## 卸载

```bash
npm run uninstall:global
```

## 许可证

MIT
