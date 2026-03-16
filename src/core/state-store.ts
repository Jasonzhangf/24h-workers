/**
 * Heartbeat State Store Module
 * Session 状态持久化
 * 唯一真源：所有 session 状态存储
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDefaultStateDir } from './config.js';

export interface HeartbeatSession {
  version: 1;
  sessionId: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  triggerCount: number;
  lastTriggeredAtMs?: number;
  lastSkippedAtMs?: number;
  lastSkippedReason?: string;
  lastError?: string;
}

const SESSION_VERSION = 1;

/**
 * 规范化 session ID
 */
function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * 规范化正整数
 */
function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * 规范化布尔值
 */
function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return false;
    }
  }
  return fallback;
}

/**
 * 规范化字符串（可为空）
 */
function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * 强制转换 session 对象
 */
function coerceSession(raw: unknown, fallbackId: string): HeartbeatSession {
  if (!raw || typeof raw !== 'object') {
    return createDefaultSession(fallbackId);
  }
  
  const record = raw as Record<string, unknown>;
  const sessionId = normalizeSessionId(record.sessionId) || fallbackId;
  
  return {
    version: 1,
    sessionId,
    enabled: normalizeBoolean(record.enabled, true),
    createdAtMs: normalizePositiveInt(record.createdAtMs, Date.now()),
    updatedAtMs: normalizePositiveInt(record.updatedAtMs, Date.now()),
    triggerCount: normalizePositiveInt(record.triggerCount, 0),
    lastTriggeredAtMs: normalizePositiveInt(record.lastTriggeredAtMs) || undefined,
    lastSkippedAtMs: normalizePositiveInt(record.lastSkippedAtMs) || undefined,
    lastSkippedReason: normalizeOptionalString(record.lastSkippedReason),
    lastError: normalizeOptionalString(record.lastError)
  };
}

/**
 * 创建默认 session
 */
function createDefaultSession(sessionId: string): HeartbeatSession {
  const now = Date.now();
  return {
    version: SESSION_VERSION,
    sessionId,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    triggerCount: 0
  };
}

/**
 * 获取状态目录路径
 */
function resolveStateDir(customDir?: string): string {
  const base = customDir || getDefaultStateDir();
  return path.join(base, 'sessions');
}

/**
 * 获取 session 文件路径
 */
function resolveSessionFilePath(sessionId: string, customDir?: string): string {
  const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(resolveStateDir(customDir), `${safeName}.json`);
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 读取 JSON 文件
 */
function readJsonFile(filePath: string): unknown {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 写入 JSON 文件
 */
function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * 加载 session 状态
 * 唯一真源：所有 session 加载
 */
export function loadSession(sessionId: string, options?: { stateDir?: string }): HeartbeatSession | null {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return null;
  }
  
  const filePath = resolveSessionFilePath(id, options?.stateDir);
  const raw = readJsonFile(filePath);
  
  if (!raw) {
    return null;
  }
  
  return coerceSession(raw, id);
}

/**
 * 保存 session 状态
 * 唯一真源：所有 session 保存
 */
export function saveSession(session: HeartbeatSession, options?: { stateDir?: string }): void {
  const filePath = resolveSessionFilePath(session.sessionId, options?.stateDir);
  writeJsonFile(filePath, {
    ...session,
    updatedAtMs: Date.now()
  });
}

/**
 * 移除 session 状态
 */
export function removeSession(sessionId: string, options?: { stateDir?: string }): boolean {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    return false;
  }
  
  const filePath = resolveSessionFilePath(id, options?.stateDir);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 列出所有 session
 */
export function listSessions(options?: { stateDir?: string }): HeartbeatSession[] {
  const dir = resolveStateDir(options?.stateDir);
  
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const sessions: HeartbeatSession[] = [];
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = readJsonFile(filePath);
    if (raw) {
      const fallbackId = file.replace(/\.json$/, '');
      sessions.push(coerceSession(raw, fallbackId));
    }
  }
  
  return sessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

/**
 * 列出已启用的 session
 */
export function listEnabledSessions(options?: { stateDir?: string }): HeartbeatSession[] {
  return listSessions(options).filter(s => s.enabled);
}

/**
 * 设置 session 启用状态
 */
export function setSessionEnabled(
  sessionId: string,
  enabled: boolean,
  options?: { stateDir?: string }
): HeartbeatSession | null {
  const session = loadSession(sessionId, options);
  
  if (!session) {
    // 创建新 session
    const newSession = createDefaultSession(sessionId);
    newSession.enabled = enabled;
    saveSession(newSession, options);
    return newSession;
  }
  
  session.enabled = enabled;
  saveSession(session, options);
  return session;
}

/**
 * 更新 session 状态
 */
export function updateSession(
  sessionId: string,
  patch: Partial<HeartbeatSession>,
  options?: { stateDir?: string }
): HeartbeatSession | null {
  const session = loadSession(sessionId, options);
  
  if (!session) {
    const newSession = createDefaultSession(sessionId);
    Object.assign(newSession, patch);
    saveSession(newSession, options);
    return newSession;
  }
  
  Object.assign(session, patch);
  saveSession(session, options);
  return session;
}
