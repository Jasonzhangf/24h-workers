/**
 * Config Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveConfig, getHeartbeatInterval } from '../src/core/config.js';

describe('resolveConfig', () => {
  it('should return default config when no config file exists', () => {
    const config = resolveConfig({ cwd: '/nonexistent' });
    
    assert.strictEqual(config.tickMs, 15 * 60_000);
    assert.ok(config.promptFile.includes('.drudge'));
    assert.strictEqual(config.proxy?.enabled, false);
    assert.deepStrictEqual(config.finishReason?.triggerOn, ['stop']);
  });
  
  it('should return default interval for unknown path', () => {
    // 路径不在配置中，应该返回默认值
    const interval = getHeartbeatInterval('/nonexistent/path');
    assert.strictEqual(interval, 900000); // 默认 15 分钟
  });
  
  it('should override with env vars', () => {
    process.env.DRUDGE_HEARTBEAT_INTERVAL = '30000';
    try {
      const interval = getHeartbeatInterval('/nonexistent');
      assert.strictEqual(interval, 30000);
    } finally {
      delete process.env.DRUDGE_HEARTBEAT_INTERVAL;
    }
  });
});
