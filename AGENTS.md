# 代码规则

## 代码组织

- 单文件不超过 500 行
- 使用公共函数库 + 模块化 + 应用层编排的方式实现代码
- 每个模块要求是全局唯一真源
- UI 只消费应用层数据，做唯一真源获取

## Debug 规则

- debug 任务时，先看记忆，检查历史，避免重复性错误
- 解决问题或者遇到错误时，要记录到记忆中，确保下次不做同样的错误实现
- 对于有明确实现目标的任务不询问用户，主动实现
- 对于危险的操作需要谨慎，改动尽量保持最小实现
- 修复问题不打补丁，从最正确的方式解决问题

## 项目结构

```
src/
├── core/          # 核心模块（独立模式必需）
├── tmux/          # TMUX 注入
├── clock/         # Clock 时间标签
├── proxy/         # 代理模块（可选增强）
└── cli/           # CLI 命令
```

## 模块职责

| 模块 | 职责 | 唯一真源 |
------|------|---------|
| core/daemon.ts | 定时主循环 | heartbeat daemon 启停 |
| core/trigger.ts | 触发逻辑 | heartbeat 触发时机 |
| core/state-store.ts | 状态持久化 | session 状态存储 |
| core/config.ts | 配置管理 | 配置解析与默认值 |
| tmux/injector.ts | tmux 注入 | tmux 文本注入 |
| tmux/session-probe.ts | session 检测 | tmux session 存活状态 |
| clock/time-tag.ts | 时间标签 | 时间标签生成 |
| proxy/server.ts | HTTP 代理 | 代理服务器 |
| proxy/response-interceptor.ts | 响应拦截 | finish_reason 提取 |
