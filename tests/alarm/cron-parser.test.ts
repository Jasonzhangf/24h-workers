import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCron, shouldAlarmTrigger, validateCron } from '../../src/alarm/cron-parser.js';
import type { Alarm } from '../../src/alarm/types.js';

describe('cron-parser', () => {
  describe('validateCron', () => {
    it('should accept valid 5-field cron', () => {
      const result = validateCron('0 9 * * 1-5');
      assert.equal(result.valid, true);
    });

    it('should reject invalid cron (too few fields)', () => {
      const result = validateCron('0 9 * *');
      assert.equal(result.valid, false);
      assert.ok(result.error);
    });

    it('should reject invalid cron (too many fields)', () => {
      const result = validateCron('0 9 * * 1-5 2024');
      assert.equal(result.valid, false);
    });

    it('should accept wildcard', () => {
      const result = validateCron('* * * * *');
      assert.equal(result.valid, true);
    });

    it('should accept list syntax', () => {
      const result = validateCron('0 9,18 * * 1,3,5');
      assert.equal(result.valid, true);
    });

    it('should accept step wildcard', () => {
      const result = validateCron('*/5 * * * *');
      assert.equal(result.valid, true);
    });

    it('should accept step range', () => {
      const result = validateCron('1-5/2 9 * * *');
      assert.equal(result.valid, true);
    });
  });

  describe('matchesCron', () => {
    it('should match wildcard at current time', () => {
      const now = new Date();
      assert.equal(matchesCron('* * * * *', now), true);
    });

    it('should not match when hour is wrong', () => {
      const date = new Date(2026, 2, 18, 10, 0, 0); // 10:00
      assert.equal(matchesCron('0 9 * * *', date), false);
    });

    it('should match when hour is correct', () => {
      const date = new Date(2026, 2, 18, 9, 0, 0); // 9:00
      assert.equal(matchesCron('0 9 * * *', date), true);
    });

    it('should match day-of-week range', () => {
      // 2026-03-18 is Wednesday (day 3)
      const date = new Date(2026, 2, 18, 9, 0, 0);
      assert.equal(matchesCron('0 9 * * 1-5', date), true);
    });

    it('should not match day-of-week outside range', () => {
      // 2026-03-22 is Sunday (day 0)
      const date = new Date(2026, 2, 22, 9, 0, 0);
      assert.equal(matchesCron('0 9 * * 1-5', date), false);
    });

    it('should match list syntax', () => {
      const date = new Date(2026, 2, 18, 18, 0, 0); // 18:00 Wednesday
      assert.equal(matchesCron('0 9,18 * * 1,3,5', date), true);
    });

    it('should match step wildcard */5 for minute', () => {
      const dates = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
      for (const min of dates) {
        const date = new Date(2026, 2, 18, 9, min, 0);
        assert.equal(matchesCron('*/5 9 * * *', date), true, 'minute=' + min + ' should match');
      }
      const date = new Date(2026, 2, 18, 9, 3, 0);
      assert.equal(matchesCron('*/5 9 * * *', date), false);
    });

    it('should match range with step 1-30/2', () => {
      const date = new Date(2026, 2, 18, 9, 15, 0);
      assert.equal(matchesCron('1-30/2 9 * * *', date), true);
      const date2 = new Date(2026, 2, 18, 9, 14, 0);
      assert.equal(matchesCron('1-30/2 9 * * *', date2), false);
    });
  });

  describe('shouldAlarmTrigger', () => {
    it('should not trigger disabled alarm', () => {
      const alarm: Alarm = {
        id: 'test',
        cron: '* * * * *',
        once: false,
        project: 'test',
        createdAtMs: Date.now(),
        triggerCount: 0,
        enabled: false,
      };
      assert.equal(shouldAlarmTrigger(alarm), false);
    });

    it('should trigger for the first time', () => {
      const alarm: Alarm = {
        id: 'test',
        cron: '* * * * *',
        once: false,
        project: 'test',
        createdAtMs: Date.now(),
        triggerCount: 0,
        enabled: true,
      };
      assert.equal(shouldAlarmTrigger(alarm), true);
    });

    it('should not trigger if already triggered in same minute', () => {
      const now = new Date();
      const alarm: Alarm = {
        id: 'test',
        cron: '* * * * *',
        once: false,
        project: 'test',
        createdAtMs: Date.now(),
        lastTriggeredAtMs: now.getTime(),
        triggerCount: 1,
        enabled: true,
      };
      assert.equal(shouldAlarmTrigger(alarm), false);
    });

    it('should trigger again in next minute', () => {
      const lastTrigger = new Date();
      lastTrigger.setMinutes(lastTrigger.getMinutes() - 1);
      const alarm: Alarm = {
        id: 'test',
        cron: '* * * * *',
        once: false,
        project: 'test',
        createdAtMs: Date.now(),
        lastTriggeredAtMs: lastTrigger.getTime(),
        triggerCount: 1,
        enabled: true,
      };
      assert.equal(shouldAlarmTrigger(alarm), true);
    });

    it('should not trigger if cron does not match', () => {
      const alarm: Alarm = {
        id: 'test',
        cron: '0 9 * * *', // 9:00
        once: false,
        project: 'test',
        createdAtMs: Date.now(),
        triggerCount: 0,
        enabled: true,
      };
      assert.equal(shouldAlarmTrigger(alarm), false);
    });
  });
});
