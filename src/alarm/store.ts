/**
 * Alarm Store
 * 闹钟持久化存储
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Alarm } from './types.js';

const DEFAULT_ALARMS_DIR = path.join(os.homedir(), '.drudge');
const DEFAULT_ALARMS_FILE = path.join(DEFAULT_ALARMS_DIR, 'alarms.json');

type AlarmPaths = {
  dir: string;
  file: string;
};

function resolveAlarmsPath(): AlarmPaths {
  const envFile = process.env.DRUDGE_ALARMS_FILE;
  if (envFile !== undefined) {
    const trimmed = envFile.trim();
    if (!trimmed) {
      throw new Error('DRUDGE_ALARMS_FILE is set but empty');
    }
    return {
      dir: path.dirname(trimmed),
      file: trimmed,
    };
  }

  const envDir = process.env.DRUDGE_ALARMS_DIR;
  if (envDir !== undefined) {
    const trimmed = envDir.trim();
    if (!trimmed) {
      throw new Error('DRUDGE_ALARMS_DIR is set but empty');
    }
    return {
      dir: trimmed,
      file: path.join(trimmed, 'alarms.json'),
    };
  }

  return {
    dir: DEFAULT_ALARMS_DIR,
    file: DEFAULT_ALARMS_FILE,
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * 规范化闹钟对象
 */
function coerceAlarm(raw: unknown, fallbackId: string): Alarm {
  if (!raw || typeof raw !== 'object') {
    return createDefaultAlarm(fallbackId, '* * * * *');
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() || fallbackId : fallbackId;

  return {
    id,
    cron: typeof record.cron === 'string' ? record.cron : '* * * * *',
    once: typeof record.once === 'boolean' ? record.once : false,
    project: typeof record.project === 'string' ? record.project : id,
    message: typeof record.message === 'string' ? record.message : undefined,
    createdAtMs: typeof record.createdAtMs === 'number' ? record.createdAtMs : Date.now(),
    lastTriggeredAtMs: typeof record.lastTriggeredAtMs === 'number' ? record.lastTriggeredAtMs : undefined,
    triggerCount: typeof record.triggerCount === 'number' ? record.triggerCount : 0,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
  };
}

/**
 * 创建默认闹钟
 */
function createDefaultAlarm(id: string, cron: string): Alarm {
  return {
    id,
    cron,
    once: false,
    project: id,
    createdAtMs: Date.now(),
    triggerCount: 0,
    enabled: true,
  };
}

/**
 * 读取闹钟文件
 */
function readAlarmsFile(): Record<string, unknown> {
  const { file } = resolveAlarmsPath();
  try {
    const content = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid alarms file content at ${file}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return {};
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read alarms file at ${file}: ${message}`);
  }
}

/**
 * 写入闹钟文件
 */
function writeAlarmsFile(data: Record<string, unknown>): void {
  const { dir, file } = resolveAlarmsPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${file}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, file);
}

/**
 * 列出所有闹钟
 */
export function listAlarms(): Alarm[] {
  const data = readAlarmsFile();
  const alarms: Alarm[] = [];

  for (const [key, value] of Object.entries(data)) {
    alarms.push(coerceAlarm(value, key));
  }

  return alarms.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * 获取单个闹钟
 */
export function getAlarm(id: string): Alarm | null {
  const data = readAlarmsFile();
  const raw = data[id];
  if (!raw) {
    return null;
  }
  return coerceAlarm(raw, id);
}

/**
 * 添加闹钟（同 ID 覆盖）
 */
export function addAlarm(alarm: Alarm): Alarm {
  const data = readAlarmsFile();
  data[alarm.id] = alarm;
  writeAlarmsFile(data);
  return alarm;
}

/**
 * 移除闹钟
 */
export function removeAlarm(id: string): boolean {
  const data = readAlarmsFile();
  if (!(id in data)) {
    return false;
  }
  delete data[id];
  writeAlarmsFile(data);
  return true;
}

/**
 * 更新闹钟
 */
export function updateAlarm(id: string, patch: Partial<Alarm>): Alarm | null {
  const alarm = getAlarm(id);
  if (!alarm) {
    return null;
  }
  const updated = { ...alarm, ...patch, id };
  addAlarm(updated);
  return updated;
}
