/**
 * Heartbeat Config Module
 * 配置管理，解析与默认值
 * 唯一真源：所有配置解析
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ProxyConfig {
  enabled: boolean;
  anthropicPort: number;
  openaiPort: number;
  geminiPort: number;
}

export interface FinishReasonConfig {
  triggerOn: string[];
}

export interface HeartbeatConfig {
  tickMs: number;
  promptFile: string;
  stateDir?: string;
  proxy: ProxyConfig;
  finishReason: FinishReasonConfig;
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  tickMs: 15 * 60_000, // 15 分钟
  promptFile: 'HEARTBEAT.md',
  proxy: {
    enabled: false,
    anthropicPort: 8081,
    openaiPort: 8082,
    geminiPort: 8083
  },
  finishReason: {
    triggerOn: ['stop']
  }
};

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  return fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const result = value
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map(item => item.trim());
    return result.length > 0 ? result : fallback;
  }
  return fallback;
}

function normalizeProxyConfig(value: unknown): ProxyConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_CONFIG.proxy;
  }
  
  const cfg = value as Record<string, unknown>;
  return {
    enabled: normalizeBoolean(cfg.enabled, false),
    anthropicPort: normalizePositiveInt(cfg.anthropicPort, DEFAULT_CONFIG.proxy.anthropicPort),
    openaiPort: normalizePositiveInt(cfg.openaiPort, DEFAULT_CONFIG.proxy.openaiPort),
    geminiPort: normalizePositiveInt(cfg.geminiPort, DEFAULT_CONFIG.proxy.geminiPort)
  };
}

function normalizeFinishReasonConfig(value: unknown): FinishReasonConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_CONFIG.finishReason;
  }
  
  const cfg = value as Record<string, unknown>;
  return {
    triggerOn: normalizeStringArray(cfg.triggerOn, DEFAULT_CONFIG.finishReason.triggerOn)
  };
}

function applyEnvOverrides(config: HeartbeatConfig): HeartbeatConfig {
  const envTickMs = process.env.HEARTBEAT_TICK_MS || process.env.HB_TICK_MS;
  const envPromptFile = process.env.HEARTBEAT_PROMPT_FILE || process.env.HB_PROMPT_FILE;
  const envStateDir = process.env.HEARTBEAT_STATE_DIR || process.env.HB_STATE_DIR;
  
  return {
    ...config,
    tickMs: envTickMs ? normalizePositiveInt(envTickMs, config.tickMs) : config.tickMs,
    promptFile: envPromptFile ? normalizeString(envPromptFile, config.promptFile) : config.promptFile,
    stateDir: envStateDir ? normalizeString(envStateDir, config.stateDir || '') : config.stateDir
  };
}

function loadConfigFile(configPath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function findConfigFile(startDir?: string): string | undefined {
  const cwd = startDir || process.cwd();
  
  const candidates = [
    path.join(cwd, 'heartbeat.config.json'),
    path.join(cwd, 'config.local.json'),
    path.join(cwd, 'config.json')
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  
  return undefined;
}

export function resolveConfig(options?: {
  configPath?: string;
  cwd?: string;
}): HeartbeatConfig {
  let config = { ...DEFAULT_CONFIG };
  
  const configPath = options?.configPath || findConfigFile(options?.cwd);
  if (configPath) {
    const fileConfig = loadConfigFile(configPath);
    if (fileConfig) {
      config = {
        tickMs: normalizePositiveInt(fileConfig.tickMs, config.tickMs),
        promptFile: normalizeString(fileConfig.promptFile, config.promptFile),
        stateDir: typeof fileConfig.stateDir === 'string' ? fileConfig.stateDir : config.stateDir,
        proxy: normalizeProxyConfig(fileConfig.proxy),
        finishReason: normalizeFinishReasonConfig(fileConfig.finishReason)
      };
    }
  }
  
  config = applyEnvOverrides(config);
  
  return config;
}

export function getDefaultStateDir(): string {
  return path.join(process.env.HOME || '~', '.heartbeat');
}
