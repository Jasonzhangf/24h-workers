/**
 * Heartbeat Daemon Module
 * 定时主循环
 * 唯一真源：所有 daemon 启停
 */

import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { triggerHeartbeat, shouldTrigger } from './trigger.js';
import { 
  listEnabledSessions, 
  loadSession, 
  updateSession 
} from './state-store.js';
import type { HeartbeatConfig } from './config.js';

export interface DaemonState {
  started: boolean;
  timer?: NodeJS.Timeout;
  config?: HeartbeatConfig;
}

const daemonState: DaemonState = {
  started: false
};

/**
 * 运行一次 tick
 */
async function runTick(config: HeartbeatConfig): Promise<void> {
  const stateDir = config.stateDir || '~/.drudge';
  const tickMs = config.tickMs || 15 * 60 * 1000;
  const promptFile = config.promptFile || '~/.drudge/HEARTBEAT.md';

  const sessions = listEnabledSessions({ stateDir });
  
  for (const session of sessions) {
    try {
      // 检查 session 是否存活
      if (!isTmuxSessionAlive(session.sessionId)) {
        await disableSession(session.sessionId, 'session_not_found', config);
        continue;
      }
      
      // 检查是否需要触发
      if (!shouldTrigger(session, tickMs)) {
        continue;
      }
      
      // 触发 heartbeat
      const result = await triggerHeartbeat(session, {
        promptFile
      });
      
      if (result.ok) {
        // 更新成功状态
        updateSession(session.sessionId, {
          triggerCount: session.triggerCount + 1,
          lastTriggeredAtMs: Date.now(),
          lastError: undefined
        }, { stateDir });
      } else {
        // 更新失败状态
        updateSession(session.sessionId, {
          lastError: result.reason
        }, { stateDir });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Drudge] Error processing session ${session.sessionId}:`, message);
    }
  }
}

/**
 * 禁用 session
 */
async function disableSession(
  sessionId: string,
  reason: string,
  config: HeartbeatConfig
): Promise<void> {
  const stateDir = config.stateDir || '~/.drudge';
  updateSession(sessionId, {
    enabled: false,
    lastError: reason
  }, { stateDir });
}

/**
 * 启动 daemon
 * 唯一真源：所有 daemon 启动
 */
export async function startDaemon(config: HeartbeatConfig): Promise<void> {
  if (daemonState.started) {
    console.log('[Drudge] Daemon already running');
    return;
  }
  
  daemonState.started = true;
  daemonState.config = config;

  const tickMs = config.tickMs || 15 * 60 * 1000;
  
  console.log(`[Drudge] Starting daemon with tick=${tickMs}ms`);
  
  // 首次立即执行
  await runTick(config);
  
  // 设置定时器
  daemonState.timer = setInterval(async () => {
    if (!daemonState.started || !daemonState.config) {
      return;
    }
    await runTick(daemonState.config);
  }, tickMs);
  
  // 允许进程退出时自动停止
  daemonState.timer.unref?.();
  
  console.log('[Drudge] Daemon started');
}

/**
 * 停止 daemon
 * 唯一真源：所有 daemon 停止
 */
export function stopDaemon(): void {
  if (!daemonState.started) {
    return;
  }
  
  if (daemonState.timer) {
    clearInterval(daemonState.timer);
    daemonState.timer = undefined;
  }
  
  daemonState.started = false;
  daemonState.config = undefined;
  
  console.log('[Drudge] Daemon stopped');
}

/**
 * 检查 daemon 是否运行
 */
export function isDaemonRunning(): boolean {
  return daemonState.started;
}

/**
 * 获取 daemon 状态
 */
export function getDaemonState(): DaemonState {
  return { ...daemonState };
}

/**
 * 手动触发一次（不受 tick 限制）
 */
export async function triggerOnce(
  sessionId: string,
  config: HeartbeatConfig
): Promise<{ ok: boolean; reason?: string }> {
  const stateDir = config.stateDir || '~/.drudge';
  const promptFile = config.promptFile || '~/.drudge/HEARTBEAT.md';

  const session = loadSession(sessionId, { stateDir });
  
  if (!session) {
    return { ok: false, reason: 'session_not_found' };
  }
  
  if (!session.enabled) {
    return { ok: false, reason: 'session_disabled' };
  }
  
  if (!isTmuxSessionAlive(sessionId)) {
    return { ok: false, reason: 'tmux_session_not_found' };
  }
  
  const result = await triggerHeartbeat(session, {
    promptFile
  });
  
  if (result.ok) {
    updateSession(sessionId, {
      triggerCount: session.triggerCount + 1,
      lastTriggeredAtMs: Date.now(),
      lastError: undefined
    }, { stateDir });
  }
  
  return result;
}
