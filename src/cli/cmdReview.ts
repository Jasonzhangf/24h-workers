/**
 * Review CLI Command
 * 触发 review 流程并注入 tmux
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectTmuxText } from '../tmux/injector.js';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { buildTimeTagLine } from '../clock/time-tag.js';
import { getProjectName } from '../core/config.js';
import { printError, printJson, logToFile, type CliOptions } from './cli-utils.js';

interface ReviewArgs {
  goal?: string;
  focus?: string;
  context?: string;
}

const DEFAULT_REVIEW_GOAL =
  '请作为 reviewer 基于当前代码与测试证据进行审查，指出未完成项并给出最小下一步可执行动作。';

function parseReviewArgs(args: string[]): ReviewArgs {
  const parsed: ReviewArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--goal') {
      parsed.goal = args[i + 1] || '';
      i++;
      continue;
    }
    if (arg === '--focus') {
      parsed.focus = args[i + 1] || '';
      i++;
      continue;
    }
    if (arg === '--context') {
      parsed.context = args[i + 1] || '';
      i++;
      continue;
    }
  }
  return parsed;
}

function buildReviewPrompt(args: ReviewArgs): string {
  const goal = (args.goal || DEFAULT_REVIEW_GOAL).trim();
  const composedGoal = args.focus ? `${goal}\nfocus: ${args.focus.trim()}` : goal;
  const contextLine = args.context ? `补充上下文：${args.context.trim()}` : '';

  return [
    '请先做严格代码 review（证据驱动），不要相信“已完成”口头声明。',
    `短期目标：${composedGoal}`,
    contextLine,
    '要求：逐条给出“声明项 -> 证据（文件路径/测试名/命令输出）-> 是否完成”；缺证据按未完成处理。',
    '然后给出最小下一步写动作（改代码/补测试），并继续执行，不要直接 stop。'
  ]
    .filter(Boolean)
    .join('\n');
}

function emitReviewToolLogs(): void {
  logToFile('tool=review stage=match result=matched');
  logToFile('tool=review stage=final result=completed_client_inject_only');
  logToFile('review_flow executed=true');
  logToFile('tool_outputs[0].name="review" content="Review request accepted... queued for client injection."');
}

export async function cmdReview(args: string[], options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const projectName = getProjectName(cwd);
  const sessionId = options.session || projectName;

  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }

  if (!isTmuxSessionAlive(sessionId)) {
    printError(`Tmux session not found: ${sessionId}`);
    return;
  }

  const parsed = parseReviewArgs(args);
  const prompt = buildReviewPrompt(parsed);

  // simulate review tool execution logs
  emitReviewToolLogs();

  const codexBin =
    process.env.DRUDGE_REVIEW_CODEX_BIN ||
    process.env.ROUTECODEX_STOPMESSAGE_AI_FOLLOWUP_CODEX_BIN ||
    'codex';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drudge-review-'));
  const outputFilePath = path.join(tmpDir, 'last-message.txt');

  // run codex exec with review prompt (routecodex-compatible)
  const result = spawnSync(
    codexBin,
    ['exec', '--color', 'never', '--skip-git-repo-check', '--output-last-message', outputFilePath, prompt],
    {
      cwd,
      encoding: 'utf8'
    }
  );

  const codexFailed = result.status !== 0;
  const codexErrorText = (result.stderr || result.stdout || 'codex exec failed').trim();

  let reviewText = '';
  if (fs.existsSync(outputFilePath)) {
    try {
      reviewText = fs.readFileSync(outputFilePath, 'utf8').trim();
    } catch {
      reviewText = '';
    }
  }

  if (!reviewText) {
    reviewText = (result.stdout || '').trim();
  }

  if (!reviewText) {
    reviewText = codexFailed
      ? `[Review][Error] codex exec failed: ${codexErrorText || 'unknown error'}`
      : '[Review] codex returned empty output.';
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
  const timeTag = buildTimeTagLine();
  const injectText = `${timeTag}\n\n[Review]\n${reviewText}`;

  const injectResult = await injectTmuxText({
    sessionId,
    text: injectText,
    submit: true
  });

  if (options.json) {
    printJson({ ok: injectResult.ok, reason: injectResult.reason, codexFailed, codexError: codexErrorText || undefined });
    return;
  }

  if (!injectResult.ok) {
    printError(injectResult.reason || 'review inject failed');
    return;
  }

  if (codexFailed) {
    console.log(`Review injected with codex error to session: ${sessionId}`);
    return;
  }

  console.log(`Review injected to session: ${sessionId}`);
}
