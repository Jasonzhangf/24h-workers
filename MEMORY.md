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

### 2026-03-16: TypeScript 类型错误
- **问题**: `string | false` 不能赋值给 `boolean`
- **原因**: `filter((item): item is string => typeof item === 'string' && item.trim())` 中 `item.trim()` 返回 `string`，在 falsy 时为 `""` (空字符串)，而 TypeScript 认为空字符串是 falsy 但类型仍是 string
- **解决**: 使用 `Boolean(item.trim())` 显式转换

## 技术债务

（已清零）

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
