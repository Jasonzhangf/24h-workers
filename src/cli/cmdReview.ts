/**
 * Review CLI Command
 * 独立的 review 工具：调用系统 codex exec 获取结果，通过 tmux 注入返回
 * 唯一真源：drudge review 命令
 * 可被任何工具调用（codex / routecodex / 脚本等）
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectTmuxText } from '../tmux/injector.js';
import { isTmuxSessionAlive, resolveTmuxActiveTarget } from '../tmux/session-probe.js';
import { buildTimeTagLine } from '../clock/time-tag.js';
import { getProjectName } from '../core/config.js';
import { printError, printJson, logToFile, type CliOptions } from './cli-utils.js';

interface ReviewArgs {
  goal?: string;
  focus?: string;
  context?: string;
  profile?: string;
}

interface CodexExecCapabilities {
  supportsReviewSubcommand: boolean;
  supportsDangerouslyBypass: boolean;
  supportsSkipGitRepoCheck: boolean;
  supportsOutputLastMessage: boolean;
  supportsProfile: boolean;
  rawHelp: string;
}

const DEFAULT_REVIEW_GOAL =
  '请作为 reviewer 基于当前代码与测试证据进行审查，指出未完成项并给出最小下一步可执行动作。';

function parseReviewArgs(args: string[]): ReviewArgs {
  const parsed: ReviewArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--goal') { parsed.goal = args[++i] || ''; continue; }
    if (arg === '--focus') { parsed.focus = args[++i] || ''; continue; }
    if (arg === '--context') { parsed.context = args[++i] || ''; continue; }
    if (arg === '-p' || arg === '--profile') { parsed.profile = args[++i] || ''; continue; }
  }
  return parsed;
}

function buildReviewPrompt(args: ReviewArgs): string {
  const goal = (args.goal || DEFAULT_REVIEW_GOAL).trim();
  const composedGoal = args.focus ? `${goal}\nfocus: ${args.focus.trim()}` : goal;
  const contextLine = args.context ? `补充上下文：${args.context.trim()}` : '';

  return [
    '请先做严格代码 review（证据驱动），不要相信"已完成"口头声明。',
    '',
    '**重要约束**：',
    '- 只读 review，禁止修改任何代码或文件',
    '- 禁止创建新文件',
    '- 禁止运行 file update / apply_patch 等写操作',
    '- 只输出 review 结果，不做任何实现',
    '',
    `短期目标：${composedGoal}`,
    contextLine,
    '要求：逐条给出"声明项 -> 证据（文件路径/测试名/命令输出）-> 是否完成"；缺证据按未完成处理。',
    '然后给出最小下一步写动作（改代码/补测试），并继续执行，不要直接 stop。'
  ]
    .filter(Boolean)
    .join('\n');
}

function detectCodexExecCapabilities(
  codexBin: string,
  reviewCwd: string,
  env: NodeJS.ProcessEnv
): CodexExecCapabilities {
  const execHelpResult = spawnSync(codexBin, ['exec', '--help'], {
    cwd: reviewCwd,
    encoding: 'utf8',
    timeout: 8_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });
  const execRawHelp = `${execHelpResult.stdout || ''}\n${execHelpResult.stderr || ''}`.trim();
  const supportsReviewSubcommand = /\breview\b/.test(execRawHelp);
  const reviewHelpResult = supportsReviewSubcommand
    ? spawnSync(codexBin, ['exec', 'review', '--help'], {
        cwd: reviewCwd,
        encoding: 'utf8',
        timeout: 8_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      })
    : null;
  const reviewRawHelp = reviewHelpResult
    ? `${reviewHelpResult.stdout || ''}\n${reviewHelpResult.stderr || ''}`.trim()
    : '';
  const rawHelp = reviewRawHelp || execRawHelp;

  return {
    supportsReviewSubcommand,
    supportsDangerouslyBypass: /--dangerously-bypass-approvals-and-sandbox/.test(rawHelp),
    supportsSkipGitRepoCheck: /--skip-git-repo-check/.test(rawHelp),
    supportsOutputLastMessage: /--output-last-message\b/.test(rawHelp),
    supportsProfile: /(^|\s)-p,\s*--profile\b|--profile\b/.test(rawHelp),
    rawHelp
  };
}

export async function cmdReview(args: string[], options: CliOptions): Promise<void> {
  const parsed = parseReviewArgs(args);
  const reviewCwd = options.cwd || process.cwd();
  const projectName = getProjectName(reviewCwd);
  const sessionId = options.session || projectName;

  if (!sessionId) {
    printError('Session ID required. Use -s <session> or run from a registered project directory.');
    return;
  }

  if (!isTmuxSessionAlive(sessionId)) {
    printError(`Tmux session not found: ${sessionId}`);
    return;
  }

  const prompt = buildReviewPrompt(parsed);
  logToFile(`[review] Starting review for session=${sessionId}, cwd=${reviewCwd}`);
  logToFile(`[review] Prompt: ${prompt.slice(0, 200)}...`);

  const codexBin =
    process.env.DRUDGE_REVIEW_CODEX_BIN ||
    'codex';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drudge-review-'));
  const outputFilePath = path.join(tmpDir, 'last-message.txt');

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  logToFile(`[review] codexBin=${codexBin}, CODEX_HOME=${codexHome}, reviewCwd=${reviewCwd}`);

  const spawnEnv = {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: process.env.HOME || os.homedir()
  };
  const capabilities = detectCodexExecCapabilities(codexBin, reviewCwd, spawnEnv);

  // 调用 codex exec（系统安装的 codex 工具）
  // 参数按目标 codex 版本能力精确拼装，避免未知参数导致失败
  const codexArgs: string[] = ['exec'];
  if (capabilities.supportsReviewSubcommand) {
    codexArgs.push('review');
  }
  if (capabilities.supportsDangerouslyBypass) {
    codexArgs.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (capabilities.supportsSkipGitRepoCheck) {
    codexArgs.push('--skip-git-repo-check');
  }
  if (capabilities.supportsOutputLastMessage) {
    codexArgs.push('--output-last-message', outputFilePath);
  }
  if (parsed.profile && capabilities.supportsProfile) {
    codexArgs.push('-p', parsed.profile);
  }
  codexArgs.push(prompt);

  logToFile(`[review] codex args: ${JSON.stringify(codexArgs.slice(0, 8))}...`);
  if (parsed.profile && !capabilities.supportsProfile) {
    logToFile('[review] profile argument ignored: target codex exec does not advertise --profile support');
  }
  if (!capabilities.supportsOutputLastMessage) {
    logToFile('[review] target codex exec does not advertise --output-last-message; will fallback to stdout');
  }

  const result = spawnSync(codexBin, codexArgs, {
    cwd: reviewCwd,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnEnv
  });

  const codexFailed = result.status !== 0 || !!result.error;
  const codexErrorText = codexFailed
    ? (result.stderr || result.stdout || 'codex exec failed').trim()
    : (result.stderr || '').trim();
  logToFile(`[review] codex exit: status=${result.status}, error=${result.error ? String(result.error) : 'none'}, stderr=${codexErrorText.slice(0, 300)}`);

  let reviewText = '';
  if (fs.existsSync(outputFilePath)) {
    try { reviewText = fs.readFileSync(outputFilePath, 'utf8').trim(); } catch { reviewText = ''; }
  }
  if (!reviewText) { reviewText = (result.stdout || '').trim(); }
  if (!reviewText) {
    logToFile('[review] codex returned empty, using fallback');
    reviewText = codexFailed
      ? `[Review][Error] codex exec failed: ${codexErrorText || 'unknown error'}`
      : '[Review] codex returned empty output.';
  }
  logToFile(`[review] review text length=${reviewText.length}`);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  const target = resolveTmuxActiveTarget(sessionId) || sessionId;
  const timeTag = buildTimeTagLine();
  const injectText = `${timeTag}\n\n[Review]\n${reviewText}`;

  const injectResult = await injectTmuxText({
    sessionId: target,
    text: injectText,
    submit: true
  });
  logToFile(`[review] inject target=${target}, ok=${injectResult.ok}, reason=${injectResult.reason || 'none'}`);
  logToFile(`[review] completed. session=${sessionId}, codexFailed=${codexFailed}`);

  if (options.json) {
    printJson({ ok: injectResult.ok, target, reason: injectResult.reason, codexFailed, codexError: codexErrorText || undefined });
    return;
  }

  if (!injectResult.ok) {
    printError(injectResult.reason || 'review inject failed');
    return;
  }

  if (codexFailed) {
    console.log(`Review injected with codex error to session: ${target}`);
    return;
  }

  console.log(`Review injected to session: ${target}`);
}
