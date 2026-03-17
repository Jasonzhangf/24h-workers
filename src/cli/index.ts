#!/usr/bin/env node
/**
 * Drudge CLI Entry
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  getHeartbeatInterval,
  getPromptFile,
  getProjectName,
  generateDefaultConfig
} from '../core/config.js';
import {
  startDaemon,
  stopDaemon,
  isDaemonRunning
} from '../core/daemon.js';
import {
  setSessionEnabled,
  listSessions,
  loadSession
} from '../core/state-store.js';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { attachToExistingTmuxSession } from '../tmux/attach.js';
import { injectTmuxText } from '../tmux/injector.js';
import { buildTimeTagLine } from '../clock/time-tag.js';

const VERSION = '0.1.2';

// Simple file logger (append to ~/.drudge/drudge.log)
function logToFile(message: string): void {
  const logDir = path.join(os.homedir(), '.drudge');
  const logPath = path.join(logDir, 'drudge.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logPath, logLine, 'utf8');
  } catch { /* ignore logging errors */ }
}

interface CliOptions {
  session?: string;
  json?: boolean;
}

/**
 * 创建受管理的 tmux session
 */
function createManagedTmuxSession(args: {
  cwd: string;
  sessionName?: string;
}): { sessionName: string; tmuxTarget: string; stop: () => void } | null {
  const { cwd, sessionName: preferredName } = args;
  logToFile(`createManagedTmuxSession called: preferredName=${preferredName}, cwd=${cwd}`);
  const baseName = preferredName || path.basename(cwd);

 // 生成唯一 session 名称
  let sessionName = baseName;
  let attempt = 0;
  while (attempt < 6) {
    if (!isTmuxSessionAlive(sessionName)) {
      // session 不存在，可以使用
      break;
    }
    attempt++;
    sessionName = `${baseName}-${Date.now()}-${attempt}`;
  }

  if (attempt >= 6) {
    logToFile(`Could not find available session name after 6 attempts`);
    return null;
  logToFile(`createManagedTmuxSession: attempting to create session: ${sessionName}`);
  }

 try {
   const result = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', cwd], { encoding: 'utf8' });
   if (result.status !== 0) {
      logToFile(`Failed to create tmux session: ${result.stderr || result.stdout || 'Unknown error'}`);
      return null;
    }
  } catch {
    logToFile(`Failed to create tmux session: exception thrown`);
    return null;
  }

  // 配置终端渲染
  logToFile(`createManagedTmuxSession: session created successfully: ${sessionName}`);
  const tmuxTarget = `${sessionName}:0.0`;
  try {
    spawnSync('tmux', ['set-option', '-t', sessionName, '-g', 'default-terminal', 'tmux-256color'], { encoding: 'utf8' });
} catch { /* ignore */ }

  try {
    spawnSync('tmux', ['set-option', '-t', sessionName, '-ga', 'terminal-features', ',*:RGB'], { encoding: 'utf8' });
  } catch { /* ignore */ }
  // 禁用斜体，避免某些终端渲染问题
  try {
    spawnSync('tmux', ['set-option', '-t', sessionName, '-ga', 'terminal-overrides', ',*:sitm@:ritm@'], { encoding: 'utf8' });
  } catch { /* ignore */ }

  return {
    sessionName,
    tmuxTarget,
    stop: () => {
      try {
        spawnSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8' });
      } catch { /* ignore */ }
    }
  };
}

/**
 * 检测当前 tmux target
 */
function resolveCurrentTmuxTarget(): string | null {
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
 * Shell 引用
 */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * 在 tmux pane 中启动命令（使用 respawn-pane）
 */
function launchCommandInTmuxPane(args: {
  tmuxTarget: string;
  cwd: string;
  command: string;
  commandArgs: string[];
  env?: Record<string, string>;
}): boolean {
 const { tmuxTarget, cwd, command, commandArgs, env } = args;



  // 构建环境变量令牌（参考 routecodex）
  const envTokens = [
    ...(env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [])
  ];

  // 构建基础命令（参考 routecodex）
  const baseCommand = ['env', ...envTokens, command, ...commandArgs]
    .map((token) => shellQuote(token))
    .join(' ');

  // 构建完整命令（参考 routecodex）
  const commandBody = `cd -- ${shellQuote(cwd)} || exit 1; ${baseCommand}`;
  const shellCommand = `${commandBody}; __exit=$?; exit "$__exit"`;

 // 使用 respawn-pane 启动命令
 try {
    const respawn = spawnSync('tmux', ['respawn-pane', '-k', '-t', tmuxTarget, shellCommand], { encoding: 'utf8' });
    if (respawn.status === 0) {
      return true;
    }
    logToFile(`respawn-pane failed: ${respawn.stderr || respawn.stdout || 'Unknown error'}`);
  } catch { /* fallback */ }

  // 回退到 send-keys
  try {
    spawnSync('tmux', ['send-keys', '-t', tmuxTarget, '-X', 'cancel'], { encoding: 'utf8' });
    spawnSync('tmux', ['send-keys', '-t', tmuxTarget, 'C-u'], { encoding: 'utf8' });
    const literal = spawnSync('tmux', ['send-keys', '-t', tmuxTarget, '-l', '--', shellCommand], { encoding: 'utf8' });
    if (literal.status !== 0) {
      logToFile(`send-keys failed: ${literal.stderr || literal.stdout || 'Unknown error'}`);
      return false;
    }
    spawnSync('tmux', ['send-keys', '-t', tmuxTarget, 'Enter'], { encoding: 'utf8' });
    return true;
  } catch {
    logToFile(`send-keys exception thrown`);
    return false;
  }
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printError(message: string, code?: string): void {
  console.error(`Error: ${message}`);
  if (code) {
    console.error(`Code: ${code}`);
  }
  process.exit(1);
}

/**
 * 初始化配置
 */
function cmdInit(options: CliOptions): void {
  const configDir = path.join(os.homedir(), '.drudge');
  const configFile = path.join(configDir, 'config.json');
  const promptFile = path.join(configDir, 'HEARTBEAT.md');
  const sessionsDir = path.join(configDir, 'sessions');

  const cwd = process.cwd();
  const projectName = path.basename(cwd);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  if (!fs.existsSync(promptFile)) {
    const defaultPrompt = `[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。`;
    fs.writeFileSync(promptFile, defaultPrompt);
  }

  let config: any;

  if (fs.existsSync(configFile)) {
    const content = fs.readFileSync(configFile, 'utf8');
    config = JSON.parse(content);

    const existingProject = config.projects?.find((p: any) => p.path === cwd);
    if (!existingProject) {
      if (!config.projects) {
        config.projects = [];
      }
      config.projects.push({
        path: cwd,
        heartbeatIntervalMs: 900000,
        promptFile: '~/.drudge/HEARTBEAT.md'
      });
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    }
  } else {
    config = {
      version: '1.0.0',
      projects: [
        {
          path: cwd,
          heartbeatIntervalMs: 900000,
          promptFile: '~/.drudge/HEARTBEAT.md'
        }
      ],
      default: {
        heartbeatIntervalMs: 900000,
        promptFile: '~/.drudge/HEARTBEAT.md'
      }
    };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  }

  if (options.json) {
    printJson({
      ok: true,
      configDir,
      configFile,
      promptFile,
      sessionsDir,
      projectPath: cwd,
      projectName
    });
    return;
  }

  console.log(`Drudge initialized for: ${projectName}`);
}


/**
 * 启动 codex
 */
async function cmdCodex(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const projectName = getProjectName(cwd);
  logToFile(`cmdCodex called: projectName=${projectName}, cwd=${cwd}`);
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);

  generateDefaultConfig();

  if (!isDaemonRunning()) {
    const config = {
      tickMs: heartbeatInterval,
      promptFile,
      stateDir: path.join(process.env.HOME || '~', '.drudge'),
      proxy: { enabled: false }
    };
    await startDaemon(config as any);
  }

  setSessionEnabled(projectName, true, {
    stateDir: path.join(process.env.HOME || '~', '.drudge')
  });

  // 设置环境变量（确保颜色正常）
  const envOverrides: Record<string, string> = {
    TERM: 'tmux-256color',
    COLORTERM: 'truecolor',
  };

  // 检测当前是否在 tmux 中
  const currentTmuxTarget = resolveCurrentTmuxTarget();
  logToFile(`cmdCodex: currentTmuxTarget=${currentTmuxTarget}`);

  if (currentTmuxTarget) {
    // 已在 tmux 中，直接在��前 pane 启动命令
    const launched = launchCommandInTmuxPane({
      tmuxTarget: currentTmuxTarget,
      cwd,
      command: 'codex',
      commandArgs: args,
      env: envOverrides
    });
    if (!launched) {
      printError('Failed to launch codex in current tmux pane');
    }
    return;
  }

  // 不在 tmux 中，创建受管理的 tmux session
  // 首先检查是否已经存在同名的 session
  const sessionAlreadyExists = isTmuxSessionAlive(projectName);
  logToFile(`cmdCodex: sessionAlreadyExists=${sessionAlreadyExists}, projectName=${projectName}`);

 if (sessionAlreadyExists) {
    attachToExistingTmuxSession({
      sessionName: projectName,
      envOverrides,
      cwd
    });
    return;
  }

  const managedSession = createManagedTmuxSession({ cwd, sessionName: projectName });
  if (!managedSession) {
    printError('Failed to create managed tmux session. Session might already exist or tmux is not available.');
    return;
  }

  // 在 tmux pane 中启动命令
  const launched = launchCommandInTmuxPane({
    tmuxTarget: managedSession.tmuxTarget,
    cwd,
    command: 'codex',
    commandArgs: args,
    env: envOverrides
  });

  if (!launched) {
    managedSession.stop();
    printError('Failed to launch codex in tmux session');
    return;
  }

  // Attach 到 tmux session
  const tmux = spawn('tmux', ['attach-session', '-t', managedSession.sessionName], {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
    cwd
  });

  tmux.on('exit', (code) => {
    process.exit(code || 0);
  });
}

/**
 * 启动 claude
 */
async function cmdClaude(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const projectName = getProjectName(cwd);
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);

  generateDefaultConfig();

  if (!isDaemonRunning()) {
    const config = {
      tickMs: heartbeatInterval,
      promptFile,
      stateDir: path.join(process.env.HOME || '~', '.drudge'),
      proxy: { enabled: false }
    };
    await startDaemon(config as any);
  }

  setSessionEnabled(projectName, true, {
    stateDir: path.join(process.env.HOME || '~', '.drudge')
  });

  // 设置环境变量（确保颜色正常）
  const envOverrides: Record<string, string> = {
    TERM: 'tmux-256color',
    COLORTERM: 'truecolor',
  };

  // 检测当前是否在 tmux 中
  const currentTmuxTarget = resolveCurrentTmuxTarget();

  if (currentTmuxTarget) {
    // 已在 tmux 中，直接在当前 pane 启动命令
    const launched = launchCommandInTmuxPane({
      tmuxTarget: currentTmuxTarget,
      cwd,
      command: 'claude',
      commandArgs: args,
      env: envOverrides
    });
    if (!launched) {
      printError('Failed to launch claude in current tmux pane');
    }
    return;
  }

 // 不在 tmux 中，创建受管理的 tmux session
  const sessionAlreadyExists = isTmuxSessionAlive(projectName);

  if (sessionAlreadyExists) {
    attachToExistingTmuxSession({
      sessionName: projectName,
      envOverrides,
      cwd
    });
    return;
  }

  const managedSession = createManagedTmuxSession({ cwd, sessionName: projectName });
  if (!managedSession) {
    printError('Failed to create managed tmux session. Session might already exist or tmux is not available.');
    return;
  }

  // 在 tmux pane 中启动命令
  const launched = launchCommandInTmuxPane({
    tmuxTarget: managedSession.tmuxTarget,
    cwd,
    command: 'claude',
    commandArgs: args,
    env: envOverrides
  });

  if (!launched) {
    managedSession.stop();
    printError('Failed to launch claude in tmux session');
    return;
  }

  // Attach 到 tmux session
  const tmux = spawn('tmux', ['attach-session', '-t', managedSession.sessionName], {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
    cwd
  });

  tmux.on('exit', (code) => {
    process.exit(code || 0);
  });
}

/**
 * heartbeat 子命令
 */
async function cmdHeartbeat(args: string[], options: CliOptions): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      await cmdHeartbeatList(options);
      break;
    case 'on':
      await cmdHeartbeatOn(options);
      break;
    case 'off':
      await cmdHeartbeatOff(options);
      break;
    case 'trigger':
      await cmdHeartbeatTrigger(options);
      break;
    case 'status':
      await cmdHeartbeatStatus(options);
      break;
    default:
      printHeartbeatHelp();
  }
}

async function cmdHeartbeatList(options: CliOptions): Promise<void> {
  const stateDir = path.join(process.env.HOME || '~', '.drudge');
  const sessions = listSessions({ stateDir });

  if (options.json) {
    printJson(sessions);
    return;
  }

  if (sessions.length === 0) {
    console.log('No sessions found');
    return;
  }

  for (const session of sessions) {
    const status = session.enabled ? 'enabled' : 'disabled';
    const alive = isTmuxSessionAlive(session.sessionId) ? 'alive' : 'dead';
    const triggers = session.triggerCount;
    console.log(`  ${session.sessionId}: ${status} (${alive}) triggers=${triggers}`);
  }
}

async function cmdHeartbeatOn(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }

  const stateDir = path.join(process.env.HOME || '~', '.drudge');
  const result = setSessionEnabled(sessionId, true, { stateDir });

  if (options.json) {
    printJson({ ok: true, session: result });
    return;
  }

  console.log(`Session ${sessionId} enabled`);
}

async function cmdHeartbeatOff(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }

  const stateDir = path.join(process.env.HOME || '~', '.drudge');
  const result = setSessionEnabled(sessionId, false, { stateDir });

  if (options.json) {
    printJson({ ok: true, session: result });
    return;
  }

  console.log(`Session ${sessionId} disabled`);
}

async function cmdHeartbeatTrigger(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }

  const cwd = process.cwd();
  const promptFile = getPromptFile(cwd);
  const stateDir = path.join(process.env.HOME || '~', '.drudge');

  let prompt = '';
  if (fs.existsSync(promptFile)) {
    prompt = fs.readFileSync(promptFile, 'utf8');
  }

  if (!prompt.trim()) {
    printError('Prompt file not found or empty');
    return;
  }

  const timeTag = buildTimeTagLine();
  const injectText = `${timeTag}\n\n${prompt}`;

  const result = await injectTmuxText({
    sessionId,
    text: injectText,
    submit: true
  });

  if (options.json) {
    printJson({ ok: result.ok, reason: result.reason });
    return;
  }

  if (result.ok) {
    console.log(`Heartbeat triggered for session: ${sessionId}`);
  } else {
    printError(result.reason || 'Trigger failed');
  }
}

async function cmdHeartbeatStatus(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }

  const stateDir = path.join(process.env.HOME || '~', '.drudge');
  const session = loadSession(sessionId, { stateDir });

  if (!session) {
    printError('Session not found', 'not_found');
    return;
  }

  const alive = isTmuxSessionAlive(sessionId);

  if (options.json) {
    printJson({ ...session, alive });
    return;
  }

  console.log(`Session: ${session.sessionId}`);
  console.log(`Status: ${session.enabled ? 'enabled' : 'disabled'}`);
  console.log(`Tmux: ${alive ? 'alive' : 'dead'}`);
  console.log(`Triggers: ${session.triggerCount}`);
  if (session.lastTriggeredAtMs) {
    console.log(`Last trigger: ${new Date(session.lastTriggeredAtMs).toISOString()}`);
  }
  if (session.lastError) {
    console.log(`Last error: ${session.lastError}`);
  }
}

/**
 * daemon 子命令
 */
async function cmdDaemon(args: string[], options: CliOptions): Promise<void> {
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
  const promptFile = getPromptFile(cwd);
  const stateDir = path.join(process.env.HOME || '~', '.drudge');

  const config = {
    tickMs: heartbeatInterval,
    promptFile,
    stateDir,
    proxy: { enabled: false }
  };

  await startDaemon(config as any);

  if (options.json) {
    printJson({ ok: true, tickMs: heartbeatInterval });
    return;
  }

  console.log(`Daemon started (interval: ${heartbeatInterval}ms)`);
}

async function cmdDaemonStop(_options: CliOptions): Promise<void> {
  if (!isDaemonRunning()) {
    console.log('Daemon is not running');
    return;
  }

  stopDaemon();
  console.log('Daemon stopped');
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

function printHeartbeatHelp(): void {
  console.log(`
Heartbeat commands:
  list                List all sessions
  on -s <session>     Enable session
  off -s <session>    Disable session
  trigger -s <session>  Trigger heartbeat
  status -s <session>   Show session status

Options:
  -s, --session <id>    Session ID
  --json                Output as JSON
`);
}

function printDaemonHelp(): void {
  console.log(`
Daemon commands:
  start     Start daemon
  stop      Stop daemon
  status    Show daemon status

Options:
  --json    Output as JSON
`);
}

function printHelp(): void {
  console.log(`
Drudge CLI v${VERSION}

Usage:
  drudge init                  Initialize Drudge (add current project)
  drudge codex [args...]       Launch Codex with heartbeat
  drudge claude [args...]      Launch Claude with heartbeat
  drudge heartbeat <command>   Manage heartbeat
  drudge daemon <command>      Manage daemon

Heartbeat commands:
  list                  List all sessions
  on -s <session>       Enable session
  off -s <session>      Disable session
  trigger -s <session>  Trigger heartbeat
  status -s <session>   Show session status

Daemon commands:
  start     Start daemon
  stop      Stop daemon
  status    Show daemon status

Options:
  -s, --session <id>    Session ID
  --json                Output as JSON
  -h, --help            Show this help
  -v, --version         Show version

Config: ~/.drudge/config.json
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];

  if (command === 'init') {
    const options: CliOptions = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--json') {
        options.json = true;
      }
    }
    cmdInit(options);
    return;
  }

  if (command === 'codex') {
    await cmdCodex(args.slice(1));
    return;
  }

  if (command === 'claude') {
    await cmdClaude(args.slice(1));
    return;
  }

  const options: CliOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    if (arg === '-v' || arg === '--version') {
      console.log(`drudge v${VERSION}`);
      process.exit(0);
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '-s' || arg === '--session') {
      options.session = args[++i];
      continue;
    }
  }

  const subArgs = args.slice(1).filter((a, i, arr) => {
    if (a === '-s' || a === '--session') return false;
    if (i > 0 && (arr[i - 1] === '-s' || arr[i - 1] === '--session')) return false;
    if (a === '--json') return false;
    return true;
  });

  try {
    switch (command) {
      case 'heartbeat':
        await cmdHeartbeat(subArgs, options);
        break;
      case 'daemon':
        await cmdDaemon(subArgs, options);
        break;
      default:
        printHelp();
        process.exit(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(message);
  }
}

main();
