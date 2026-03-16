/**
 * Time Tag Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildTimeTag, formatTimeTag, buildTimeTagLine } from '../src/clock/time-tag.js';

describe('buildTimeTag', () => {
  it('should return time tag with all fields', () => {
    const tag = buildTimeTag();
    
    assert.ok(tag.utc);
    assert.ok(tag.local);
    assert.ok(tag.tz);
    assert.ok(typeof tag.nowMs === 'number');
    assert.ok(tag.nowMs > 0);
  });
  
  it('should return valid ISO date string for utc', () => {
    const tag = buildTimeTag();
    const date = new Date(tag.utc);
    assert.ok(!isNaN(date.getTime()));
  });
});

describe('formatTimeTag', () => {
  it('should format time tag as string', () => {
    const line = formatTimeTag();
    
    assert.ok(line.startsWith('[Time/Date]:'));
    assert.ok(line.includes('utc='));
    assert.ok(line.includes('local='));
    assert.ok(line.includes('tz='));
    assert.ok(line.includes('nowMs='));
  });
});

describe('buildTimeTagLine', () => {
  it('should return formatted time line', () => {
    const line = buildTimeTagLine();
    
    assert.ok(typeof line === 'string');
    assert.ok(line.length > 0);
  });
});
