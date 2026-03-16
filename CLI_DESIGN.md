# Drudge CLI 设计

## 使用方式

Drudge 配合 codex 或 claude code 使用，透传所有参数：

```bash
# 启动 codex（透传所有参数）
drudge codex <any codex args...>

# 启动 claude code（透传所有参数）
drudge claude <any claude args...>

# 例如：
drudge codex --model gpt-4 --prompt "hello"
drudge claude --model claude-3-opus
```

## CLI 命令结构

```
drudge <command> [args...]

Commands:
  codex [args...]      启动 codex，透传所有参数
  claude [args...]     启动 claude code，透传所有参数
  start                启动 heartbeat daemon
  stop                 停止 heartbeat daemon
  trigger -s <id>      触发 heartbeat
  status               查看状态
  list                 列出 session
  show -s <id>         查看 session 详情
  on -s <id>           启用 session
  off -s <id>          禁用 session
```

## 实现方案

### 1. 添加 `codex` 命令

```typescript
async function cmdCodex(args: string[]): Promise<void> {
  // 启动 heartbeat daemon（后台）
  const config = resolveConfig();
  if (!isDaemonRunning()) {
    await startDaemon(config);
  }
  
  // 启用当前 session
  const sessionId = resolveCurrentSessionId();
  setSessionEnabled(sessionId, true, { stateDir: config.stateDir });
  
  // 透传所有参数给 codex
  const codexArgs = ['codex', ...args];
  execSync(codexArgs.join(' '), { stdio: 'inherit' });
}
```

### 2. 添加 `claude` 命令

```typescript
async function cmdClaude(args: string[]): Promise<void> {
  // 启动 heartbeat daemon（后台）
  const config = resolveConfig();
  if (!isDaemonRunning()) {
    await startDaemon(config);
  }
  
  // 启用当前 session
  const sessionId = resolveCurrentSessionID();
  setSessionEnabled(sessionId, true, { stateDir: config.stateDir });
  
  // 透传所有参数给 claude
  const claudeArgs = ['claude', ...args];
  execSync(claudeArgs.join(' '), { stdio: 'inherit' });
}
```

### 3. 修改 main 函数

```typescript
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }
  
  const command = args[0];
  
  // 特殊命令：透传所有参数
  if (command === 'codex') {
    await cmdCodex(args.slice(1));
    return;
  }
  
  if (command === 'claude') {
    await cmdClaude(args.slice(1));
    return;
  }
  
  // 其他命令...
  switch (command) {
    case 'start':
      await cmdStart(options);
      break;
    // ...
  }
}
```

## Session ID 解析

```typescript
function resolveCurrentSessionId(): string {
  // 1. 检查 TMUX 环境变量
  const tmuxSession = process.env.TMUX_SESSION;
  if (tmuxSession) {
    return tmuxSession;
  }
  
  // 2. 检查 tmux 当前 session
  try {
    const result = execSync('tmux display-message -p "#S"', {
      encoding: 'utf8'
    });
    return result.trim();
  } catch {
    // fallback
  }
  
  // 3. 使用默认 session
  return 'default';
}
```

## 使用示例

```bash
# 启动 codex
drudge codex --model gpt-4

# 启动 claude
drudge claude --model claude-3-opus

# 查看状态
drudge status

# 手动触发
drudge trigger -s mysession
```
