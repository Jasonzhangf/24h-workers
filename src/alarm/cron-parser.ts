/**
 * Cron Parser (via cron-parser library)
 */

import type { Alarm } from './types.js';
import cronParser from 'cron-parser';

/**
 * Validate a cron expression
 */
export function validateCron(cron: string): { valid: boolean; error?: string } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length != 5) {
    return { valid: false, error: 'Invalid cron expression. Expected 5 fields: minute hour day-of-month month day-of-week' };
  }
  try {
    cronParser.parseExpression(cron);
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: message || 'Invalid cron expression' };
  }
}

/**
 * Check if a date matches a cron expression
 * 
 * Implementation: compute the next schedule after (date - 1 minute)
 * and see if it lands exactly on the same minute.
 */
export function matchesCron(cron: string, date: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length != 5) {
    return false;
  }
  try {
    const target = new Date(date);
    target.setSeconds(0, 0);

    const prev = new Date(target);
    prev.setMinutes(prev.getMinutes() - 1);

    const interval = cronParser.parseExpression(cron, {
      currentDate: prev
    });

    const next = interval.next().toDate();
    next.setSeconds(0, 0);

    return next.getTime() === target.getTime();
  } catch {
    return false;
  }
}

/**
 * Check if an alarm should trigger now
 */
export function shouldAlarmTrigger(alarm: Alarm): boolean {
  if (!alarm.enabled) {
    return false;
  }

  const now = new Date();

  if (!matchesCron(alarm.cron, now)) {
    return false;
  }

  if (alarm.lastTriggeredAtMs) {
    const lastTrigger = new Date(alarm.lastTriggeredAtMs);
    const sameMinute =
      lastTrigger.getFullYear() === now.getFullYear() &&
      lastTrigger.getMonth() === now.getMonth() &&
      lastTrigger.getDate() === now.getDate() &&
      lastTrigger.getHours() === now.getHours() &&
      lastTrigger.getMinutes() === now.getMinutes();

    if (sameMinute) {
      return false;
    }
  }

  return true;
}

/**
 * Get next trigger time for a cron expression
 */
export function getNextTriggerTime(cron: string, from: Date = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length != 5) {
    return null;
  }
  try {
    const interval = cronParser.parseExpression(cron, {
      currentDate: from
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}
