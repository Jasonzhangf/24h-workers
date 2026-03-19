import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

// Use a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), `drudge-alarm-test-${Date.now()}`);

describe('alarm store', () => {
  beforeEach(async () => {
    // We test the store logic by importing after setting env
    // Since store uses hardcoded path, we test the logic indirectly
  });

  it('should export CRUD functions', async () => {
    const store = await import('../../src/alarm/store.js');
    assert.equal(typeof store.listAlarms, 'function');
    assert.equal(typeof store.getAlarm, 'function');
    assert.equal(typeof store.addAlarm, 'function');
    assert.equal(typeof store.removeAlarm, 'function');
    assert.equal(typeof store.updateAlarm, 'function');
  });

  it('should add and list alarms', async () => {
    const { addAlarm, listAlarms, removeAlarm } = await import('../../src/alarm/store.js');

    const alarm = {
      id: `test-${Date.now()}`,
      cron: '0 9 * * *',
      once: false,
      project: 'test-project',
      createdAtMs: Date.now(),
      triggerCount: 0,
      enabled: true,
    };

    addAlarm(alarm);
    const list = listAlarms();
    assert.ok(list.some(a => a.id === alarm.id));

    // Cleanup
    removeAlarm(alarm.id);
  });

  it('should overwrite alarm with same ID', async () => {
    const { addAlarm, getAlarm, removeAlarm } = await import('../../src/alarm/store.js');

    const id = `test-overwrite-${Date.now()}`;
    const alarm1 = {
      id,
      cron: '0 9 * * *',
      once: false,
      project: 'project-a',
      createdAtMs: Date.now(),
      triggerCount: 0,
      enabled: true,
    };

    const alarm2 = {
      id,
      cron: '0 18 * * *',
      once: true,
      project: 'project-b',
      createdAtMs: Date.now(),
      triggerCount: 0,
      enabled: true,
    };

    addAlarm(alarm1);
    addAlarm(alarm2);

    const result = getAlarm(id);
    assert.equal(result?.cron, '0 18 * * *');
    assert.equal(result?.project, 'project-b');
    assert.equal(result?.once, true);

    // Cleanup
    removeAlarm(id);
  });

  it('should remove alarm', async () => {
    const { addAlarm, getAlarm, removeAlarm } = await import('../../src/alarm/store.js');

    const id = `test-remove-${Date.now()}`;
    const alarm = {
      id,
      cron: '0 9 * * *',
      once: false,
      project: 'test',
      createdAtMs: Date.now(),
      triggerCount: 0,
      enabled: true,
    };

    addAlarm(alarm);
    assert.ok(getAlarm(id));

    removeAlarm(id);
    assert.equal(getAlarm(id), null);
  });
});
