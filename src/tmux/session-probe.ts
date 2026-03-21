/**
 * TMUX Session Probe Module
 * 检测 tmux session 存活状态和获取工作目录
 * 唯一真源：所有 tmux session 状态检测
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

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
    const sessionName = target;
    const activeTarget = resolveTmuxActiveTarget(sessionName);
    return {
      sessionName,
      target: activeTarget || sessionName
    };
  }
  const sessionName = target.slice(0, separatorIndex).trim();
  return {
    sessionName,
    target
  };
}

/**
 * 根据工作目录解析 tmux 目标 pane
 * 返回 session:window.pane
 */
export function resolveTmuxTargetByWorkdir(workdir: string): string | undefined {
  const candidate = String(workdir || '').trim();
  if (!candidate) {
    return undefined;
  }

  if (!isTmuxAvailable()) {
    return undefined;
  }

  let normalized = candidate;
  try {
    normalized = fs.realpathSync(candidate);
  } catch {
    // fallback to raw path
  }

  try {
    const result = spawnSync('tmux', ['list-panes', '-a', '-F', '#S:#I.#P\t#{pane_current_path}'], {
      encoding: 'utf8',
      timeout: 1000
    });
    if (result.status !== 0) {
      return undefined;
    }
    const lines = String(result.stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
    const matches: string[] = [];
    for (const line of lines) {
      const [target, panePathRaw] = line.split('\t');
      if (!target || !panePathRaw) {
        continue;
      }
      let panePath = panePathRaw.trim();
      let paneReal = panePath;
      try {
        paneReal = fs.realpathSync(panePath);
      } catch {
        // ignore
      }
      if (panePath === candidate || paneReal === normalized) {
        matches.push(target.trim());
      }
    }
    if (matches.length === 0) {
      return undefined;
    }
    if (matches.length === 1) {
      return matches[0];
    }

    // 多个匹配时，优先选当前活跃 pane
    const sessionName = normalizeTmuxSessionTarget(matches[0]);
    const active = resolveTmuxActiveTarget(sessionName);
    if (active && matches.includes(active)) {
      return active;
    }
    return matches[0];
  } catch {
    return undefined;
  }
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
