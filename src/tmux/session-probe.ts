/**
 * TMUX Session Probe Module
 * 检测 tmux session 存活状态和获取工作目录
 * 唯一真源：所有 tmux session 状态检测
 */

import { spawnSync } from 'node:child_process';

let tmuxAvailableCache: boolean | null = null;

/**
 * 检测 tmux 是否可用
 */
export function isTmuxAvailable(): boolean {
  if (tmuxAvailableCache !== null) {
    return tmuxAvailableCache;
  }
  
  try {
    const result = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
    tmuxAvailableCache = result.status === 0;
  } catch {
    tmuxAvailableCache = false;
  }
  
  return tmuxAvailableCache;
}

/**
 * 规范化 tmux session target
 * 支持格式: session, session:window, session:window.pane
 * 返回 session 名称
 */
export function normalizeTmuxSessionTarget(tmuxSessionId: string): string {
  const target = String(tmuxSessionId || '').trim();
  if (!target) {
    return '';
  }
  const separatorIndex = target.indexOf(':');
  if (separatorIndex < 0) {
    return target;
  }
  return target.slice(0, separatorIndex).trim();
}

/**
 * 解析 tmux 注入目标
 * 返回 sessionName 和完整 target
 */
export function resolveTmuxInjectionTarget(targetRaw: string): { sessionName: string; target: string } {
  const target = String(targetRaw || '').trim();
  if (!target) {
    return { sessionName: '', target: '' };
  }
  const separatorIndex = target.indexOf(':');
  if (separatorIndex < 0) {
    return { sessionName: target, target };
  }
  const sessionName = target.slice(0, separatorIndex).trim();
  return {
    sessionName,
    target
  };
}

/**
 * 检测 tmux session 是否存活
 * 唯一真源：所有 session 存活检测
 */
export function isTmuxSessionAlive(sessionId: string): boolean {
  const target = normalizeTmuxSessionTarget(sessionId);
  if (!target) {
    return false;
  }
  
  if (!isTmuxAvailable()) {
    return false;
  }
  
  try {
    const result = spawnSync('tmux', ['has-session', '-t', target], { 
      encoding: 'utf8',
      timeout: 1000
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 获取 tmux session 的当前工作目录
 * 唯一真源：所有工作目录获取
 */
export function resolveTmuxWorkingDirectory(sessionId: string): string | undefined {
  const target = normalizeTmuxSessionTarget(sessionId);
  if (!target) {
    return undefined;
  }
  
  if (!isTmuxAvailable()) {
    return undefined;
  }
  
  if (!isTmuxSessionAlive(target)) {
    return undefined;
  }
  
  try {
    const result = spawnSync(
      'tmux',
      ['display-message', '-p', '-t', target, '#{pane_current_path}'],
      { encoding: 'utf8', timeout: 1000 }
    );
    
    if (result.status !== 0) {
      return undefined;
    }
    
    const candidate = String(result.stdout || '').trim();
    if (!candidate || !candidate.startsWith('/')) {
      return undefined;
    }
    
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * 获取 tmux session 当前活跃 pane target
 * 唯一真源：所有 session active target 获取
 */
export function resolveTmuxActiveTarget(sessionId: string): string | undefined {
  const target = normalizeTmuxSessionTarget(sessionId);
  if (!target) {
    return undefined;
  }

  if (!isTmuxAvailable()) {
    return undefined;
  }

  if (!isTmuxSessionAlive(target)) {
    return undefined;
  }

  try {
    const result = spawnSync(
      'tmux',
      ['display-message', '-p', '-t', target, '#S:#I.#P'],
      { encoding: 'utf8', timeout: 1000 }
    );

    if (result.status !== 0) {
      return undefined;
    }

    const candidate = String(result.stdout || '').trim();
    return candidate || undefined;
  } catch {
    return undefined;
  }
}
