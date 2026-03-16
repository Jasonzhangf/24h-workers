/**
 * Heartbeat Config Module
 * 配置管理
 * 唯一真源：所有配置解析
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface HeartbeatProject {
  path: string;
  heartbeatIntervalMs: number;
  promptFile: string;
}

export interface HeartbeatConfig {
  version: string;
  projects: HeartbeatProject[];
  default: {
    heartbeatIntervalMs: number;
    promptFile: string;
  };
  // Runtime config (not from file)
  tickMs?: number;
  promptFile?: string;
  stateDir?: string;
  proxy?: {
    enabled: boolean;
    anthropicPort?: number;
    openaiPort?: number;
    geminiPort?: number;
  };
  finishReason?: {
    triggerOn: string[];
  };
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  version: '1.0.0',
  projects: [],
  default: {
    heartbeatIntervalMs: 15 * 60 * 1000, // 15 分钟
    promptFile: '~/.drudge/HEARTBEAT.md'
  }
};

const CONFIG_PATH = path.join(os.homedir(), '.drudge', 'config.json');

/**
 * 展开路径中的 ~
 */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * 获取默认状态目录
 */
export function getDefaultStateDir(): string {
  return path.join(os.homedir(), '.drudge');
}

/**
 * 解析配置（兼容旧接口）
 */
export function resolveConfig(options?: { configPath?: string; cwd?: string }): HeartbeatConfig {
  const cwd = options?.cwd || process.cwd();
  const projectConfig = getProjectConfig(cwd);

  return {
    ...DEFAULT_CONFIG,
    tickMs: projectConfig.heartbeatIntervalMs,
    promptFile: projectConfig.promptFile,
    stateDir: getDefaultStateDir(),
    proxy: { enabled: false },
    finishReason: { triggerOn: ['stop'] }
  };
}

/**
 * 读取配置文件
 */
function readConfigFile(): HeartbeatConfig | null {
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(content) as HeartbeatConfig;

    // 展开路径
    if (config.default.promptFile) {
      config.default.promptFile = expandPath(config.default.promptFile);
    }

    for (const project of config.projects) {
      if (project.promptFile) {
        project.promptFile = expandPath(project.promptFile);
      }
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * 获取项目配置
 */
export function getProjectConfig(cwd: string): {
  heartbeatIntervalMs: number;
  promptFile: string;
} {
  const config = readConfigFile();

  // 匹配项目
  const project = config?.projects.find(p => cwd.startsWith(p.path));

  if (project) {
    return {
      heartbeatIntervalMs: project.heartbeatIntervalMs,
      promptFile: project.promptFile
    };
  }

  // 使用默认配置
  const defaultConfig = config?.default || DEFAULT_CONFIG.default;
  return {
    heartbeatIntervalMs: defaultConfig.heartbeatIntervalMs,
    promptFile: expandPath(defaultConfig.promptFile)
  };
}

/**
 * 获取心跳间隔
 */
export function getHeartbeatInterval(cwd: string): number {
  const config = getProjectConfig(cwd);

  // 环境变量覆盖
  if (process.env.DRUDGE_HEARTBEAT_INTERVAL) {
    return parseInt(process.env.DRUDGE_HEARTBEAT_INTERVAL, 10);
  }

  return config.heartbeatIntervalMs;
}

/**
 * 获取提示词文件路径
 */
export function getPromptFile(cwd: string): string {
  const config = getProjectConfig(cwd);
  return config.promptFile;
}

/**
 * 获取项目名称
 */
export function getProjectName(cwd: string): string {
  const config = readConfigFile();
  const project = config?.projects.find(p => cwd.startsWith(p.path));

  if (project) {
    return path.basename(project.path);
  }

  // 使用当前目录名
  return path.basename(cwd);
}

/**
 * 生成默认配置文件
 */
export function generateDefaultConfig(): void {
  const configDir = path.join(os.homedir(), '.drudge');
  const configFile = path.join(configDir, 'config.json');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}
