/**
 * Session CLI Command
 * 通过路径反查 tmux session
 */

import { isTmuxSessionAlive, normalizeTmuxSessionTarget, resolveTmuxTargetByWorkdir } from '../tmux/session-probe.js';
import { printError, printJson, type CliOptions } from './cli-utils.js';

function printSessionHelp(): void {
  console.log(`
Usage:
  drudge session resolve [-C <dir>] [--json]

Description:
  Resolve tmux session target by workdir path.
`);
}

export async function cmdSession(args: string[], options: CliOptions): Promise<void> {
  const sub = args[0] || '';
  if (!sub || sub === '-h' || sub === '--help') {
    printSessionHelp();
    return;
  }

  if (sub !== 'resolve') {
    printSessionHelp();
    return;
  }

  const cwd = options.cwd || args[1] || process.cwd();
  const target = resolveTmuxTargetByWorkdir(cwd);
  if (!target) {
    printError(`No tmux session found for path: ${cwd}`);
    return;
  }

  const sessionName = normalizeTmuxSessionTarget(target);
  if (!isTmuxSessionAlive(sessionName)) {
    printError(`Tmux session not alive: ${sessionName}`);
    return;
  }

  if (options.json) {
    printJson({ ok: true, target, sessionName, cwd });
    return;
  }

  console.log(target);
}
