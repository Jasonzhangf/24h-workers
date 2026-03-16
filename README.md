# Heartbeat 独立工具

一个最小化的 heartbeat 工具，核心是定时巡检 + tmux 注入。代理拦截作为可选的增强模式。

## 功能特性

### 独立模式（最小核心）
- ✅ 定时主循环（默认 15 分钟）
- ✅ tmux 文本注入
- ✅ 状态持久化 (~/.heartbeat/)
- ✅ Clock 时间标签注入
- ✅ CLI 命令

### 代理增强模式（可选）
- ✅ HTTP 代理服务器（3 个端口）
- ✅ 三大协议 finish_reason 提取
- ✅ finish_reason=stop 时触发 heartbeat

## 快速开始

### 安装

```bash
npm install
npm run build
```

### CLI 使用

```bash
# 启动 daemon
node dist/cli/index.js start

# 启动 daemon + 代理
node dist/cli/index.js start --with-proxy

# 查看状态
node dist/cli/index.js status --json

# 启用 session
node dist/cli/index.js on -s codex

# 手动触发
node dist/cli/index.js trigger -s codex

# 列出所有 session
node dist/cli/index.js list

# 显示 session 详情
node dist/cli/index.js show -s codex

# 禁用 session
node dist/cli/index.js off -s codex

# 停止 daemon
node dist/cli/index.js stop
```

### 配置���件

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

### 提示词模板

编辑 `HEARTBEAT.md`:

```markdown
[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。
```

## 测试

```bash
npm test
```

## 项目结构

```
src/
├── core/          # 核心模块（独立模式必需）
│   ├── config.ts
│   ├── state-store.ts
│   ├── trigger.ts
│   └── daemon.ts
├── tmux/          # TMUX 注入
│   ├── session-probe.ts
│   └── injector.ts
├── clock/         # Clock 时间标签
│   └── time-tag.ts
├── proxy/         # 代理模块（可选增强）
│   ├── types.ts
│   ├── finish-reason.ts
│   ├── request-handler.ts
│   └── server.ts
└── cli/           # CLI 命令
    └── index.ts
```

## 代码���范

- 单文件不超过 500 行
- 每个模块全局唯一真源
- 公共函数库 + 模块化 + 应用层编排

## 许可证

MIT
