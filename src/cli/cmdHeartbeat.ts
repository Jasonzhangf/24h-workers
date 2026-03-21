/**
 * Heartbeat CLI Commands
 * 心跳管理命令
 */

import path from 'node:path';
import fs from 'node:fs';
import { listSessions, setSessionEnabled, loadSession } from '../core/state-store.js';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { injectTmuxText } from '../tmux/injector.js';
import { buildTimeTagLine } from '../clock/time-tag.js';
import { getPromptFile } from '../core/config.js';
import { printJson, printError, type CliOptions } from './cli-utils.js';

export async function cmdHeartbeat(args: string[], options: CliOptions): Promise<void> {
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

export function printHeartbeatHelp(): void {
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

