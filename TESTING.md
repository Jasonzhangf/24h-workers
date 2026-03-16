# Drudge 测试文档

## 一、测试概览

本项目使用 Node.js 内置测试框架（`node:test`），支持 TypeScript 测试（通过 tsx）。

### 测试命令

```bash
# 运行 TypeScript 源码测试（开发模式）
npm test

# 运行编译后 JS 测试（生产模式）
npm run test:run
```

## 二、单元测试

### 2.1 测试文件位置

```
tests/
├── config.test.ts          # 配置模块测试
├── time-tag.test.ts        # 时间标签测试
└── finish-reason.test.ts   # finish_reason 提取测试
```

### 2.2 单元测试详情

#### 2.2.1 配置模块测试 (`tests/config.test.ts`)

**测试目标**：`src/core/config.ts` - 配置解析

**测试用例**：
```
resolveConfig
├── should return default config when no config file exists
│   └── 验证：无配置文件时返回默认值
│       - tickMs = 15 * 60_000
│       - promptFile = "HEARTBEAT.md"
│       - proxy.enabled = false
│
├── should parse custom config file
│   └── 验证：读取项目根目录 config.json
│
└── should override with env vars
    └── 验证：环境变量 HB_TICK_MS 覆盖配置文件
```

**运行方法**：
```bash
npm test -- --test-name-pattern "resolveConfig"
```

#### 2.2.2 时间标签测试 (`tests/time-tag.test.ts`)

**测试目标**：`src/clock/time-tag.ts` - 时间标签生成

**测试用例**：
```
buildTimeTag
├── should return time tag with all fields
│   └── 验证：返回 utc, local, tz, nowMs 字段
│
└── should return valid ISO date string for utc
    └── 验证：utc 字段是有效的 ISO 日期字符串

formatTimeTag
└── should format time tag as string
    └── 验证：输出格式为 [Time/Date]: utc=... local=... tz=... nowMs=...

buildTimeTagLine
└── should return formatted time line
    └── 验证：返回非空字符串
```

**运行方法**：
```bash
npm test -- --test-name-pattern "buildTimeTag\|formatTimeTag\|buildTimeTagLine"
```

#### 2.2.3 Finish Reason 测试 (`tests/finish-reason.test.ts`)

**测试目标**：`src/proxy/finish-reason.ts` - 从三种协议响应中提取 finish_reason

**测试用例**：
```
detectProtocol
├── should detect OpenAI Chat Completions   (/v1/chat/completions)
├── should detect OpenAI Responses API      (/v1/responses)
├── should detect Anthropic Messages        (/v1/messages)
├── should detect Gemini                    (/v1beta/models/...:generateContent)
└── should default to openai for unknown paths

extractFinishReason
├── OpenAI Chat Completions
│   ├── should extract stop finish_reason        → shouldTrigger: true
│   ├── should extract tool_calls finish_reason  → shouldTrigger: false
│   └── should extract length finish_reason      → shouldTrigger: false
│
├── OpenAI Responses API
│   ├── should detect completed status as stop
│   └── should detect requires_action as tool_calls
│
├── Anthropic
│   ├── should extract end_turn as stop
│   ├── should extract tool_use as tool_calls
│   └── should extract max_tokens as length
│
├── Gemini
│   ├── should extract STOP as stop
│   ├── should extract SAFETY as content_filter
│   └── should extract MAX_TOKENS as stop
│
└── Edge cases
    ├── should return undefined for null body
    └── should return undefined for empty body
```

**运行方法**：
```bash
npm test -- --test-name-pattern "detectProtocol\|extractFinishReason"
```

### 2.3 单元测试覆盖率

| 模块 | 测试文件 | 覆盖功能 |
|------|---------|---------|
| `core/config.ts` | `config.test.ts` | 配置解析、默认值、环境变量覆盖 |
| `clock/time-tag.ts` | `time-tag.test.ts` | 时间标签生成、格式化 |
| `proxy/finish-reason.ts` | `finish-reason.test.ts` | 协议检测、finish_reason 提取 |

**未覆盖模块**（需要集成测试）：
- `core/daemon.ts` - daemon 启停
- `core/trigger.ts` - heartbeat 触发
- `core/state-store.ts` - session 状态管理
- `tmux/injector.ts` - tmux 文本注入
- `tmux/session-probe.ts` - session 检测
- `proxy/server.ts` - HTTP 代理服务器

## 三、集成测试

### 3.1 集成测试方法

由于集成测试涉及 tmux 和网络依赖，采用手动测试脚本方式：

```bash
# 安装 drudge
npm run install:global

# 创建 tmux session
tmux new-session -d -s test-session

# 测试 session 管理
drudge on -s test-session
drudge list
drudge show -s test-session --json

# 测试触发
drudge trigger -s test-session

# 验证状态更新
drudge show -s test-session --json
# 期望: triggerCount: 1, lastTriggeredAtMs: <timestamp>

# 测试禁用
drudge off -s test-session

# 清理
tmux kill-session -t test-session
rm ~/.heartbeat/sessions/test-session.json
npm run uninstall:global
```

### 3.2 集成测试场景

#### 3.2.1 Session 管理测试

```bash
# 测试启用/禁用
drudge on -s test
drudge show -s test --json  # 期望: enabled: true
drudge off -s test
drudge show -s test --json  # 期望: enabled: false

# 测试重复启用（幂等性）
drudge on -s test
drudge on -s test  # 期望: 正常处理，不报错
```

#### 3.2.2 触发测试

```bash
# 创建 tmux session
tmux new-session -d -s test

# 首次触发
drudge on -s test
drudge trigger -s test
drudge show -s test --json
# 期望: triggerCount: 1, lastTriggeredAtMs: <timestamp>

# 多次触发
drudge trigger -s test
drudge trigger -s test
drudge show -s test --json
# 期望: triggerCount: 3
```

#### 3.2.3 错误处理测试

```bash
# 不存在的 session
drudge show -s nonexistent
# 期望: Error: Session not found, Code: not_found

# 无效的 tmux session
drudge on -s nonexistent
drudge trigger -s nonexistent
# 期望: Error: tmux_session_not_found
```

#### 3.2.4 代理模式测试

```bash
# 修改 config.json: proxy.enabled = true

# 启动代理模式
drudge start --with-proxy

# 验证端口监听
lsof -i :8081  # Anthropic (期望: node LISTEN)
lsof -i :8082  # OpenAI (期望: node LISTEN)
lsof -i :8083  # Gemini (期望: node LISTEN)

# 发送测试请求（需要真实 API key）
curl -X POST http://localhost:8082/v1/chat/completions \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY" \
-d '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}'

# 停止
drudge stop
```

### 3.3 集成测试检查清单

| 场景 | 测试步骤 | 期望结果 |
|------|---------|---------|
| Session 启用 | `drudge on -s test` | 创建 session 文件，enabled: true |
| Session 禁用 | `drudge off -s test` | enabled: false |
| Session 列表 | `drudge list` | 显示所有 session 状态 |
| Session 详情 | `drudge show -s test --json` | JSON 格式输出完整状态 |
| 手动触发 | `drudge trigger -s test` | triggerCount++，lastTriggeredAtMs 更新 |
| 触发计数 | 多次 `drudge trigger` | triggerCount 正确累加 |
| 不存在 session | `drudge show -s x` | Error: Session not found |
| 无效 tmux | `drudge trigger -s x` | Error: tmux_session_not_found |
| 代理启动 | `drudge start --with-proxy` | 三个端口监听 |
| 代理转发 | curl 请求 | 正确转发到上游 API |

## 四、测试运行示例

### 4.1 单元测试输出

```
> drudge@0.1.0 test
> node --import tsx --test tests/**/*.test.ts

▶ resolveConfig
  ✔ should return default config when no config file exists (0.655ms)
  ✔ should parse custom config file (0.215ms)
  ✔ should override with env vars (0.062ms)
✔ resolveConfig (1.337ms)

▶ detectProtocol
  ✔ should detect OpenAI Chat Completions (0.314ms)
  ✔ should detect OpenAI Responses API (0.048ms)
  ✔ should detect Anthropic Messages (0.050ms)
  ✔ should detect Gemini (0.051ms)
  ✔ should default to openai for unknown paths (0.044ms)
✔ detectProtocol (0.932ms)

▶ extractFinishReason
  ▶ OpenAI Chat Completions
    ✔ should extract stop finish_reason (0.116ms)
    ✔ should extract tool_calls finish_reason (0.051ms)
    ✔ should extract length finish_reason (0.051ms)
  ✔ OpenAI Chat Completions (0.303ms)
  ... (更多测试用例)

ℹ tests 25
ℹ suites 11
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

### 4.2 集成测试输出

```
Session test enabled
Drudge triggered for session: test
{
  "version": 1,
  "sessionId": "test",
  "enabled": true,
  "createdAtMs": 1773664577542,
  "updatedAtMs": 1773664577731,
  "triggerCount": 1,
  "lastTriggeredAtMs": 1773664577731,
  "alive": true
}
Session test disabled
```

## 五、测试最佳实践

### 5.1 单元测试原则

1. **独立性**：每个测试用例独立运行，不依赖其他测试
2. **确定性**：测试结果可重复，不依赖外部状态
3. **快速**：单元测试应快速执行，避免网络/IO 操作
4. **覆盖边界**：测试边界条件、错误处理、空值处理

### 5.2 集成测试原则

1. **环境隔离**：使用独立的 tmux session 和状态目录
2. **清理状态**：测试后清理创建的 session 文件
3. **幂等性**：重复执行测试应产生相同结果
4. **真实场景**：测试真实使用场景，而非实现细节

### 5.3 测试覆盖率目标

| 模块类型 | 目标覆盖率 |
|---------|-----------|
| 工具函数（config, time-tag, finish-reason） | 100% |
| 状态管理（state-store） | 90%+ |
| 外部交互（tmux, proxy） | 集成测试覆盖 |
| CLI 命令 | 端到端测试覆盖 |
