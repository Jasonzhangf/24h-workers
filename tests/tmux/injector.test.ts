/**
 * TMUX Injector Integration Test
 * 独立 tmux session 注入测试（不影响生产 session）
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { injectTmuxText } from '../../src/tmux/injector.js';
import { isTmuxAvailable } from '../../src/tmux/session-probe.js';

describe('tmux injector', () => {
  it('should inject text into isolated tmux session', async (t) => {
    if (!isTmuxAvailable()) {
      t.skip('tmux not available');
      return;
    }

    const sessionName = `drudge-inject-test-${Date.now()}`;
    const tmuxTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drudge-tmux-'));
    const previousTmuxTmpDir = process.env.TMUX_TMPDIR;
    process.env.TMUX_TMPDIR = tmuxTmpDir;
    const tmuxEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir };

    const create = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', '/tmp', 'cat'], { encoding: 'utf8', env: tmuxEnv });
    if (create.status !== 0) {
      process.env.TMUX_TMPDIR = previousTmuxTmpDir;
      fs.rmSync(tmuxTmpDir, { recursive: true });
      t.skip(`tmux new-session failed: ${create.stderr || create.stdout || 'unknown error'}`);
      return;
    }

    try {
      const text = `DRUDGE_INJECT_TEST_${Date.now()}`;
      const result = await injectTmuxText({
        sessionId: sessionName,
        text,
        submit: true
      });

      assert.strictEqual(result.ok, true, result.reason || 'inject failed');

      // Allow tmux pane to render the injected text
      await new Promise(resolve => setTimeout(resolve, 120));

      const capture = spawnSync('tmux', ['capture-pane', '-t', sessionName, '-p'], { encoding: 'utf8', env: tmuxEnv });
      assert.strictEqual(capture.status, 0, capture.stderr || 'capture failed');
      const output = String(capture.stdout || '');
      assert.ok(output.includes(text), `expected pane output to include "${text}"`);
    } finally {
      spawnSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8', env: tmuxEnv });
      process.env.TMUX_TMPDIR = previousTmuxTmpDir;
      fs.rmSync(tmuxTmpDir, { recursive: true });
    }
  });
});
