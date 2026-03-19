/**
 * Trigger CLI Command
 * 直接向 tmux session 注入文本
 */

import { injectTmuxText } from '../tmux/injector.js';

interface TriggerOptions {
  session?: string;
  json?: boolean;
}

interface ParsedTriggerArgs {
  message: string;
  submit: boolean;
}

function parseTriggerArgs(args: string[]): ParsedTriggerArgs {
  let message = '';
  let submit = true;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-submit') {
      submit = false;
      continue;
    }
    if (a === '--submit') {
      submit = true;
      continue;
    }
    if (a === '-m' || a === '--message') {
      message = args[i + 1] || '';
      i++;
      continue;
    }
    if (a === '--json') {
      continue;
    }
    // treat as positional message
    if (!message) {
      message = a;
    } else {
      message += ` ${a}`;
    }
  }

  return { message: message.trim(), submit };
}

export async function cmdTrigger(args: string[], options: TriggerOptions): Promise<void> {
  const sessionId = options.session;
  if (!sessionId) {
    console.error('Error: --session is required');
    console.log('Usage: drudge trigger -s <session> -m <message> [--no-submit]');
    process.exit(1);
  }

  const parsed = parseTriggerArgs(args);
  if (!parsed.message) {
    console.error('Error: message is required');
    console.log('Usage: drudge trigger -s <session> -m <message> [--no-submit]');
    process.exit(1);
  }

  const result = await injectTmuxText({
    sessionId,
    text: parsed.message,
    submit: parsed.submit
  });

  if (options.json) {
    console.log(JSON.stringify({ ok: result.ok, reason: result.reason }, null, 2));
    return;
  }

  if (result.ok) {
    console.log(`Triggered session "${sessionId}"`);
  } else {
    console.error(`Failed to trigger session "${sessionId}": ${result.reason}`);
    process.exit(1);
  }
}
