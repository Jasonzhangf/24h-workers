/**
 * Tmux Helper Functions
 * 用于创建和管理 tmux session 的工具函数
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { logToFile, shellQuote } from './cli-utils.js';

export function createManagedTmuxSession(args: {
  cwd: string;
  sessionName?: string;
}): { sessionName: string; tmuxTarget: string; stop: () => void } | null {
  const { cwd, sessionName: preferredName } = args;
  logToFile(`createManagedTmuxSession called: preferredName=${preferredName}, cwd=${cwd}`);
  const baseName = preferredName || path.basename(cwd);

 // 生成唯一 session 名称
  let sessionName = baseName;
  let attempt = 0;
  while (attempt < 6) {
    if (!isTmuxSessionAlive(sessionName)) {
      // session 不存在，可以使用
      break;
    }
    attempt++;
    sessionName = `${baseName}-${Date.now()}-${attempt}`;
  }

  if (attempt >= 6) {
    logToFile(`Could not find available session name after 6 attempts`);
    return null;
  }

  logToFile(`createManagedTmuxSession: attempting to create session: ${sessionName}`);

 try {
   const result = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', cwd], { encoding: 'utf8' });
   if (result.status !== 0) {
      logToFile(`Failed to create tmux session: ${result.stderr || result.stdout || 'Unknown error'}`);
      return null;
    }
  } catch {
    logToFile(`Failed to create tmux session: exception thrown`);
    return null;
  }

  // 配置终端渲染
  logToFile(`createManagedTmuxSession: session created successfully: ${sessionName}`);
  const tmuxTarget = `${sessionName}:0.0`;
  try {
    spawnSync('tmux', ['set-option', '-t', sessionName, '-g', 'default-terminal', 'tmux-256color'], { encoding: 'utf8' });
} catch { /* ignore */ }

  try {
    spawnSync('tmux', ['set-option', '-t', sessionName, '-ga', 'terminal-features', ',*:RGB'], { encoding: 'utf8' });
  } catch { /* ignore */ }
  // 禁用斜体，避免某些终端渲染问题
  try {
    spawnSync('tmux', ['set-option', '-t', sessionName, '-ga', 'terminal-overrides', ',*:sitm@:ritm@'], { encoding: 'utf8' });
  } catch { /* ignore */ }

  return {
    sessionName,
    tmuxTarget,
    stop: () => {
      try {
        spawnSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8' });
      } catch { /* ignore */ }
    }
  };
}

/**
 * 检测当前 tmux target
 */

export function launchCommandInTmuxPane(args: {
  tmuxTarget: string;
  cwd: string;
  command: string;
  commandArgs: string[];
  env?: Record<string, string>;
}): boolean {
 const { tmuxTarget, cwd, command, commandArgs, env } = args;



  // 构建环境变量令牌（参考 routecodex）
  const envTokens = [
    ...(env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [])
  ];

  // 构建基础命令（参考 routecodex）
  const baseCommand = ['env', ...envTokens, command, ...commandArgs]
    .map((token) => shellQuote(token))
    .join(' ');

  // 构建完整命令（参考 routecodex）
  const commandBody = `cd -- ${shellQuote(cwd)} || exit 1; ${baseCommand}`;
  const shellCommand = `${commandBody}; __exit=$?; exit "$__exit"`;
  logToFile(`launchCommandInTmuxPane: command=${command} args=${JSON.stringify(commandArgs)}`);
  logToFile(`launchCommandInTmuxPane: shellCommand=${shellCommand}`);

 // 使用 respawn-pane 启动命令
 try {
    const respawn = spawnSync('tmux', ['respawn-pane', '-k', '-t', tmuxTarget, shellCommand], { encoding: 'utf8' });
    if (respawn.status === 0) {
      return true;
    }
    logToFile(`respawn-pane failed: ${respawn.stderr || respawn.stdout || 'Unknown error'}`);
  } catch { /* fallback */ }

  // 回退到 send-keys
  try {
    spawnSync('tmux', ['send-keys', '-t', tmuxTarget, '-X', 'cancel'], { encoding: 'utf8' });
    spawnSync('tmux', ['send-keys', '-t', tmuxTarget, 'C-u'], { encoding: 'utf8' });
    const literal = spawnSync('tmux', ['send-keys', '-t', tmuxTarget, '-l', '--', shellCommand], { encoding: 'utf8' });
    if (literal.status !== 0) {
      logToFile(`send-keys failed: ${literal.stderr || literal.stdout || 'Unknown error'}`);
      return false;
    }
    spawnSync('tmux', ['send-keys', '-t', tmuxTarget, 'Enter'], { encoding: 'utf8' });
    return true;
  } catch {
    logToFile(`send-keys exception thrown`);
    return false;
  }
}
