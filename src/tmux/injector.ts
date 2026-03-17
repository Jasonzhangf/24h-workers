/**
 * TMUX Injector Module
 * 向 tmux session 注入文本
 * 唯一真源：所有 tmux 文本注入
 */

import { spawnSync } from 'node:child_process';
import { isTmuxAvailable, isTmuxSessionAlive, resolveTmuxInjectionTarget, normalizeTmuxSessionTarget } from './session-probe.js';

export interface InjectResult {
  ok: boolean;
  reason?: string;
}

/**
 * 规范化要注入的文本
 * - 移除多余空白
 * - 单行化（tmux send-keys -l 对多行支持不好）
 */
function normalizeInjectedText(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join(' ')
    .trim();
}

/**
 * 发送提交键（Enter）
 */
function sendSubmitKey(sessionId: string, clientType?: string): InjectResult {
  const normalizedClientType = String(clientType || '').trim().toLowerCase();
  
  // 不同 client 可能需要不同的提交键
  const submitKeys = ['C-m', 'Enter', 'KPEnter'];
  
  for (const key of submitKeys) {
    try {
      const result = spawnSync('tmux', ['send-keys', '-t', sessionId, key], {
        encoding: 'utf8',
        timeout: 1000
      });
      
      if (result.status === 0) {
        return { ok: true };
      }
    } catch {
      // continue to next key
    }
  }
  
  // 尝试发送字面量回车
  for (const fallback of ['\r', '\n']) {
    try {
      const result = spawnSync('tmux', ['send-keys', '-t', sessionId, '-l', '--', fallback], {
        encoding: 'utf8',
        timeout: 1000
      });
      
      if (result.status === 0) {
        return { ok: true };
      }
    } catch {
      // continue
    }
  }
  
  return { ok: false, reason: 'tmux_submit_failed' };
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 向 tmux session 注入文本
 * 唯一真源：所有 tmux 文本注入
 */
export async function injectTmuxText(input: {
  sessionId: string;
  text: string;
  clientType?: string;
  submit?: boolean;
}): Promise<InjectResult> {
  const resolvedTarget = resolveTmuxInjectionTarget(input.sessionId);
  if (!resolvedTarget.sessionName || !resolvedTarget.target) {
    return { ok: false, reason: 'tmux_session_required' };
  }
  
  const text = normalizeInjectedText(input.text);
  if (!text) {
    return { ok: false, reason: 'empty_text' };
  }
  
  if (!isTmuxAvailable()) {
    return { ok: false, reason: 'tmux_unavailable' };
  }
  
  if (!isTmuxSessionAlive(resolvedTarget.sessionName)) {
    return { ok: false, reason: 'tmux_session_not_found' };
  }
  
  try {
    // 取消可能的 copy mode，确保处于正常模式
    spawnSync('tmux', ['send-keys', '-t', resolvedTarget.target, '-X', 'cancel'], {
      encoding: 'utf8',
      timeout: 500
    });

    // 清空当前输入行，避免拼接残留命令（参考 routecodex）
    spawnSync('tmux', ['send-keys', '-t', resolvedTarget.target, 'C-u'], {
      encoding: 'utf8',
      timeout: 500
    });
    
    // 发送文本（字面量）
    const literalResult = spawnSync('tmux', ['send-keys', '-t', resolvedTarget.target, '-l', '--', text], {
      encoding: 'utf8',
      timeout: 2000
    });
    
    if (literalResult.status !== 0) {
      const detail = String(literalResult.stderr || literalResult.stdout || '').trim();
      return { 
        ok: false, 
        reason: detail ? `tmux_send_failed:${detail.slice(0, 100)}` : 'tmux_send_failed' 
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `tmux_error:${message.slice(0, 100)}` };
  }
  
  // 等待一小段时间让文本显示
  await sleep(80);
  
  // 发送提交键（默认发送）
  if (input.submit !== false) {
    const submitResult = sendSubmitKey(resolvedTarget.target, input.clientType);
    if (!submitResult.ok) {
      return submitResult;
    }
  }
  
  return { ok: true };
}
