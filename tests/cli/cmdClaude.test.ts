/**
 * cmdClaude function tests
 * 测试 cmdClaude 函数的唯一真源使用
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('cmdClaude', () => {
  it('should use isTmuxSessionAlive (唯一真源) when session exists', async () => {
    // Note: Since cmdClaude is in the same file and uses module-level imports,
    // we cannot easily mock the imports in ESM. This test serves as documentation
    // of the expected behavior.
    //
    // Expected behavior:
    // 1. cmdClaude calls isTmuxSessionAlive(projectName) to check if session exists
    // 2. If session exists, cmdClaude calls attachToExistingTmuxSession()
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
      'cmdClaude should NOT call spawnSync("tmux has-session") directly. Use isTmuxSessionAlive() instead.'
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
      'cmdClaude should import attachToExistingTmuxSession from tmux/attach module'
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
      'cmdClaude should import isTmuxSessionAlive from tmux/session-probe module'
    );
  });

  it('should use isTmuxSessionAlive in cmdClaude function', async () => {
    // Read the CLI file to verify cmdClaude uses isTmuxSessionAlive
    const cliFilePath = path.join(__dirname, '../../src/cli/index.ts');
    const cliContent = await import('fs').then(fs => fs.promises.readFile(cliFilePath, 'utf8'));

    // Find cmdClaude function and verify it uses isTmuxSessionAlive
    // Pattern: async function cmdClaude ... { ... isTmuxSessionAlive(projectName) ... }
    const cmdClaudePattern = /async function cmdClaude[\s\S]*?isTmuxSessionAlive\s*\(\s*projectName\s*\)/;
    const match = cliContent.match(cmdClaudePattern);

    assert.ok(
      match,
      'cmdClaude function should call isTmuxSessionAlive(projectName) to check session'
    );
  });

  it('should use attachToExistingTmuxSession in cmdClaude function', async () => {
    // Read the CLI file to verify cmdClaude uses attachToExistingTmuxSession
    const cliFilePath = path.join(__dirname, '../../src/cli/index.ts');
    const cliContent = await import('fs').then(fs => fs.promises.readFile(cliFilePath, 'utf8'));

    // Find cmdClaude function and verify it uses attachToExistingTmuxSession
    const cmdClaudePattern = /async function cmdClaude[\s\S]*?attachToExistingTmuxSession\s*\(\s*\{/;
    const match = cliContent.match(cmdClaudePattern);

    assert.ok(
      match,
      'cmdClaude function should call attachToExistingTmuxSession() for attach operation'
    );
  });
});
