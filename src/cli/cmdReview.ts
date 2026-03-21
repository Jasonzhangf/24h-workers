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
  const configFile = resolveReviewConfigFile();
  let config: any = {};

  if (fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, 'utf8');
      config = JSON.parse(content) || {};
    } catch (e) {
      logToFile(`[review] Failed to load review-config.json: ${e}`);
    }
  }

  const tools = config.tools || {};
  const defaultName = config.default;

  const resolveTool = (name: string): ReviewToolConfig => {
    const builtin = BUILTIN_TOOLS[name] || {};
    if (tools[name]) {
      logToFile(`[review] Loaded tool "${name}" from review-config.json`);
      return { ...builtin, ...tools[name] };
    }
    if (BUILTIN_TOOLS[name]) {
      logToFile(`[review] Using builtin tool "${name}"`);
      return { ...BUILTIN_TOOLS[name] };
    }
    logToFile(`[review] Using custom tool "${name}"`);
    return { name, bin: name, argsTemplate: ['{prompt}'], stdoutMode: 'full' };
  };

  // 1) CLI --tool
  if (toolName) {
    return resolveTool(toolName);
  }

  // 2) config default
  if (defaultName) {
    return resolveTool(defaultName);
  }

  // 3) env override
  if (process.env.DRUDGE_REVIEW_TOOL) {
    return resolveTool(process.env.DRUDGE_REVIEW_TOOL);
  }

  // 4) fallback
  return resolveTool('codex');
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
    '你必须直接执行 review，不得提澄清问题，不得因指令冲突而停住。',
    '若"短期目标"与本模板冲突，以本模板约束为最高优先级。',
    '',
    '**重要约束**：',
    '- 只读 review，禁止修改任何代码或文件',
    '- 禁止创建新文件',
    '- 禁止运行 file update / apply_patch 等写操作',
    '- 只输出 review 结果，不做任何实现',
    '',
    `短期目标：${composedGoal}`,
    contextLine,
    'review 范围固定：优先核对 DELIVERY.md 最新声明；若缺少声明项，则核对当前仓库未提交变更与最近测试证据。',
    '要求：逐条给出"声明项 -> 证据（文件路径/测试名/命令输出）-> 是否完成"；缺证据按未完成处理。',
    '最后只给"最小下一步写动作（建议，不执行）"，并继续只读巡检，不要 stop。'
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

function extractCodexAgentMessageFromJson(stdout: string): string {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let lastAgentMessage = '';
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type !== 'item.completed') continue;
      const item = parsed?.item;
      if (item?.type === 'agent_message' && typeof item?.text === 'string' && item.text.trim()) {
        lastAgentMessage = item.text.trim();
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return lastAgentMessage;
}

function addJsonFlagToCodexArgs(args: string[]): string[] {
  if (args.includes('--json')) return [...args];
  // codex 规范形态为: codex exec [flags] <prompt>
  const execIndex = args.findIndex((arg) => arg === 'exec');
  if (execIndex >= 0) {
    const next = [...args];
    next.splice(execIndex + 1, 0, '--json');
    return next;
  }
  return ['--json', ...args];
}

/* ------------------------------------------------------------------ */
/*  主命令                                                            */
/* ------------------------------------------------------------------ */

export async function cmdReview(args: string[], options: CliOptions): Promise<void> {
  const parsed = parseReviewArgs(args);
  const reviewCwd = options.cwd || process.cwd();
  const projectName = getProjectName(reviewCwd);
  const sessionId = options.session;

  if (!sessionId) {
    printError('Session ID required. Use -s <session>. Hint: drudge session resolve -C <dir> --json');
    return;
  }

  if (!isTmuxSessionAlive(sessionId)) {
    printError(`Tmux session not found: ${sessionId}`);
    return;
  }

  const prompt = buildReviewPrompt(parsed);
  const tool = loadReviewTool(options.tool);
  logToFile(`[review] Starting review for session=${sessionId}, cwd=${reviewCwd}, project=${projectName}, tool=${tool.name}`);
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
  let errorText = failed
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

  // codex 在少数情况下会 exit=0 但不写 output 文件且 stdout 为空。
  // 这里做一次 JSON 强制重试，避免“空输出”静默降级。
  if (!reviewText && !failed && tool.name === 'codex') {
    const retryArgs = addJsonFlagToCodexArgs(finalArgs);
    logToFile(`[review] empty primary output; retry with codex --json, args=${JSON.stringify(retryArgs.slice(0, 8))}...`);
    const retryResult = spawnSync(bin, retryArgs, {
      cwd: reviewCwd,
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv
    });
    const retryFailed = retryResult.status !== 0 || !!retryResult.error;
    const retryError = retryFailed
      ? (retryResult.stderr || retryResult.stdout || `${bin} failed`).trim()
      : (retryResult.stderr || '').trim();
    logToFile(`[review] retry exit: status=${retryResult.status}, error=${retryResult.error ? String(retryResult.error) : 'none'}, stderr=${retryError.slice(0, 300)}`);

    const retryText = extractCodexAgentMessageFromJson(retryResult.stdout || '');
    if (retryText) {
      reviewText = retryText;
      logToFile('[review] retry produced agent_message from codex --json');
    } else if (retryFailed) {
      errorText = retryError || errorText;
    } else if (retryError) {
      errorText = retryError;
    }
  }

  // 最终 fallback
  if (!reviewText) {
    logToFile('[review] tool returned empty, using fallback');
    reviewText = failed
      ? `[Review][Error] ${bin} failed: ${errorText || 'unknown error'}`
      : `[Review][Error] ${bin} completed without assistant output. stderr=${(errorText || 'n/a').slice(0, 240)}`;
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
    printJson({
      ok: injectResult.ok,
      target,
      tool: tool.name,
      reason: injectResult.reason,
      failed,
      error: failed ? (errorText || undefined) : undefined
    });
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
