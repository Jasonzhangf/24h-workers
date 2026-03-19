/**
 * Daemon Entry Point
 *
 * This file is the entry point for the daemon process.
 * It is spawned as a separate process using child_process.fork().
 * The daemon process runs indefinitely until it is stopped.
 */

import { startDaemon, getDaemonState } from './core/daemon.js';
import {
  getHeartbeatInterval,
  getPromptFile,
  getDefaultStateDir
} from './core/config.js';
import path from 'node:path';

async function main(): Promise<void> {
  const cwd = process.cwd();
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);
  const stateDir = getDefaultStateDir();

  const config = {
    tickMs: heartbeatInterval,
    promptFile,
    stateDir,
    proxy: { enabled: false }
  };

  await startDaemon(config as any);

  // Keep the daemon process running indefinitely
  // The process will only exit when it receives a signal
  process.on('SIGTERM', () => {
    const daemonState = getDaemonState();
    if (daemonState.timer) {
      clearInterval(daemonState.timer);
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[Drudge] Daemon entry error:', error);
  process.exit(1);
});
