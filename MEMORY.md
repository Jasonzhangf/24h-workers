# Project Memory

## 设计决策

### 2026-03-16: 初始架构设计

1. **双模式设计**: 独立模式（最小核心）+ 代理增强模式
   - 独立模式：纯定时触发，无需代理
   - 代理模式：拦截 finish_reason=stop 时额外触发

2. **模块化原则**:
   - 每个模块全局唯一真源
   - 单文件不超过 500 行
   - 公共函数库 + 模块化 + 应用层编排

3. **配置默认值**:
   - tick 间隔：15 分钟 (900000ms)
   - 提示词文件：HEARTBEAT.md
   - 状态存储：~/.heartbeat/sessions/
   - finish_reason 触发：仅 stop

4. **CLI 命令设计**:
   - start/stop: daemon 启停
   - trigger -s: 手动触发
   - status/list/show: 查看状态
   - on/off: 启用/禁用 session

## 历史问题与解决

### 2026-03-21: drudge.review 独立工具重写
- **问题**: drudge.review 之前有多层问题：
  1. `emitReviewToolLogs()` 在 review 执行前就写入 `completed_client_inject_only`，产生误导性日志
  2. 使用 `resolveTmuxTargetByWorkdir` 可能注入到非 drudge 启动的 session（如从 24h-workers 目录 `-s routecodex` 会交叉污染）
  3. codex exec 的 prompt 没有只读约束，导致 codex 自动修改代码（创建 cmdHello.ts 等垃圾文件）
  4. 与 routecodex servertool 的 review 功能混淆，用户多次指出"和 servertool 没有关系"
  5. 之前加入的 codex capability 检测逻辑（`detectCodexExecCapabilities`）过度复杂
- **根因**: drudge.review 的定位不清晰——它应该是调用系统 `codex exec` 的独立 CLI 工具，而不是 servertool 的一部分
- **解决**:
  1. 重写 `src/cli/cmdReview.ts`（168行），简化为：调用 `codex exec -C <cwd> --output-last-message <file>` + tmux 注入
  2. 移除 `emitReviewToolLogs()`、`resolveTmuxTargetByWorkdir`、`detectCodexExecCapabilities`
  3. prompt 加入只读约束：禁止修改代码、禁止创建文件、禁止 file update/apply_patch
  4. `-C <cwd>` 通过 spawnSync 的 cwd 传入（codex exec review 子命令不支持 -C）
  5. CliOptions 新增 `cwd` 字段，index.ts 解析 `-C/--cwd` 全局选项
  6. 注入目标改为 `resolveTmuxActiveTarget(sessionId)` 确保注入到活跃 pane
- **验证**: routecodex session 成功收到完整 review 结果注入（codex 逐条检查了 heartbeat checklist、Rust 主线任务、交付证据）
- **教训**: 当用户说"和 X 没关系"时，必须立即停止搜索 X 的代码，先理解正确的架构意图

### 2026-03-21: drudge.review 支持可配置工具
- **需求**: review 使用 codex/claude code 等需可文本配置，用户可自定义参数
- **实现**:
  1. `~/.drudge/review-config.json` 支持设置 default tool + tools 配置
  2. `--tool <name>` CLI 选项可覆盖默认工具
  3. `DRUDGE_REVIEW_TOOL` 环境变量支持全局覆盖
  4. `cmdReview.ts` 根据配置展开参数模板（{cwd}/{output}/{prompt}/{profile}）
- **默认工具**:
  - `codex`: `codex exec --output-last-message {output} {prompt}`（含 skip-git-repo-check + bypass）
  - `claude`: `claude --dangerously-skip-permissions --print {prompt}`
- **验证**: build + tests 35/35 通过

### 2026-03-21: session resolve（路径反查）+ review 自动解析
- **需求**: 不能盲猜 session；需提供路径反查并支持 review 自动解析
- **实现**:
  1. 新增命令 `drudge session resolve -C <dir>`
  2. 支持 `--json` 输出，用于自动化确认 sessionId
  3. `drudge review` 在未指定 `-s` 时按路径自动解析 session（失败则报错）
- **验证**: build + tests 35/35 通过

### 2026-03-21: alarm store 测试权限错误 + 静默失败修复
### 2026-03-21: alarm store 测试权限错误 + 静默失败修复
- **问题**: alarm store 测试在受限环境写入 `~/.drudge/alarms.json` 失败（EPERM），且 `readAlarmsFile` 吞掉所有异常导致静默失败。
- **解决**:
  1. `src/alarm/store.ts` 支持 `DRUDGE_ALARMS_DIR` / `DRUDGE_ALARMS_FILE` 显式覆盖存储路径，用于测试隔离。
  2. `readAlarmsFile` 仅对 `ENOENT` 返回空对象，其余错误抛出明确异常（不再静默 fallback）。
  3. `tests/alarm/store.test.ts` 使用临时目录并在用例前后清理，避免污染用户目录。
- **验证**: `npm test` 通过（tmux 注入测试在无权限环境下跳过）。

### 2026-03-16: TypeScript 类型错误
- **问题**: `string | false` 不能赋值给 `boolean`
- **原因**: `filter((item): item is string => typeof item === 'string' && item.trim())` 中 `item.trim()` 返回 `string`，在 falsy 时为 `""` (空字符串)，而 TypeScript 认为空字符串是 falsy 但类型仍是 string
- **解决**: 使用 `Boolean(item.trim())` 显式转换

### 2025-07-15: createManagedTmuxSession 不可达代码修复
- **问题**: `src/cli/index.ts` 中 `createManagedTmuxSession` 函数，`if (attempt >= 6) { return null; }` 块后存在不可达代码。
- **原因**: `logToFile(...attempting to create...)` 被错误缩进在 `return null` 之后（原在 `if` 块内部），导致该行及后续 tmux session 创建逻辑永远不会执行。
- **解决**: 将 `logToFile` 调用移出 `if` 块，使其在 session 名称可用时正常执行。
- **文件**: `src/cli/index.ts` 约第 76-80 行

## 技术债务

（已清零）



## 项目心跳配置

### 默认配置目录

**配置文件位置**: `~/.drudge/config.json`

**配置结构**:
```json
{
  "version": "1.0.0",
  "projects": [
    {
      "path": "/path/to/project",
      "heartbeatIntervalMs": 900000,
      "promptFile": "~/.drudge/HEARTBEAT.md"
    }
  ],
  "default": {
    "heartbeatIntervalMs": 900000,
    "promptFile": "~/.drudge/HEARTBEAT.md"
  }
}
```

**字段说明**:
- `projects`: 项目特定配置列表
  - `path`: 项目路径（支持软链接和实际路径）
  - `heartbeatIntervalMs`: 心跳间隔（毫秒）
  - `promptFile`: 心跳提示词文件路径
- `default`: 默认配置（当项目不匹配时使用）

### 软链接处理

**问题**: 如果项目路径是软链接，可能导致配置匹配失败。

**解决方案**: 代码自动解析软链接，同时支持真实路径和软链接路径匹配。

**示例**:
```json
{
  "projects": [
    {
      "path": "/Users/fanzhang/github/routecodex",  // 软链接路径
      "heartbeatIntervalMs": 3600000
    }
  ]
}
```

实际代码会自动解析 `/Users/fanzhang/github/routecodex` 到 `/Users/fanzhang/Documents/github/routecodex`，确保配置匹配。

### 热加载

**当前限制**: 配置文件修改后需要重启 daemon 才能生效。

**配置热加载**:
```bash
# 1. 停止 daemon
drudge daemon stop

# 2. 修改配置文件
vim ~/.drudge/config.json

# 3. 重新启动 daemon
drudge daemon start
```

**优化建议**: 未来可以实现配置文件监听，自动重新加载配置。

### 常用心跳间隔

- 15分钟: 900000ms
- 30分钟: 1800000ms
- 1小时: 3600000ms
- 2小时: 7200000ms
- 6小时: 21600000ms
- 12小时: 43200000ms
- 24小时: 86400000ms

### 配置示例

**routecodex 项目配置**:
```json
{
  "path": "/Users/fanzhang/github/routecodex",
  "heartbeatIntervalMs": 3600000,  // 1小时
  "promptFile": "~/.drudge/HEARTBEAT.md"
}
```

**24h-workers 项目配置**:
```json
{
  "path": "/Volumes/extension/code/24h-workers",
  "heartbeatIntervalMs": 900000,  // 15分钟
  "promptFile": "~/.drudge/HEARTBEAT.md"
}
```

---

## 项目完成状态

- [x] 24h-workers-1.1: 实现 core/ 核心模块
- [x] 24h-workers-1.2: 实现 tmux/ 模块
- [x] 24h-workers-1.3: 实现 clock/ 模块
- [x] 24h-workers-1.4: 实现 cli/ 命令
- [x] 24h-workers-1.5: 实现 proxy/ 代理模块（P1）
- [x] 24h-workers-1.6: 编写测试用例（P1）

**项目状态**: ✅ 完成
**代码统计**: 2127 行，13 个文件
**测试结果**: 25/25 通过
