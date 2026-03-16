/**
 * TMUX Attach Helper
 * Attach 到现有的 tmux session
 * 唯一真源：所有 tmux attach 操作
 */

import { spawn } from 'node:child_process';

export interface AttachToExistingTmuxSessionArgs {
  sessionName: string;
  envOverrides: Record<string, string>;
  cwd: string;
}

/**
 * Attach 到现有的 tmux session
 * 唯一真源：所有 tmux attach 操作
 */
export function attachToExistingTmuxSession(
  args: AttachToExistingTmuxSessionArgs
): void {
  const { sessionName, envOverrides, cwd } = args;
  const tmux = spawn('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
    cwd
  });
  tmux.on('exit', (code) => {
    process.exit(code || 0);
  });
}
