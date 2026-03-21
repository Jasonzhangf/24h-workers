/**
 * Review CLI Command
 * 可配置的 review 工具：支持 codex / claude code / 自定义工具
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
import { getProjectName, getDefaultStateDir } from '../core/config.js';
import { printError, printJson, logToFile, type CliOptions } from './cli-utils.js';

/* ------------------------------------------------------------------ */
/*  Review 工具配置类型                                                 */
/* ------------------------------------------------------------------ */

interface ReviewToolConfig {
  /** 工具名称：codex | claude | 自定义名称 */
  name: string;
  /** 可执行文件路径，默认使用 name */
  bin?: string;
  /**
   * 参数模板，占位符：
   *   {cwd}    → 替换为 review 工作目录
   *   {output}  → 替换为临时输出文件路径
   *   {prompt}  → 替换为 review 提示词
   *   {profile} → 替换为 codex/claude profile（可选）
   */
  argsTemplate?: string[];
  /** 是否使用输出文件（output file）获取结果 */
  useOutputFile?: boolean;
  /** stdout 解析模式：last-message 取最后一条，full 取全部 */
  stdoutMode?: 'last-message' | 'full';
}

/** 内置默认工具 */
const BUILTIN_TOOLS: Record<string, ReviewToolConfig> = {
  codex: {
    name: 'codex',
    bin: 'codex',
    argsTemplate: [
      'exec', '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--output-last-message', '{output}',
      '{prompt}'
    ],
    useOutputFile: true,
    stdoutMode: 'full'
  },
  claude: {
    name: 'claude',
    bin: 'claude',
    argsTemplate: [
      '--dangerously-skip-permissions',
      '--print', '{prompt}'
    ],
    useOutputFile: false,
    stdoutMode: 'last-message'
  }
};

function resolveReviewConfigFile(): string {
  return path.join(getDefaultStateDir(), 'review-config.json');
}

/**
 * 加载 review 工具配置
 * 优先级：--tool 参数 > review-config.json > 环境变量 > 默认 codex
 */
function loadReviewTool(toolName: string | undefined): ReviewToolConfig {
  // 1. 环境变量
  if (process.env.DRUDGE_REVIEW_TOOL) {
    const envTool = process.env.DRUDGE_REVIEW_TOOL;
    const builtin = BUILTIN_TOOLS[envTool];
    if (builtin) {
      logToFile(`[review] Using env DRUDGE_REVIEW_TOOL=${envTool}`);
      return { ...builtin };
    }
    // 环境变量指定了自定义工具
    logToFile(`[review] Using env DRUDGE_REVIEW_TOOL=${envTool} (custom)`);
    return { name: envTool, bin: envTool, argsTemplate: ['{prompt}'], stdoutMode: 'full' };
  }

  // 2. 配置文件
  const configFile = resolveReviewConfigFile();
  if (fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, 'utf8');
      const config = JSON.parse(content);

      // 如果配置了 default 工具
      const resolvedName = toolName || config.default;
      if (resolvedName && config.tools && config.tools[resolvedName]) {
        const builtin = BUILTIN_TOOLS[resolvedName] || {};
        logToFile(`[review] Loaded tool "${resolvedName}" from review-config.json`);
        return { ...builtin, ...config.tools[resolvedName] };
      }
      if (config.default && config.tools && config.tools[config.default]) {
        const builtin = BUILTIN_TOOLS[config.default] || {};
        logToFile(`[review] Loaded default tool "${config.default}" from review-config.json`);
        return { ...builtin, ...config.tools[config.default] };
      }
    } catch (e) {
      logToFile(`[review] Failed to load review-config.json: ${e}`);
    }
  }

  // 3. --tool 参数
  if (toolName && BUILTIN_TOOLS[toolName]) {
    logToFile(`[review] Using --tool=${toolName}`);
    return { ...BUILTIN_TOOLS[toolName] };
  }

  // 4. 默认 codex
  logToFile(`[review] Using default tool: codex`);
  return { ...BUILTIN_TOOLS.codex };
}

/* ------------------------------------------------------------------ */
/*  参数解析                                                          */
/* ------------------------------------------------------------------ */

interface ReviewArgs {
  goal?: string;
  focus?: string;
  context?: string;
  profile?: string;
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

/**
 * 将模板展开为实际参数
 */
function expandArgsTemplate(
  template: string[],
  vars: { cwd: string; output: string; prompt: string; profile?: string }
): string[] {
  const result: string[] = [];
  for (const item of template) {
    let expanded = item
      .replace(/\{cwd\}/g, vars.cwd)
      .replace(/\{output\}/g, vars.output)
      .replace(/\{prompt\}/g, vars.prompt)
      .replace(/\{profile\}/g, vars.profile || '');
    // 跳过 profile 为空时产生的空字符串参数
    if (expanded === '' && item === '{profile}') continue;
    if (expanded) result.push(expanded);
  }
  return result;
}

/**
 * 从 stdout 提取 review 文本
 */
function extractStdoutText(stdout: string, mode: string): string {
  if (mode === 'last-message') {
    // 取最后一个非空消息块（通常用 `---` 或空行分隔）
    const blocks = stdout.split(/\n---\n|\n\n\n+/).map(b => b.trim()).filter(Boolean);
    return blocks.length > 0 ? blocks[blocks.length - 1] : '';
  }
  return stdout.trim();
}

/* ------------------------------------------------------------------ */
/*  主命令                                                            */
/* ------------------------------------------------------------------ */

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
  const tool = loadReviewTool(options.tool);
  logToFile(`[review] Starting review for session=${sessionId}, cwd=${reviewCwd}, tool=${tool.name}`);
  logToFile(`[review] Prompt: ${prompt.slice(0, 200)}...`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drudge-review-'));
  const outputFilePath = path.join(tmpDir, 'last-message.txt');
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

  // 展开参数
  const template = tool.argsTemplate || ['{prompt}'];
  const finalArgs = expandArgsTemplate(template, {
    cwd: reviewCwd,
    output: outputFilePath,
    prompt,
    profile: parsed.profile
  });

  const bin = tool.bin || tool.name;
  logToFile(`[review] bin=${bin}, args=${JSON.stringify(finalArgs.slice(0, 6))}...`);

  const spawnEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    HOME: process.env.HOME || os.homedir()
  };
  if (codexHome) {
    spawnEnv.CODEX_HOME = codexHome;
  }

  const result = spawnSync(bin, finalArgs, {
    cwd: reviewCwd,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnEnv
  });

  const failed = result.status !== 0 || !!result.error;
  const errorText = failed
    ? (result.stderr || result.stdout || `${bin} failed`).trim()
    : (result.stderr || '').trim();
  logToFile(`[review] exit: status=${result.status}, error=${result.error ? String(result.error) : 'none'}, stderr=${errorText.slice(0, 300)}`);

  // 提取 review 文本
  let reviewText = '';

  // 优先从输出文件读取
  if (tool.useOutputFile !== false && fs.existsSync(outputFilePath)) {
    try { reviewText = fs.readFileSync(outputFilePath, 'utf8').trim(); } catch { /* ignore */ }
  }

  // fallback 到 stdout
  if (!reviewText && result.stdout) {
    reviewText = extractStdoutText(result.stdout, tool.stdoutMode || 'full');
  }

  // 最终 fallback
  if (!reviewText) {
    logToFile('[review] tool returned empty, using fallback');
    reviewText = failed
      ? `[Review][Error] ${bin} failed: ${errorText || 'unknown error'}`
      : `[Review] ${bin} returned empty output.`;
  }
  logToFile(`[review] review text length=${reviewText.length}`);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  // 注入到 tmux
  const target = resolveTmuxActiveTarget(sessionId) || sessionId;
  const timeTag = buildTimeTagLine();
  const injectText = `${timeTag}\n\n[Review]\n${reviewText}`;

  const injectResult = await injectTmuxText({
    sessionId: target,
    text: injectText,
    submit: true
  });
  logToFile(`[review] inject target=${target}, ok=${injectResult.ok}, reason=${injectResult.reason || 'none'}`);
  logToFile(`[review] completed. session=${sessionId}, tool=${tool.name}, failed=${failed}`);

  if (options.json) {
    printJson({ ok: injectResult.ok, target, tool: tool.name, reason: injectResult.reason, failed, error: errorText || undefined });
    return;
  }

  if (!injectResult.ok) {
    printError(injectResult.reason || 'review inject failed');
    return;
  }

  if (failed) {
    console.log(`Review (tool=${tool.name}) injected with error to session: ${target}`);
    return;
  }

  console.log(`Review (tool=${tool.name}) injected to session: ${target}`);
}
