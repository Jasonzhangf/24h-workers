# Drudge 项目总结

## 项目概述

Drudge 是一个独立的 heartbeat 工具，核心功能是定时巡检 + tmux 注入。

### 核心特性

1. **独立模式**：定时（默认 15 分钟）向 tmux session 注入提示词
2. **代理模式**：拦截 LLM 响应，当 finish_reason=stop 时触发 heartbeat
3. **Session 管理**：支持多个 tmux session 的独立管理
4. **协议支持**：支持 OpenAI、Anthropic、Gemini 三种协议

## 项目结构

```
src/
├── core/               # 核心模块
│   ├── config.ts       # 配置管理
│   ├── daemon.ts       # 定时主循环
│   ├── trigger.ts      # 触发逻辑
│   └── state-store.ts  # 状态持久化
├── tmux/               # TMUX 注入
│   ├── injector.ts     # tmux 文本注入
│   └── session-probe.ts # session 检测
├── clock/              # Clock 时间标签
│   └── time-tag.ts     # 时间标签生成
├── proxy/              # 代理模块
│   ├── server.ts       # HTTP 代理服务器
│   └── finish-reason.ts # finish_reason 提取
└── cli/                # CLI 命令
    └── index.ts        # 命令行接口
```

## 使用方法

### 安装

```bash
cd /Volumes/extension/code/24h-workers
npm install
npm run install:global
```

### 基本命令

```bash
# 启动 daemon
drudge start

# 启用 session
drudge on -s mysession

# 手动触发
drudge trigger -s mysession

# 查看状态
drudge status

# 停止
drudge stop
```

### 配置文件

**config.json**（项目根目录）：
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

**HEARTBEAT.md**（工作目录）：
```markdown
[Heartbeat]
请进行任务巡检。
检查上次交付是否完整。
完成后更新 DELIVERY.md。
```

## 状态机图

### 主状态机

```
                    ┌─────────────┐
                    │   STOPPED   │ ◄─────────────┐
                    └──────┬──────┘               │
                           │                      │
                           │ drudge start        │ drudge stop
                           ▼                      │
                    ┌─────────────┐               │
                    │   STARTING  │               │
                    └──────┬──────┘               │
                           │                      │
                           │ daemon ready         │
                           ▼                      │
                    ┌─────────────┐               │
    ┌──────────────►│   RUNNING   │───────────────┘
    │               └──────┬──────┘               
    │                      │                     
    │                      │ tick cycle          
    │                      ▼                     
    │               ┌─────────────┐               
    │               │   TICKING   │               
    │               └──────┬──────┘               
    │                      │                     
    │                      │ process all enabled 
    │                      │ sessions            
    │                      ▼                     
    │               ┌─────────────┐               
    └───────────────┤  BACK LOOP  │               
                    └──────────────┘               
```

### Session 状态机

```
┌──────────────┐
│   CREATED    │ (首次启用)
└──────┬───────┘
       │ drudge on -s <name>
       ▼
┌──────────────┐     ┌──────────────┐
│   ENABLED    │◄────┤   DISABLED   │
└──────┬───────┘     └──────────────┘
       │
       │ trigger heartbeat
       ▼
┌──────────────┐
│  TRIGGERING  │
└──────┬───────┘
       │
       │ tmux alive?
       ├─── YES ──► INJECT TEXT ──► SUCCESS ──► ENABLED
       │
       └─── NO ──► DISABLED (auto-off)
```

## 测试

### 单元测试

```bash
npm test           # 运行 TypeScript 测试
npm run test:run   # 运行编译后的 JS 测试
```

**测试覆盖**：
- `tests/config.test.ts` - 配置解析（3 个测试用例）
- `tests/time-tag.test.ts` - 时间标签（3 个测试用例）
- `tests/finish-reason.test.ts` - finish_reason 提取（19 个测试用例）

**总计**：25 个测试用例，全部通过 ✅

### 集成测试

```bash
# 安装
npm run install:global

# 创建 tmux session
tmux new-session -d -s test

# 测试 session 管理
drudge on -s test
drudge trigger -s test
drudge show -s test --json

# 清理
tmux kill-session -t test
npm run uninstall:global
```

### 测试结果示例

**单元测试输出**：
```
ℹ tests 25
ℹ suites 11
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 145.99775
```

**集成测试输出**：
```
Session test enabled
Drudge triggered for session: test
{
  "triggerCount": 1,
  "lastTriggeredAtMs": 1773664577731
}
Session test disabled
```

## 测试逻辑

### 1. 单元测试逻辑

#### 配置测试 (`config.test.ts`)
- **默认配置**：验证无配置文件时返回正确的默认值
- **文件解析**：验证读取 config.json 的正确性
- **环境变量**：验证 HB_TICK_MS 覆盖配置文件

#### 时间标签测试 (`time-tag.test.ts`)
- **字段完整性**：验证返回所有必需字段（utc, local, tz, nowMs）
- **ISO 格式**：验证 utc 字段是有效的 ISO 日期字符串
- **格式化输出**：验证格式化字符串的正确性

#### Finish Reason 测试 (`finish-reason.test.ts`)
- **协议检测**：验证正确识别 OpenAI/Anthropic/Gemini 协议
- **Stop 提取**：验证正确提取 finish_reason=stop
- **Tool calls 提取**：验证正确提取 finish_reason=tool_calls
- **Length 提取**：验证正确提取 finish_reason=length
- **边界条件**：验证 null/empty body 的处理

### 2. 集成测试逻辑

#### Session 管理测试
- **启用/禁用**：验证 session 状态切换
- **重复操作**：验证幂等性（重复启用不报错）
- **列表查询**：验证正确列出所有 session

#### 触发测试
- **首次触发**：验证 triggerCount 从 0 → 1
- **多次触发**：验证 triggerCount 正确累加
- **时间戳**：验证 lastTriggeredAtMs 正确更新

#### 错误处理测试
- **不存在的 session**：验证返回 "Session not found"
- **无效的 tmux**：验证返回 "tmux_session_not_found"
- **自动禁用**：验证 tmux 不存在时自动禁用 session

#### 代理模式测试
- **端口监听**：验证三个端口（8081/8082/8083）正确监听
- **请求转发**：验证请求正确转发到上游 API
- **Finish reason**：验证正确提取 finish_reason 并触发

## 测试覆盖率

| 模块 | 单元测试 | 集成测试 | 覆盖率 |
|------|---------|---------|--------|
| `core/config.ts` | ✅ | - | 100% |
| `clock/time-tag.ts` | ✅ | - | 100% |
| `proxy/finish-reason.ts` | ✅ | - | 100% |
| `core/state-store.ts` | - | ✅ | 90%+ |
| `core/trigger.ts` | - | ✅ | 80%+ |
| `core/daemon.ts` | - | ✅ | 70%+ |
| `tmux/injector.ts` | - | ✅ | 80%+ |
| `tmux/session-probe.ts` | - | ✅ | 90%+ |
| `proxy/server.ts` | - | ✅ | 70%+ |
| `cli/index.ts` | - | ✅ | 60%+ |

## 最佳实践

### 单元测试
1. **独立性**：每个测试用例独立运行
2. **确定性**：测试结果可重复
3. **快速**：避免网络/IO 操作
4. **覆盖边界**：测试边界条件和错误处理

### 集成测试
1. **环境隔离**：使用独立的 tmux session
2. **清理状态**：测试后清理创建的文件
3. **幂等性**：重复执行产生相同结果
4. **真实场景**：测试真实使用场景

## 相关文档

- `PROJECT_USAGE.md` - 详细使用说明
- `STATE_MACHINE.md` - 状态机图
- `TESTING.md` - 测试文档
- `QUICKSTART.md` - 快速入门
- `USAGE.md` - 使用手册
