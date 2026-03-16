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
  isDaemonRunning,
  triggerOnce
} from '../core/daemon.js';
import {
  loadSession,
  listSessions,
  setSessionEnabled
} from '../core/state-store.js';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { injectTmuxText } from '../tmux/injector.js';
import { buildTimeTagLine } from '../clock/time-tag.js';

const VERSION = '0.2.0';

interface CliOptions {
  session?: string;
  json?: boolean;
  cwd?: string;
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
 * 获取当前 tmux session
 */
function getCurrentTmuxSession(): string | null {
  try {
    const result = spawnSync('tmux', ['display-message', '-p', '#S'], {
      encoding: 'utf8',
      timeout: 1000
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  } catch {
    // not in tmux
  }
  return null;
}

/**
 * 创建 tmux session 并在其中启动命令
 */
function runInTmuxSession(sessionName: string, cwd: string, command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const fullArgs = ['new-session', '-d', '-s', sessionName, '-c', cwd, command, ...args];
    
    console.log(`Starting in tmux session: ${sessionName}`);
    
    const proc = spawn('tmux', fullArgs, {
      stdio: 'inherit'
    });
    
    proc.on('exit', (code) => {
      console.log(`Tmux session exited: ${sessionName}`);
      resolve(code || 0);
    });
    
    proc.on('error', (err) => {
      console.error(`Failed to start tmux session: ${err.message}`);
      reject(err);
    });
  });
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

  console.log('Initializing Drudge...');

  // 创建配置目录
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`Created: ${configDir}`);
  }

  // 创建 sessions 目录
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
    console.log(`Created: ${sessionsDir}`);
  }

  // 创建默认提示词文件
  if (!fs.existsSync(promptFile)) {
    const defaultPrompt = `[Heartbeat]
请读取当前目录的 HEARTBEAT.md 进行任务巡检。
先检查上一次交付是否完整、是否还需要继续修复。
完成后更新 DELIVERY.md，然后调用 review。
不要只做汇报；如果仍有未完成项，请直接继续执行。`;
    fs.writeFileSync(promptFile, defaultPrompt);
    console.log(`Created: ${promptFile}`);
  } else {
    console.log(`Exists: ${promptFile}`);
  }

  // 处理配置文件
  let config: any;
  let projectAdded = false;

  if (fs.existsSync(configFile)) {
    // 读取现有配置
    const content = fs.readFileSync(configFile, 'utf8');
    config = JSON.parse(content);
    console.log(`Exists: ${configFile}`);

    // 检查当前项目是否已在配置中
    const existingProject = config.projects?.find((p: any) => p.path === cwd);
    if (existingProject) {
      console.log(`Project already configured: ${cwd}`);
    } else {
      // 添加当前项目
      if (!config.projects) {
        config.projects = [];
      }
      config.projects.push({
        path: cwd,
        heartbeatIntervalMs: 900000,
        promptFile: '~/.drudge/HEARTBEAT.md'
      });
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      console.log(`Added project: ${cwd}`);
      projectAdded = true;
    }
  } else {
    // 创建新配置文件，包含当前项目
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
    console.log(`Created: ${configFile}`);
    console.log(`Added project: ${cwd}`);
    projectAdded = true;
  }

  if (options.json) {
    printJson({
      ok: true,
      configDir,
      configFile,
      promptFile,
      sessionsDir,
      projectPath: cwd,
      projectName,
      projectAdded
    });
    return;
  }

  console.log('\nDrudge initialized successfully!');
  console.log(`\nProject: ${projectName}`);
  console.log(`Path: ${cwd}`);
  console.log('\nNext steps:');
  console.log('  1. Edit ~/.drudge/config.json to customize heartbeat interval');
  console.log('  2. Run "drudge codex" or "drudge claude" to start');
}

/**
 * 启动 codex
 */
async function cmdCodex(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sessionName = getProjectName(cwd);
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);

  // 确保配置存在
  generateDefaultConfig();

  // 启动 heartbeat daemon
  if (!isDaemonRunning()) {
    console.log(`Starting heartbeat daemon (interval: ${heartbeatInterval}ms)`);
    const config = {
      tickMs: heartbeatInterval,
      promptFile,
      stateDir: path.join(process.env.HOME || '~', '.drudge'),
      proxy: { enabled: false }
    };
    await startDaemon(config as any);
  }

  // 启用 session
  setSessionEnabled(sessionName, true, {
    stateDir: path.join(process.env.HOME || '~', '.drudge')
  });

  console.log(`Heartbeat enabled for session: ${sessionName}`);

  // 检查当前是否在 tmux 中
  const currentTmuxSession = getCurrentTmuxSession();
  
  if (currentTmuxSession) {
    // 在当前 tmux 中直接启动
    console.log(`Starting in current tmux session: ${currentTmuxSession}`);
    spawnSync('codex', args, { stdio: 'inherit' });
  } else {
    // 在新的 tmux session 中启动
    try {
      const exitCode = await runInTmuxSession(sessionName, cwd, 'codex', args);
      process.exit(exitCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      printError(`Failed to start codex in tmux: ${message}`);
    }
  }
}

/**
 * 启动 claude
 */
async function cmdClaude(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const sessionName = getProjectName(cwd);
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);

  // 确保配置存在
  generateDefaultConfig();

  // 启动 heartbeat daemon
  if (!isDaemonRunning()) {
    console.log(`Starting heartbeat daemon (interval: ${heartbeatInterval}ms)`);
    const config = {
      tickMs: heartbeatInterval,
      promptFile,
      stateDir: path.join(process.env.HOME || '~', '.drudge'),
      proxy: { enabled: false }
    };
    await startDaemon(config as any);
  }

  // 启用 session
  setSessionEnabled(sessionName, true, {
    stateDir: path.join(process.env.HOME || '~', '.drudge')
  });

  console.log(`Heartbeat enabled for session: ${sessionName}`);

  // 检查当前是否在 tmux 中
  const currentTmuxSession = getCurrentTmuxSession();
  
  if (currentTmuxSession) {
    // 在当前 tmux 中直接启动
    console.log(`Starting in current tmux session: ${currentTmuxSession}`);
    spawnSync('claude', args, { stdio: 'inherit' });
  } else {
    // 在新的 tmux session 中启动
    try {
      const exitCode = await runInTmuxSession(sessionName, cwd, 'claude', args);
      process.exit(exitCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      printError(`Failed to start claude in tmux: ${message}`);
    }
  }
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

  // 读取提示词
  let prompt = '';
  if (fs.existsSync(promptFile)) {
    prompt = fs.readFileSync(promptFile, 'utf8');
  }

  if (!prompt.trim()) {
    printError('Prompt file not found or empty');
    return;
  }

  // 构建注入文本
  const timeTag = buildTimeTagLine();
  const injectText = `${timeTag}\n\n${prompt}`;

  // 注入到 tmux
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
      enabledCount: sessions.filter(s => s.enabled).length
    });
    return;
  }

  console.log(`Daemon: ${running ? 'running' : 'stopped'}`);
  console.log(`Tick: ${heartbeatInterval}ms`);
  console.log(`Sessions: ${sessions.length} (${sessions.filter(s => s.enabled).length} enabled)`);
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

  // init 命令
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

  // codex 和 claude 直接透传所有参数
  if (command === 'codex') {
    await cmdCodex(args.slice(1));
    return;
  }

  if (command === 'claude') {
    await cmdClaude(args.slice(1));
    return;
  }

  // 其他命令解析选项
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

  // 获取子命令参数
  const subArgs = args.slice(1).filter((a, i, arr) => {
    // 过滤掉选项和选项值
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
