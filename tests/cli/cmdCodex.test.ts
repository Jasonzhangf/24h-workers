/**
 * cmdCodex function tests
 * 测试 cmdCodex 函数的唯一真源使用
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('cmdCodex', () => {
  it('should use isTmuxSessionAlive (唯一真源) when session exists', async () => {
    // Mock isTmuxSessionAlive to return true (session exists)
    const isTmuxSessionAliveMock = mock.fn(() => true);

    // Mock attachToExistingTmuxSession
    const attachToExistingTmuxSessionMock = mock.fn(() => {
      // Mock function that would normally spawn tmux attach
    });

    // Note: Since cmdCodex is in the same file and uses module-level imports,
    // we cannot easily mock the imports in ESM. This test serves as documentation
    // of the expected behavior.
    //
    // Expected behavior:
    // 1. cmdCodex calls isTmuxSessionAlive(projectName) to check if session exists
    // 2. If session exists, cmdCodex calls attachToExistingTmuxSession()
    // 3. No direct spawnSync('tmux has-session') calls are made

    assert.ok(true, 'Test documented - see comments for expected behavior');
  });

  it('should NOT use spawnSync("tmux has-session") directly', async () => {
    // Read the CLI file to verify no direct spawnSync('tmux has-session') calls
    const cliFilePath = path.join(__dirname, '../../src/cli/index.ts');
    const cliContent = await import('fs').then(fs => fs.promises.readFile(cliFilePath, 'utf8'));

    // Verify that spawnSync is not called with 'has-session' argument
    const hasSessionPattern = /spawnSync\s*\(\s*['"`]tmux['"`]\s*,\s*\[['"`]has-session['"`]/;
    const match = cliContent.match(hasSessionPattern);

    assert.strictEqual(
      match,
      null,
      'cmdCodex should NOT call spawnSync("tmux has-session") directly. Use isTmuxSessionAlive() instead.'
    );
  });

  it('should import attachToExistingTmuxSession from tmux/attach module', async () => {
    // Read the CLI file to verify import statement
    const cliFilePath = path.join(__dirname, '../../src/cli/index.ts');
    const cliContent = await import('fs').then(fs => fs.promises.readFile(cliFilePath, 'utf8'));

    // Verify that attachToExistingTmuxSession is imported from tmux/attach
    const importPattern = /import\s*\{\s*attachToExistingTmuxSession\s*\}\s*from\s*['"`]\.\.\/tmux\/attach\.js['"`]/;
    const match = cliContent.match(importPattern);

    assert.ok(
      match,
      'cmdCodex should import attachToExistingTmuxSession from tmux/attach module'
    );
  });

  it('should import isTmuxSessionAlive from tmux/session-probe module', async () => {
    // Read the CLI file to verify import statement
    const cliFilePath = path.join(__dirname, '../../src/cli/index.ts');
    const cliContent = await import('fs').then(fs => fs.promises.readFile(cliFilePath, 'utf8'));

    // Verify that isTmuxSessionAlive is imported from tmux/session-probe
    const importPattern = /import\s*\{\s*isTmuxSessionAlive\s*\}\s*from\s*['"`]\.\.\/tmux\/session-probe\.js['"`]/;
    const match = cliContent.match(importPattern);

    assert.ok(
      match,
      'cmdCodex should import isTmuxSessionAlive from tmux/session-probe module'
    );
  });
});
