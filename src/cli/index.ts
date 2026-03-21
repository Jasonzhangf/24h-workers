#!/usr/bin/env node
/**
 * Drudge CLI Entry
 */

import { spawn } from 'node:child_process';
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
  setSessionEnabled
} from '../core/state-store.js';
import { isTmuxAvailable, isTmuxSessionAlive, resolveTmuxActiveTarget } from '../tmux/session-probe.js';
import { attachToExistingTmuxSession } from '../tmux/attach.js';
import { cmdAlarm } from './cmdAlarm.js';
import { cmdTrigger } from './cmdTrigger.js';
import { cmdReview } from './cmdReview.js';
import { cmdHeartbeat, printHeartbeatHelp } from './cmdHeartbeat.js';
import { cmdDaemon, printDaemonHelp } from './cmdDaemon.js';
import { printJson, printError, ensureTmuxAvailable, logToFile, shellQuote, resolveCurrentTmuxTarget, type CliOptions } from './cli-utils.js';
import { createManagedTmuxSession, launchCommandInTmuxPane } from './tmux-helpers.js';

const VERSION = '0.1.6';

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
  logToFile(`cmdCodex args: ${JSON.stringify(args)}`);
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);

  generateDefaultConfig();

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
    // 如果传入了参数，优先在已有 session 中重新启动命令
    if (args.length > 0) {
      const target = resolveTmuxActiveTarget(projectName) || `${projectName}:0.0`;
      const relaunched = launchCommandInTmuxPane({
        tmuxTarget: target,
        cwd,
        command: 'codex',
        commandArgs: args,
        env: envOverrides
      });
      if (!relaunched) {
        printError('Failed to launch codex in existing tmux session');
      }
    }
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
  logToFile(`cmdClaude args: ${JSON.stringify(args)}`);
  const heartbeatInterval = getHeartbeatInterval(cwd);
  const promptFile = getPromptFile(cwd);

  generateDefaultConfig();

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
    if (args.length > 0) {
      const target = resolveTmuxActiveTarget(projectName) || `${projectName}:0.0`;
      const relaunched = launchCommandInTmuxPane({
        tmuxTarget: target,
        cwd,
        command: 'claude',
        commandArgs: args,
        env: envOverrides
      });
      if (!relaunched) {
        printError('Failed to launch claude in existing tmux session');
      }
    }
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

function printHelp(): void {
  console.log(`
Drudge CLI v${VERSION}

Usage:
  drudge init                  Initialize Drudge (add current project)
  drudge codex [args...]       Launch Codex with heartbeat
  drudge claude [args...]      Launch Claude with heartbeat
  drudge heartbeat <command>   Manage heartbeat
  drudge alarm <command>       Manage alarms
  drudge trigger             Inject text into tmux session
  drudge review              Run review flow and inject result
  drudge review              Run review flow and inject result
  drudge daemon <command>      Manage daemon

Heartbeat commands:
  list                  List all sessions
  on -s <session>       Enable session
  off -s <session>      Disable session
  trigger -s <session>  Trigger heartbeat
  status -s <session>   Show session status

Alarm commands:
  check                Check if alarm is ready for current project
  add <cron>           Add an alarm (use --id, -p, --once, -m)
  adopt                Adopt an existing tmux session for alarms
  list                 List all alarms
  remove <id>          Remove an alarm
  trigger <id>         Manually trigger an alarm

Daemon commands:
  start     Start daemon
  stop      Stop daemon
  status    Show daemon status

Trigger command:
  trigger -s <session> -m <message> [--no-submit]

Review command:
  review [--goal <text>] [--focus <text>] [--context <text>] [-C <dir>] [-p <profile>] [--tool <name>]
  review [--goal <text>] [--focus <text>] [--context <text>]

Options:
  -s, --session <id>    Session ID
  -p, --project <name>  Project name (for alarm)
  -C, --cwd <dir>       Working directory (for review)
  --profile <name>      Codex profile (for review)
  --tool <name>         Review tool (codex/claude/custom)
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

  // Allow help/version without requiring tmux
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`drudge v${VERSION}`);
    process.exit(0);
  }

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
    ensureTmuxAvailable('codex');
    await cmdCodex(args.slice(1));
    return;
  }

  if (command === 'claude') {
    ensureTmuxAvailable('claude');
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

    if (arg === '-C' || arg === '--cwd') {
      options.cwd = args[++i];
      continue;
    }

    if (arg === '--tool') {
      options.tool = args[++i];
      continue;
    }
  }

  const subArgs = args.slice(1).filter((a, i, arr) => {
    if (a === '-s' || a === '--session') return false;
    if (i > 0 && (arr[i - 1] === '-s' || arr[i - 1] === '--session')) return false;
    if (a === '-C' || a === '--cwd') return false;
    if (i > 0 && (arr[i - 1] === '-C' || arr[i - 1] === '--cwd')) return false;
    if (a === '--tool') return false;
    if (i > 0 && (arr[i - 1] === '--tool')) return false;
    if (a === '--json') return false;
    return true;
  });

  try {
    // tmux required for these commands
  if (['heartbeat', 'alarm', 'trigger', 'review', 'daemon'].includes(command)) {
    ensureTmuxAvailable(command);
  }
    switch (command) {
      case 'heartbeat':
        await cmdHeartbeat(subArgs, options);
        break;
      case 'daemon':
        await cmdDaemon(subArgs, options);
        break;
      case 'alarm':
        await cmdAlarm(subArgs, options);
        break;
      case 'trigger':
        await cmdTrigger(subArgs, options);
        break;
      case 'review':
        await cmdReview(subArgs, options);
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
