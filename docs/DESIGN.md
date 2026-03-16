# Heartbeat 独立工具设计文档

## 概述

一个最小化的 heartbeat 工具，核心是定时巡检 + tmux 注入。代理拦截作为可选的增强模式。

## 两种运行模式

### 模式 A：独立模式（最小核心）

```
┌─────────────────────────────────────────┐
│           Heartbeat Daemon              │
│  ┌───────────┐    ┌─────────────────┐  │
│  │ Timer     │───▶│ TMUX Injection  │  │
│  │ (tick)    │    │                 │  │
│  └───────────┘    └─────────────────┘  │
│        │                  │            │
│        ▼                  ▼            │
│  ┌───────────┐    ┌─────────────────┐  │
│  │ State     │    │ Read            │  │
│  │ Store     │    │ HEARTBEAT.md    │  │
│  └───────────┘    └─────────────────┘  │
└─────────────────────────────────────────┘

无需代理，纯定时触发
```

### 模式 B：代理增强模式

```
┌─────────────────────────────────────────────────────┐
│              Heartbeat Daemon + Proxy               │
│  ┌─────────────┐        ┌─────────────────────┐    │
│  │ HTTP Proxy  │───────▶│ Finish Reason       │    │
│  │ (optional)  │        │ Interceptor         │    │
│  └─────────────┘        └─────────────────────┘    │
│         │                        │                  │
│         ▼                        ▼                  │
│  ┌─────────────┐        ┌─────────────────────┐    │
│  │ Clock Time  │        │ Trigger on          │    │
│  │ Injection   │        │ finish_reason=stop  │    │
│  └─────────────┘        └─────────────────────┘    │
│                                  │                  │
│                                  ▼                  │
│                         ┌─────────────────────┐    │
│                         │ TMUX Injection      │    │
│                         │ (shared with mode A)│    │
│                         └─────────────────────┘    │
└─────────────────────────────────────────────────────┘

代理拦截 finish_reason，额外触发 heartbeat
```

## 文件结构

```
24h-workers/
├── src/
│   ├── index.ts                 # 主入口
│   │
│   ├── core/                    # 核心模块（独立模式必需）
│   │   ├── daemon.ts            # daemon 主循环
│   │   ├── trigger.ts           # heartbeat 触发逻辑
│   │   ├── state-store.ts       # 状态持久化
│   │   └── config.ts            # 配置管理
│   │
│   ├── tmux/                    # TMUX 注入
│   │   ├── injector.ts          # tmux send-keys 注入
│   │   └── session-probe.ts     # session 存活检测
│   │
│   ├── clock/                   # Clock 时间标签
│   │   └── time-tag.ts          # 时间标签生成
│   │
│   ├── proxy/                   # 代理模块（可选增强）
│   │   ├── server.ts            # HTTP 代理服务器
│   │   ├── request-handler.ts   # 请求转发
│   │   └── response-interceptor.ts  # finish_reason 拦截
│   │
│   └── cli/                     # CLI
│       ├── index.ts             # 入口
│       └── commands/            # 子命令
│
├── package.json
├── tsconfig.json
├── HEARTBEAT.md                 # 默认提示词（用户可编辑）
└── config.json                  # 配置文件
```

## 核心模块设计

### 1. daemon.ts - 独立模式主循环

```typescript
export async function startHeartbeatDaemon(config: HeartbeatConfig): Promise<void> {
  const tick = config.tickMs ?? 15 * 60_000; // 默认 15 分钟

  // 首次立即执行一次
  await runHeartbeatTick();

  // 定时循环
  const timer = setInterval(runHeartbeatTick, tick);
  timer.unref?.();
}

async function runHeartbeatTick(): Promise<void> {
  // 1. 扫描所有已启用的 session
  const sessions = await listEnabledSessions();

  // 2. 检查每个 session 是否需要触发
  for (const session of sessions) {
    if (!isTmuxSessionAlive(session.tmuxSessionId)) {
      await disableSession(session.tmuxSessionId, 'session_not_found');
      continue;
    }

    if (shouldTrigger(session)) {
      await triggerHeartbeat(session);
    }
  }
}
```

### 2. trigger.ts - 心跳触发

```typescript
export async function triggerHeartbeat(session: HeartbeatSession): Promise<void> {
  const workdir = resolveTmuxWorkingDirectory(session.tmuxSessionId);

  // 读取 HEARTBEAT.md 作为提示词
  const prompt = await readHeartbeatPrompt(workdir);

  // 注入时间标签
  const timeTag = buildTimeTag();
  const text = `${timeTag}\n${prompt}`;

  // tmux 注入
  const result = await injectTmuxText(session.tmuxSessionId, text);

  // 更新状态
  await updateSessionState(session.tmuxSessionId, {
    lastTriggeredAtMs: Date.now(),
    triggerCount: session.triggerCount + 1,
    ...(result.ok ? {} : { lastError: result.reason })
  });
}
```

### 3. time-tag.ts - 时间标签

```typescript
export function buildTimeTag(): string {
  const now = new Date();
  return `[Time/Date]: utc=${now.toISOString()} local=${formatLocal(now)} tz=${process.env.TZ || 'UTC'} nowMs=${Date.now()}`;
}
```

### 4. config.ts - 配置

```typescript
export interface HeartbeatConfig {
  // 核心配置
  tickMs?: number;                    // 定时间隔，默认 15 分钟
  promptFile?: string;                // 提示词文件名，默认 HEARTBEAT.md

  // 代理配置（可选）
  proxy?: {
    enabled: boolean;
    anthropicPort?: number;
    openaiPort?: number;
    geminiPort?: number;
  };

  // finish_reason 触发配置（代理模式）
  finishReason?: {
    triggerOn: string[];              // 默认 ['stop']
  };
}
```

## CLI 命令

| 命令 | 描述 |
|------|------|
| `heartbeat start` | 启动 daemon（独立模式） |
| `heartbeat start --with-proxy` | 启动 daemon + 代理 |
| `heartbeat stop` | 停止 daemon |
| `heartbeat trigger -s <session>` | 手动触发一次 |
| `heartbeat status` | 查看状态 |
| `heartbeat list` | 列出所有 session |
| `heartbeat on -s <session>` | 启用 session |
| `heartbeat off -s <session>` | 禁用 session |

## 配置示例

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

## HEARTBEAT.md 模板

```markdown
# Heartbeat Prompt

[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。
```

## 状态存储

位置：`~/.heartbeat/sessions/<session-id>.json`

```json
{
  "version": 1,
  "tmuxSessionId": "codex",
  "enabled": true,
  "createdAtMs": 1742114320826,
  "updatedAtMs": 1742114320826,
  "triggerCount": 5,
  "lastTriggeredAtMs": 1742113400000,
  "lastError": null
}
```

## 核心实现优先级

1. **P0 - 独立模式核心**
   - `core/daemon.ts` - 定时主循环
   - `core/trigger.ts` - 触发逻辑
   - `core/state-store.ts` - 状态存储
   - `tmux/injector.ts` - tmux 注入
   - `tmux/session-probe.ts` - session 检测
   - `clock/time-tag.ts` - 时间标签
   - `cli/` - 基本命令

2. **P1 - 代理增强模式**
   - `proxy/server.ts` - HTTP 代理
   - `proxy/response-interceptor.ts` - finish_reason 拦截

## 测试计划

1. **独立模式测试**
   - daemon 启动/停止
   - tmux 注入正确性
   - 状态持久化
   - 时间标签格式

2. **代理模式测试**
   - 三种协议请求转发
   - finish_reason 提取
   - 触发联动

## 假设与默认值

1. 独立模式无需任何依赖（除了 tmux）
2. 默认 tick 间隔：15 分钟
3. 默认提示词文件：工作目录下的 `HEARTBEAT.md`
4. 状态存储：`~/.heartbeat/`
5. 代理模式默认禁用，需显式启用
6. finish_reason 只处理 `stop`
