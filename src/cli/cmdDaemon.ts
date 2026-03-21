/**
 * Daemon CLI Commands
 * 守护进程管理命令
 */

import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { isDaemonRunning } from '../core/daemon.js';
import { getHeartbeatInterval } from '../core/config.js';
import { listSessions } from '../core/state-store.js';
import { printJson, getDaemonEntryPath, startLaunchdService, stopLaunchdService, type CliOptions } from './cli-utils.js';

export async function cmdDaemon(args: string[], options: CliOptions): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'start':
      await cmdDaemonStart(options);
      break;
    case 'stop':
      await cmdDaemonStop(options);
      break;
    case 'status':
      await cmdDaemonStatus(options);
      break;
    default:
      printDaemonHelp();
  }
}

async function cmdDaemonStart(options: CliOptions): Promise<void> {
  if (isDaemonRunning()) {
    console.log('Daemon is already running');
    return;
  }

  const cwd = process.cwd();
  const heartbeatInterval = getHeartbeatInterval(cwd);

  if (process.platform === 'darwin') {
    // macOS: use launchd for persistence + autostart
    startLaunchdService();
    // small delay for service to come up
    await new Promise(resolve => setTimeout(resolve, 500));
  } else {
    // Fork daemon process (fallback for non-mac)
    const daemonEntryPath = getDaemonEntryPath();
    const daemonProcess = fork(daemonEntryPath, [], {
      cwd,
      detached: true,
      stdio: 'ignore'
    });
    // Unref to allow the parent process to exit independently
    daemonProcess.unref();
    // Wait a moment for the daemon to start
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (options.json) {
    printJson({ ok: true, tickMs: heartbeatInterval });
    return;
  }

  console.log(`Daemon started (interval: ${heartbeatInterval}ms)`);
}

async function cmdDaemonStop(_options: CliOptions): Promise<void> {
  if (process.platform === 'darwin') {
    stopLaunchdService();
  }

  const homeDir = process.env.HOME || '~';
  const pidFile = path.join(homeDir, '.drudge', 'daemon.pid');
  
  if (!fs.existsSync(pidFile)) {
    console.log('Daemon is not running (no PID file)');
    return;
  }
  
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  if (isNaN(pid)) {
    console.log('Invalid PID file');
    fs.unlinkSync(pidFile);
    return;
  }
  
  // Check if process is running
  try {
    process.kill(pid, 0);
  } catch {
    console.log('Daemon process not found, cleaning up PID file');
    fs.unlinkSync(pidFile);
    return;
  }
  
  // Kill the daemon process
  try {
    process.kill(pid, 'SIGTERM');
    console.log('Daemon stopped');
  } catch (error) {
    console.error('Failed to stop daemon:', error);
  }
}

async function cmdDaemonStatus(options: CliOptions): Promise<void> {
  const running = isDaemonRunning();
  const cwd = process.cwd();
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const stateDir = path.join(process.env.HOME || '~', '.drudge');
  const sessions = listSessions({ stateDir });

  if (options.json) {
    printJson({
      daemon: running,
      tickMs: heartbeatInterval,
      sessionCount: sessions.length,
      enabledCount: sessions.filter((s: any) => s.enabled).length
    });
    return;
  }

  console.log(`Daemon: ${running ? 'running' : 'stopped'}`);
  console.log(`Tick: ${heartbeatInterval}ms`);
  console.log(`Sessions: ${sessions.length} (${sessions.filter((s: any) => s.enabled).length} enabled)`);
}


export function printDaemonHelp(): void {
  console.log(`
Daemon commands:
  start     Start daemon
  stop      Stop daemon
  status    Show daemon status

Trigger command:
  trigger -s <session> -m <message> [--no-submit]

Options:
  --json    Output as JSON
`);
}

