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
 * 规范化 tmux session ID
 * 移除 window/pane 后缀，只保留 session 名
 */
export function normalizeTmuxSessionId(sessionId: string): string {
  const trimmed = String(sessionId || '').trim();
  if (!trimmed) {
    return '';
  }
  
  // 移除 window/pane 部分 (session:window.pane -> session)
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex >= 0) {
    return trimmed.slice(0, colonIndex).trim();
  }
  
  return trimmed;
}

/**
 * 检测 tmux session 是否存活
 * 唯一真源：所有 session 存活检测
 */
export function isTmuxSessionAlive(sessionId: string): boolean {
  const normalized = normalizeTmuxSessionId(sessionId);
  if (!normalized) {
    return false;
  }
  
  if (!isTmuxAvailable()) {
    return false;
  }
  
  try {
    const result = spawnSync('tmux', ['has-session', '-t', normalized], { 
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
  const normalized = normalizeTmuxSessionId(sessionId);
  if (!normalized) {
    return undefined;
  }
  
  if (!isTmuxAvailable()) {
    return undefined;
  }
  
  if (!isTmuxSessionAlive(normalized)) {
    return undefined;
  }
  
  try {
    const result = spawnSync(
      'tmux',
      ['display-message', '-p', '-t', normalized, '#{pane_current_path}'],
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
