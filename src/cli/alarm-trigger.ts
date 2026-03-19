/**
 * Alarm Trigger Logic
 * 闹钟触发逻辑（读取 CLOCK.md 并注入到 tmux）
 * 
 * 注入方式与心跳一致：send-keys + Enter
 * CLOCK.md 的内容会作为用户输入发送到 tmux pane
 * 模型收到输入后会开始处理
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { injectTmuxText } from '../tmux/injector.js';
import { buildTimeTagLine } from '../clock/time-tag.js';
import { updateAlarm, removeAlarm } from '../alarm/store.js';
import type { Alarm } from '../alarm/types.js';

/**
 * 读取配置文件获取项目路径
 */
function getProjectPath(projectName: string): string | null {
  try {
    const configPath = path.join(os.homedir(), '.drudge', 'config.json');
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as { projects: { path: string }[] };

    const project = config.projects.find(p => path.basename(p.path) === projectName);
    return project?.path || null;
  } catch {
    return null;
  }
}

/**
 * 触发闹钟
 * 
 * 注入流程与心跳 triggerHeartbeat 一致：
 * 1. 读取项目根目录下的 .drudge/CLOCK.md
 * 2. 加上时间标签前缀
 * 3. 通过 tmux send-keys 发送到 pane 并按 Enter
 */
export async function triggerAlarm(alarm: Alarm): Promise<{ ok: boolean; error?: string }> {
  // 获取项目路径
  const projectPath = getProjectPath(alarm.project);
  if (!projectPath) {
    return { ok: false, error: `Project "${alarm.project}" not found in config` };
  }

  // 读取 CLOCK.md
  const clockPath = path.join(projectPath, '.drudge', 'CLOCK.md');
  if (!fs.existsSync(clockPath)) {
    return { ok: false, error: `CLOCK.md not found at ${clockPath}` };
  }

  let prompt: string;
  try {
    prompt = fs.readFileSync(clockPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `Failed to read CLOCK.md: ${error}` };
  }

  // 如果有附加消息，追加到 prompt
  if (alarm.message) {
    prompt = `${prompt}\n\n${alarm.message}`;
  }

  // 构建注入文本 — 与心跳格式一致：时间标签 + 提示内容
  const timeTag = buildTimeTagLine();
  const injectText = `${timeTag}\n\n${prompt}`;

  // 注入到 tmux（submit: true 发送 Enter，让模型收到输入开始处理）
  const result = await injectTmuxText({
    sessionId: alarm.project,
    text: injectText,
    submit: true
  });

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  // 更新闹钟状态
  const now = Date.now();
  if (alarm.once) {
    // 单次触发，自动删除
    removeAlarm(alarm.id);
  } else {
    updateAlarm(alarm.id, {
      lastTriggeredAtMs: now,
      triggerCount: alarm.triggerCount + 1,
    });
  }

  return { ok: true };
}
