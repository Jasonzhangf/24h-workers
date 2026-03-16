/**
 * Heartbeat Trigger Module
 * Heartbeat 触发逻辑
 * 唯一真源：所有 heartbeat 触发
 */

import fs from 'node:fs';
import path from 'node:path';
import { injectTmuxText } from '../tmux/injector.js';
import { resolveTmuxWorkingDirectory } from '../tmux/session-probe.js';
import { buildTimeTagLine } from '../clock/time-tag.js';
import type { HeartbeatSession } from './state-store.js';

export interface TriggerOptions {
  promptFile?: string;
  workdir?: string;
  clientType?: string;
}

/**
 * 读取提示词文件
 * 唯一真源：所有提示词读取
 */
export function readHeartbeatPrompt(options: {
  promptFile?: string;
  workdir?: string;
}): string {
  const promptFile = options.promptFile || 'HEARTBEAT.md';
  
  // 如果指定了工作目录，优先从工作目录读取
  if (options.workdir) {
    const workdirPath = path.join(options.workdir, promptFile);
    if (fs.existsSync(workdirPath)) {
      try {
        return fs.readFileSync(workdirPath, 'utf8');
      } catch {
        // fallback to cwd
      }
    }
  }
  
  // 从当前目录读取
  if (fs.existsSync(promptFile)) {
    try {
      return fs.readFileSync(promptFile, 'utf8');
    } catch {
      return '';
    }
  }
  
  return '';
}

/**
 * 构建注入文本
 */
export function buildInjectText(prompt: string): string {
  const timeTag = buildTimeTagLine();
  return `${timeTag}\n\n${prompt}`;
}

/**
 * 触发 heartbeat
 * 唯一真源：所有 heartbeat 触发
 */
export async function triggerHeartbeat(
  session: HeartbeatSession,
  options?: TriggerOptions
): Promise<{
  ok: boolean;
  reason?: string;
  workdir?: string;
}> {
  // 检查 session 是否启用
  if (!session.enabled) {
    return { ok: false, reason: 'session_disabled' };
  }
  
  // 解析工作目录
  const workdir = options?.workdir || resolveTmuxWorkingDirectory(session.sessionId);
  
  // 读取提示词
  const prompt = readHeartbeatPrompt({
    promptFile: options?.promptFile,
    workdir
  });
  
  if (!prompt.trim()) {
    return { ok: false, reason: 'prompt_not_found', workdir };
  }
  
  // 构建注入文本
  const injectText = buildInjectText(prompt);
  
  // 注入到 tmux
  const result = await injectTmuxText({
    sessionId: session.sessionId,
    text: injectText,
    clientType: options?.clientType,
    submit: true
  });
  
  if (!result.ok) {
    return { ok: false, reason: result.reason, workdir };
  }
  
  return { ok: true, workdir };
}

/**
 * 检查是否应该触发
 */
export function shouldTrigger(session: HeartbeatSession, tickMs: number): boolean {
  if (!session.enabled) {
    return false;
  }
  
  // 首次触发
  if (!session.lastTriggeredAtMs) {
    return true;
  }
  
  // 检查是否过了 tick 间隔
  const now = Date.now();
  const elapsed = now - session.lastTriggeredAtMs;
  return elapsed >= tickMs;
}
