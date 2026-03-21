/**
 * CLI Utility Functions
 * 共享工具函数
 */

import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Simple file logger (append to ~/.drudge/drudge.log)
 */
export function logToFile(message: string): void {
  const homeDir = process.env.HOME || os.homedir();
  const logDir = path.join(homeDir, '.drudge');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logPath = path.join(logDir, 'drudge.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, logLine, 'utf8');
  } catch { /* ignore logging errors */ }
}

/**
 * Shell quote helper
 */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Print JSON output
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print error message
 */
export function printError(message: string, code?: string): void {
  if (code) {
    console.error(`Error (${code}): ${message}`);
  } else {
    console.error(`Error: ${message}`);
  }
}

/**
 * Ensure tmux is available before running tmux-dependent commands
 */
export function ensureTmuxAvailable(command?: string): void {
  const result = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (command) {
      console.error(`Error: 'tmux' is required for '${command}' command but not found.`);
    } else {
      console.error("Error: 'tmux' is required but not found.");
    }
    console.error("Please install tmux first:");
    console.error("  macOS: brew install tmux");
    console.error("  Ubuntu/Debian: sudo apt-get install tmux");
    console.error("  CentOS/RHEL: sudo yum install tmux");
    process.exit(1);
  }
}

/**
 * Resolve current tmux target (session:window.pane format)
 */
export function resolveCurrentTmuxTarget(): string | null {
  const tmuxEnv = typeof process.env.TMUX === 'string' ? process.env.TMUX.trim() : '';
  if (!tmuxEnv) {
    return null;
  }
  try {
    const result = spawnSync('tmux', ['display-message', '-p', '#S:#I.#P'], { encoding: 'utf8' });
    if (result.status !== 0) {
      return null;
    }
    const target = String(result.stdout || '').trim();
    return target || null;
  } catch {
    return null;
  }
}

/**
 * Get daemon entry path
 */
export function getDaemonEntryPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '..', 'daemon-entry.js');
}

/**
 * Start launchd service (macOS)
 */
export function startLaunchdService(): void {
  const home = os.homedir();
  const plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.jsonstudio.drudge.plist');
  const nodePath = process.execPath;
  const daemonEntry = getDaemonEntryPath();
  const logDir = path.join(home, '.drudge');
  const stdoutPath = path.join(logDir, 'daemon.log');
  const stderrPath = path.join(logDir, 'daemon.err.log');

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jsonstudio.drudge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${daemonEntry}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>`;

  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, plist, 'utf8');

  const uid = process.getuid?.();
  try {
    if (uid !== undefined) {
      execSync(`launchctl bootstrap gui/${uid} ${plistPath}`, { stdio: 'ignore' });
    } else {
      execSync(`launchctl load -w ${plistPath}`, { stdio: 'ignore' });
    }
  } catch {
    try {
      execSync(`launchctl load -w ${plistPath}`, { stdio: 'ignore' });
    } catch {
      printError('Failed to start launchd service for drudge daemon');
    }
  }
}

/**
 * Stop launchd service (macOS)
 */
export function stopLaunchdService(): void {
  const home = os.homedir();
  const plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.jsonstudio.drudge.plist');
  if (!fs.existsSync(plistPath)) {
    return;
  }
  const uid = process.getuid?.();
  try {
    if (uid !== undefined) {
      execSync(`launchctl bootout gui/${uid} ${plistPath}`, { stdio: 'ignore' });
    } else {
      execSync(`launchctl unload -w ${plistPath}`, { stdio: 'ignore' });
    }
  } catch {
    try {
      execSync(`launchctl unload -w ${plistPath}`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
}

/**
 * CLI Options interface
 */
export interface CliOptions {
  session?: string;
  json?: boolean;
}
