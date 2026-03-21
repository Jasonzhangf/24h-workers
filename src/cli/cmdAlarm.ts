/**
 * Alarm CLI Commands
 * 闹钟管理命令
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isTmuxSessionAlive, resolveTmuxWorkingDirectory } from '../tmux/session-probe.js';
import { listAlarms, getAlarm, addAlarm, removeAlarm, updateAlarm } from '../alarm/store.js';
import { validateCron, getNextTriggerTime } from '../alarm/cron-parser.js';
import type { Alarm, AlarmCheckResult } from '../alarm/types.js';
import { setSessionEnabled } from '../core/state-store.js';
import { getDefaultStateDir } from '../core/config.js';

interface AlarmOptions {
  id?: string;
  project?: string;
  session?: string;
  force?: boolean;
  once?: boolean;
  message?: string;
  json?: boolean;
  _positional?: string[];
}

/**
 * 读取配置文件
 */
function readConfigFile(): { projects: { path: string }[] } | null {
  try {
    const configPath = path.join(os.homedir(), '.drudge', 'config.json');
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 获取项目路径
 */
function getProjectPath(projectName: string): string | null {
  const config = readConfigFile();
  if (!config) {
    return null;
  }

  const project = config.projects.find(p => path.basename(p.path) === projectName);
  return project?.path || null;
}

/**
 * 检查闹钟是否可用
 */
export function checkAlarm(projectName: string): AlarmCheckResult {
  const result: AlarmCheckResult = {
    alive: false,
    registered: false,
    ready: false,
  };

  // 检查 session 文件是否存在（确保由 drudge 启动）
  const sessionFile = path.join(os.homedir(), '.drudge', 'sessions', `${projectName}.json`);
  const sessionFileExists = fs.existsSync(sessionFile);
  result.sessionFileExists = sessionFileExists;

  // 检查是否注册
  const projectPath = getProjectPath(projectName);
  if (projectPath) {
    result.registered = true;
    result.projectPath = projectPath;

    // 检查 tmux session 是否存活
    result.alive = isTmuxSessionAlive(projectName);

    // 检查 CLOCK.md 是否存在
    const clockPath = path.join(projectPath, '.drudge', 'CLOCK.md');
    result.clockFileExists = fs.existsSync(clockPath);
  }

  result.ready = result.alive && result.registered && sessionFileExists;
  return result;
}

/**
 * cmdAlarmCheck - 检查闹钟是否可用
 */
export async function cmdAlarmCheck(options: AlarmOptions): Promise<void> {
  const projectName = options.project || path.basename(process.cwd());
  const result = checkAlarm(projectName);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Project: ${projectName}`);
  console.log(`Session alive: ${result.alive ? 'yes' : 'no'}`);
  console.log(`Registered: ${result.registered ? 'yes' : 'no'}`);
  console.log(`Session file: ${result.sessionFileExists ? 'exists' : 'not found'}`);
  if (result.projectPath) {
    console.log(`Path: ${result.projectPath}`);
  }
  if (result.clockFileExists !== undefined) {
    console.log(`CLOCK.md: ${result.clockFileExists ? 'exists' : 'not found'}`);
  }
  console.log(`Ready for alarm: ${result.ready ? 'yes' : 'no'}`);

  if (!result.ready) {
    if (!result.registered) {
      console.log('\nHint: Register this project with `drudge init` or add to ~/.drudge/config.json');
    } else if (!result.sessionFileExists) {
      console.log('\nHint: Session file not found. You can run `drudge alarm adopt -p <project> -s <session>` to adopt an existing tmux session,');
      console.log('or start via `drudge codex` / `drudge claude` to register.');
    } else if (!result.alive) {
      console.log('\nHint: Start the session with `drudge codex` or `drudge claude`');
    }
  }
}

/**
 * cmdAlarmAdd - 添加闹钟
 */
export async function cmdAlarmAdd(cron: string, options: AlarmOptions): Promise<void> {
  // 验证 cron
  const validation = validateCron(cron);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(1);
  }

  const id = options.id;
  if (!id) {
    console.error('Error: --id is required');
    process.exit(1);
  }

  const projectName = options.project || path.basename(process.cwd());

  // 检查是否可用
  const check = checkAlarm(projectName);
  if (!check.registered) {
    console.error(`Error: Project "${projectName}" is not registered in ~/.drudge/config.json`);
    process.exit(1);
  }
  if (!check.alive) {
    console.error(`Error: Session "${projectName}" is not alive. Start it with \`drudge codex\` or \`drudge claude\``);
    process.exit(1);
  }

  // 创建闹钟
  const alarm: Alarm = {
    id,
    cron,
    once: options.once || false,
    project: projectName,
    message: options.message,
    createdAtMs: Date.now(),
    triggerCount: 0,
    enabled: true,
  };

  addAlarm(alarm);

  if (options.json) {
    console.log(JSON.stringify(alarm, null, 2));
    return;
  }

  console.log(`Alarm "${id}" added`);
  console.log(`  Cron: ${cron}`);
  console.log(`  Project: ${projectName}`);
  if (options.once) {
    console.log(`  Mode: one-shot (will be removed after trigger)`);
  }
  const nextTrigger = getNextTriggerTime(cron);
  if (nextTrigger) {
    console.log(`  Next trigger: ${nextTrigger.toISOString()}`);
  }
}

/**
 * cmdAlarmList - 列出闹钟
 */
export async function cmdAlarmList(options: AlarmOptions): Promise<void> {
  const alarms = listAlarms();
  const filtered = options.project
    ? alarms.filter(a => a.project === options.project)
    : alarms;

  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log('No alarms found');
    return;
  }

  console.log('Alarms:');
  for (const alarm of filtered) {
    const status = alarm.enabled ? 'enabled' : 'disabled';
    const once = alarm.once ? ' (once)' : '';
    console.log(`  ${alarm.id}: ${alarm.cron} -> ${alarm.project} [${status}${once}]`);
    if (alarm.message) {
      console.log(`    Message: ${alarm.message}`);
    }
    const nextTrigger = getNextTriggerTime(alarm.cron);
    if (nextTrigger) {
      console.log(`    Next: ${nextTrigger.toISOString()}`);
    }
  }
}

/**
 * cmdAlarmRemove - 移除闹钟
 */
export async function cmdAlarmRemove(id: string, options: AlarmOptions): Promise<void> {
  const removed = removeAlarm(id);

  if (options.json) {
    console.log(JSON.stringify({ id, removed }, null, 2));
    return;
  }

  if (removed) {
    console.log(`Alarm "${id}" removed`);
  } else {
    console.log(`Alarm "${id}" not found`);
  }
}

/**
 * cmdAlarmTrigger - 手动触发闹钟
 */
export async function cmdAlarmTrigger(id: string, options: AlarmOptions): Promise<void> {
  const alarm = getAlarm(id);
  if (!alarm) {
    console.error(`Error: Alarm "${id}" not found`);
    process.exit(1);
  }

  // 检查 session 是否可用
  const check = checkAlarm(alarm.project);
  if (!check.alive) {
    console.error(`Error: Session "${alarm.project}" is not alive`);
    process.exit(1);
  }

  // 触发闹钟
  const { triggerAlarm } = await import('./alarm-trigger.js');
  const result = await triggerAlarm(alarm);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log(`Alarm "${id}" triggered`);
  } else {
    console.error(`Failed to trigger alarm "${id}": ${result.error}`);
    process.exit(1);
  }
}

/**
 * cmdAlarmAdopt - 接管已有 tmux session
 * 将非 drudge 启动的 session 注册为可用
 */
export async function cmdAlarmAdopt(options: AlarmOptions): Promise<void> {
  const projectName = options.project || path.basename(process.cwd());
  const sessionName = options.session || projectName;

  // 检查项目是否注册
  const projectPath = getProjectPath(projectName);
  if (!projectPath) {
    console.error(`Error: Project "${projectName}" is not registered in ~/.drudge/config.json`);
    process.exit(1);
  }

  // 检查 tmux session 是否存活
  if (!isTmuxSessionAlive(sessionName)) {
    console.error(`Error: Session "${sessionName}" is not alive`);
    process.exit(1);
  }

  // 检查 tmux session 工作目录
  const workdir = resolveTmuxWorkingDirectory(sessionName);
  if (workdir && !workdir.startsWith(projectPath)) {
    if (!options.force) {
      console.error(`Error: Session workdir "${workdir}" does not match project path "${projectPath}"`);
      console.error('Hint: use --force to adopt anyway');
      process.exit(1);
    }
  }

  // 注册 session 文件
  setSessionEnabled(sessionName, true, { stateDir: getDefaultStateDir() });

  if (options.json) {
    console.log(JSON.stringify({ ok: true, project: projectName, session: sessionName }, null, 2));
    return;
  }

  console.log(`Session "${sessionName}" adopted for project "${projectName}"`);
  if (workdir) {
    console.log(`Workdir: ${workdir}`);
  }
}

/**
 * Parse alarm-specific flags from args
 */
function parseAlarmFlags(args: string[]): AlarmOptions {
  const opts: AlarmOptions = {};
  const filtered: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-p' || a === '--project') {
      opts.project = args[++i];
    } else if (a === '-s' || a === '--session') {
      opts.session = args[++i];
    } else if (a === '--id') {
      opts.id = args[++i];
    } else if (a === '--once') {
      opts.once = true;
    } else if (a === '--force') {
      opts.force = true;
    } else if (a === '-m' || a === '--message') {
      opts.message = args[++i];
    } else if (a === '--json') {
      opts.json = true;
    } else {
      filtered.push(a);
    }
  }

  return { ...opts, _positional: filtered } as AlarmOptions & { _positional: string[] };
}

/**
 * cmdAlarm - 闹钟命令入口
 */
export async function cmdAlarm(args: string[], _cliOptions?: AlarmOptions): Promise<void> {
  const parsed = parseAlarmFlags(args);
  const subcommand = parsed._positional![0];

  switch (subcommand) {
    case 'check':
      await cmdAlarmCheck(parsed);
      break;
    case 'add': {
      const cron = parsed._positional![1];
      if (!cron) {
        console.error('Error: cron expression is required');
        console.log('Usage: drudge alarm add <cron> --id <name> -p <project> [--once] [-m <message>]');
        process.exit(1);
      }
      await cmdAlarmAdd(cron, parsed);
      break;
    }
    case 'list':
      await cmdAlarmList(parsed);
      break;
    case 'remove': {
      const id = parsed._positional![1];
      if (!id) {
        console.error('Error: alarm id is required');
        console.log('Usage: drudge alarm remove <alarm-id>');
        process.exit(1);
      }
      await cmdAlarmRemove(id, parsed);
      break;
    }
    case 'trigger': {
      const id = parsed._positional![1];
      if (!id) {
        console.error('Error: alarm id is required');
        console.log('Usage: drudge alarm trigger <alarm-id>');
        process.exit(1);
      }
      await cmdAlarmTrigger(id, parsed);
      break;
    }
    case 'adopt':
      await cmdAlarmAdopt(parsed);
      break;

    case 'clear': {
      const project = parsed.project;
      const alarms = listAlarms();
      const toRemove = project
        ? alarms.filter(a => a.project === project)
        : alarms;
      let removed = 0;
      for (const alarm of toRemove) {
        removeAlarm(alarm.id);
        removed++;
      }
      if (parsed.json) {
        console.log(JSON.stringify({ ok: true, removed }, null, 2));
        return;
      }
      if (project) {
        console.log(`Cleared ${removed} alarm(s) for project: ${project}`);
      } else {
        console.log(`Cleared ${removed} alarm(s)`);
      }
      return;
    }

    default:
      printAlarmHelp();
  }
}

function printAlarmHelp(): void {
  console.log(`
Alarm commands:
  check                Check if alarm is ready for current project
  adopt                Adopt an existing tmux session for alarms
  add <cron>           Add an alarm
    --id <name>        Alarm ID (required)
    -p <project>       Project name (default: current directory)
    -s <session>       Session name (default: project name)
    --force            Adopt even if tmux workdir does not match project path
    --once             One-shot alarm (removed after trigger)
    -m <message>       Additional message
  list                 List all alarms
  remove <id>          Remove an alarm
  trigger <id>         Manually trigger an alarm

Cron format: minute hour day-of-month month day-of-week
  Example: "0 9 * * 1-5" = weekdays at 9:00
`);
}
