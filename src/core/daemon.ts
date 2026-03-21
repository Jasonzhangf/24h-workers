/**
 * Heartbeat Daemon Module
 * 定时主循环
 * 唯一真源：所有 daemon 启停
 */

import fs from 'node:fs';
import path from 'node:path';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { triggerHeartbeat, shouldTrigger } from './trigger.js';
import {
  listEnabledSessions,
  loadSession,
  updateSession,
  deleteSession
} from './state-store.js';
import { getProjectConfig } from './config.js';
import { listAlarms, updateAlarm, removeAlarm } from '../alarm/store.js';
import { shouldAlarmTrigger } from '../alarm/cron-parser.js';
import { triggerAlarm } from '../cli/alarm-trigger.js';
import type { HeartbeatConfig } from './config.js';

export interface DaemonState {
  started: boolean;
  timer?: NodeJS.Timeout;
  config?: HeartbeatConfig;
}

const daemonState: DaemonState = {
  started: false
};

// PID file path
function getPidFilePath(): string {
  const homeDir = process.env.HOME || '~';
  return path.join(homeDir, '.drudge', 'daemon.pid');
}

/**
 * Write PID file
 */
function writePidFile(): void {
  const pidFile = getPidFilePath();
  const pid = process.pid;
  try {
    const dir = path.dirname(pidFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(pidFile, String(pid), 'utf-8');
  } catch (error) {
    console.error('[Drudge] Failed to write PID file:', error);
  }
}

/**
 * Read PID from PID file
 */
function readPidFile(): number | null {
  const pidFile = getPidFilePath();
  try {
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Delete PID file
 */
function deletePidFile(): void {
  const pidFile = getPidFilePath();
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch (error) {
    console.error('[Drudge] Failed to delete PID file:', error);
  }
}

/**
 * Check if process is running by PID
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists without killing it
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取项目心跳间隔
 */
function getProjectHeartbeatInterval(sessionId: string): number {
  try {
    // 遍历配置文件中的所有项目，找到匹配的项目
    const configPath = path.join(process.env.HOME || '~', '.drudge', 'config.json');
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as HeartbeatConfig;
    
    // 查找匹配的项目
    for (const project of config.projects) {
      const projectName = path.basename(project.path);
      if (projectName === sessionId) {
        return project.heartbeatIntervalMs;
      }
    }
    
    // 如果没有找到匹配的项目，使用默认值
    return config.default.heartbeatIntervalMs || 15 * 60 * 1000;
  } catch {
    // 如果读取配置文件失败，使用默认值
    return 15 * 60 * 1000;
  }
}

/**
 * 运行一次闹钟 tick
 */
async function runAlarmTick(stateDir: string): Promise<void> {
  const alarms = listAlarms();

  for (const alarm of alarms) {
    try {
      if (!shouldAlarmTrigger(alarm)) {
        continue;
      }

      const result = await triggerAlarm(alarm);

      if (result.ok) {
      } else {
        console.error(`[Drudge] Alarm "${alarm.id}" trigger failed: ${result.error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Drudge] Error processing alarm ${alarm.id}:`, message);
    }
  }
}

/**
 * 运行一次 tick
 */
async function runTick(config: HeartbeatConfig): Promise<void> {
  const stateDir = config.stateDir || '~/.drudge';
  const tickMs = config.tickMs || 15 * 60 * 1000;
  const promptFile = config.promptFile || '~/.drudge/HEARTBEAT.md';
  const maxNotFound = 3;

  const sessions = listEnabledSessions({ stateDir });
  
  for (const session of sessions) {
    try {
      // 检查 session 是否存活
      if (!isTmuxSessionAlive(session.sessionId)) {
        const nextNotFound = (session.notFoundCount ?? 0) + 1;
        if (nextNotFound >= maxNotFound) {
          // 不再删除 session 文件，只 disable 并记录日志
          console.error(`[Drudge] Session "${session.sessionId}" not found ${nextNotFound} times, disabling (not deleting)`);
          updateSession(session.sessionId, {
            enabled: false,
            lastError: 'session_not_found',
            notFoundCount: nextNotFound
          }, { stateDir });
          continue;
        }
        updateSession(session.sessionId, {
          lastError: 'session_not_found',
          notFoundCount: nextNotFound
        }, { stateDir });
        continue;
      }
      
      // 获取项目特定的心跳间隔
      const projectHeartbeatInterval = getProjectHeartbeatInterval(session.sessionId);
      
      // 检查是否需要触发（使用项目特定的心跳间隔）
      if (!shouldTrigger(session, projectHeartbeatInterval)) {
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
          lastError: undefined,
          notFoundCount: 0
        }, { stateDir });
      } else {
        const isNotFound = result.reason === 'tmux_session_not_found' || result.reason === 'session_not_found';
        if (isNotFound) {
          const nextNotFound = (session.notFoundCount ?? 0) + 1;
          if (nextNotFound >= maxNotFound) {
            console.error(`[Drudge] Session "${session.sessionId}" not found ${nextNotFound} times after trigger, disabling (not deleting)`);
            updateSession(session.sessionId, {
              enabled: false,
              lastError: result.reason,
              notFoundCount: nextNotFound
            }, { stateDir });
            continue;
          }
          updateSession(session.sessionId, {
            lastError: result.reason,
            notFoundCount: nextNotFound
          }, { stateDir });
        } else {
          // 更新失败状态
          updateSession(session.sessionId, {
            lastError: result.reason,
            notFoundCount: 0
          }, { stateDir });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Drudge] Error processing session ${session.sessionId}:`, message);
    }
  }

  // 检查闹钟
  await runAlarmTick(stateDir);
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

/**
 * 清理不存在的 tmux session 对应的 session 文件
 * 只在启动/退出时调用
 */
function cleanupDeadSessions(stateDir: string): void {
  const sessions = listEnabledSessions({ stateDir });
  let cleaned = 0;
  
  for (const session of sessions) {
    if (!isTmuxSessionAlive(session.sessionId)) {
      // tmux session 确实不存在，清理 session 文件
      deleteSession(session.sessionId, { stateDir });
      console.log(`[Drudge] Cleaned up dead session: ${session.sessionId}`);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[Drudge] Cleaned up ${cleaned} dead session(s)`);
  }
}

export async function startDaemon(config: HeartbeatConfig): Promise<void> {
  if (daemonState.started) {
    console.log('[Drudge] Daemon already running');
    return;
  }
  
  daemonState.started = true;
  daemonState.config = config;

  const tickMs = config.tickMs || 15 * 60 * 1000;
  const stateDir = config.stateDir || '~/.drudge';
  
  console.log(`[Drudge] Starting daemon with tick=${tickMs}ms`);
  
  // 启动时清理不存在的 tmux session
  cleanupDeadSessions(stateDir);
  
  // Write PID file
  writePidFile();
  
  // 设置定时器
  daemonState.timer = setInterval(async () => {
    if (!daemonState.started || !daemonState.config) {
      return;
    }
    await runTick(daemonState.config);
  }, tickMs);
  
  // Keep the timer referenced to prevent process exit
  // DO NOT use unref() - we want the daemon to keep running
  
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
  
  // 退出时清理不存在的 tmux session
  if (daemonState.config?.stateDir) {
    cleanupDeadSessions(daemonState.config.stateDir);
  }

  daemonState.started = false;
  daemonState.config = undefined;
  
  // Delete PID file
  deletePidFile();
  
  console.log('[Drudge] Daemon stopped');
}

/**
 * 检查 daemon 是否运行
 */
export function isDaemonRunning(): boolean {
  // Check PID file instead of just daemonState.started
  // This works across process boundaries
  const pid = readPidFile();
  if (pid === null) {
    return false;
  }
  return isProcessRunning(pid);
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
