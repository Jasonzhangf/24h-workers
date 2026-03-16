/**
 * Config Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveConfig } from '../src/core/config.js';

describe('resolveConfig', () => {
  it('should return default config when no config file exists', () => {
    const config = resolveConfig({ cwd: '/nonexistent' });
    
    assert.strictEqual(config.tickMs, 15 * 60_000);
    assert.strictEqual(config.promptFile, 'HEARTBEAT.md');
    assert.strictEqual(config.proxy.enabled, false);
    assert.strictEqual(config.proxy.anthropicPort, 8081);
    assert.strictEqual(config.proxy.openaiPort, 8082);
    assert.strictEqual(config.proxy.geminiPort, 8083);
    assert.deepStrictEqual(config.finishReason.triggerOn, ['stop']);
  });
  
  it('should parse custom config file', () => {
    const config = resolveConfig({ 
      cwd: process.cwd() 
    });
    
    assert.strictEqual(config.tickMs, 900000);
  });
  
  it('should override with env vars', () => {
    process.env.HB_TICK_MS = '30000';
    try {
      const config = resolveConfig({ cwd: '/nonexistent' });
      assert.strictEqual(config.tickMs, 30000);
    } finally {
      delete process.env.HB_TICK_MS;
    }
  });
});
