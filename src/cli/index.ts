#!/usr/bin/env node
/**
 * Drudge CLI Entry
 */

import { resolveConfig } from '../core/config.js';
import { 
  startDaemon, 
  stopDaemon, 
  isDaemonRunning, 
  triggerOnce 
} from '../core/daemon.js';
import {
  loadSession,
  listSessions,
  setSessionEnabled
} from '../core/state-store.js';
import { isTmuxSessionAlive } from '../tmux/session-probe.js';
import { startProxyServers, stopProxyServers } from '../proxy/server.js';

const VERSION = '0.1.0';

interface CliOptions {
  config?: string;
  session?: string;
  json?: boolean;
  withProxy?: boolean;
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printError(message: string, code?: string): void {
  console.error(`Error: ${message}`);
  if (code) {
    console.error(`Code: ${code}`);
  }
  process.exit(1);
}

async function cmdStart(options: CliOptions): Promise<void> {
  const config = resolveConfig({ configPath: options.config });
  
  if (isDaemonRunning()) {
    console.log('Drudge daemon is already running');
    return;
  }
  
  // Start proxy servers if requested
  if (options.withProxy || config.proxy.enabled) {
    await startProxyServers({ config });
  }
  
  await startDaemon(config);
  console.log('Drudge daemon started');
  
  if (options.json) {
    printJson({ ok: true, tickMs: config.tickMs, proxy: config.proxy.enabled });
  }
}

async function cmdStop(_options: CliOptions): Promise<void> {
  if (!isDaemonRunning()) {
    console.log('Drudge daemon is not running');
    return;
  }
  
  stopDaemon();
  await stopProxyServers();
  console.log('Drudge daemon stopped');
}

async function cmdTrigger(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }
  
  const config = resolveConfig({ configPath: options.config });
  const result = await triggerOnce(sessionId, config);
  
  if (options.json) {
    printJson({ ok: result.ok, reason: result.reason });
    return;
  }
  
  if (result.ok) {
    console.log(`Drudge triggered for session: ${sessionId}`);
  } else {
    printError(result.reason || 'Trigger failed');
  }
}

async function cmdStatus(options: CliOptions): Promise<void> {
  const config = resolveConfig({ configPath: options.config });
  const running = isDaemonRunning();
  const sessions = listSessions({ stateDir: config.stateDir });
  
  if (options.json) {
    printJson({
      daemon: running,
      tickMs: config.tickMs,
      sessionCount: sessions.length,
      enabledCount: sessions.filter(s => s.enabled).length,
      proxy: config.proxy.enabled
    });
    return;
  }
  
  console.log(`Daemon: ${running ? 'running' : 'stopped'}`);
  console.log(`Tick: ${config.tickMs}ms`);
  console.log(`Proxy: ${config.proxy.enabled ? 'enabled' : 'disabled'}`);
  console.log(`Sessions: ${sessions.length} (${sessions.filter(s => s.enabled).length} enabled)`);
}

async function cmdList(options: CliOptions): Promise<void> {
  const config = resolveConfig({ configPath: options.config });
  const sessions = listSessions({ stateDir: config.stateDir });
  
  if (options.json) {
    printJson(sessions);
    return;
  }
  
  if (sessions.length === 0) {
    console.log('No sessions found');
    return;
  }
  
  for (const session of sessions) {
    const status = session.enabled ? 'enabled' : 'disabled';
    const alive = isTmuxSessionAlive(session.sessionId) ? 'alive' : 'dead';
    const triggers = session.triggerCount;
    console.log(`  ${session.sessionId}: ${status} (${alive}) triggers=${triggers}`);
  }
}

async function cmdOn(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }
  
  const config = resolveConfig({ configPath: options.config });
  const result = setSessionEnabled(sessionId, true, { stateDir: config.stateDir });
  
  if (options.json) {
    printJson({ ok: true, session: result });
    return;
  }
  
  console.log(`Session ${sessionId} enabled`);
}

async function cmdOff(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }
  
  const config = resolveConfig({ configPath: options.config });
  const result = setSessionEnabled(sessionId, false, { stateDir: config.stateDir });
  
  if (options.json) {
    printJson({ ok: true, session: result });
    return;
  }
  
  console.log(`Session ${sessionId} disabled`);
}

async function cmdShow(options: CliOptions): Promise<void> {
  const sessionId = options.session;
  
  if (!sessionId) {
    printError('Session ID required. Use -s <session>');
    return;
  }
  
  const config = resolveConfig({ configPath: options.config });
  const session = loadSession(sessionId, { stateDir: config.stateDir });
  
  if (!session) {
    printError('Session not found', 'not_found');
    return;
  }
  
  const alive = isTmuxSessionAlive(sessionId);
  
  if (options.json) {
    printJson({ ...session, alive });
    return;
  }
  
  console.log(`Session: ${session.sessionId}`);
  console.log(`Status: ${session.enabled ? 'enabled' : 'disabled'}`);
  console.log(`Tmux: ${alive ? 'alive' : 'dead'}`);
  console.log(`Triggers: ${session.triggerCount}`);
  if (session.lastTriggeredAtMs) {
    console.log(`Last trigger: ${new Date(session.lastTriggeredAtMs).toISOString()}`);
  }
  if (session.lastError) {
    console.log(`Last error: ${session.lastError}`);
  }
}

function printHelp(): void {
  console.log(`
Drudge CLI v${VERSION}

Commands:
  start              Start heartbeat daemon
  stop               Stop heartbeat daemon
  trigger -s <id>    Trigger heartbeat for session
  status             Show daemon status
  list               List all sessions
  show -s <id>       Show session details
  on -s <id>         Enable session
  off -s <id>        Disable session

Options:
  -c, --config <path>   Config file path
  -s, --session <id>    Session ID
  --json                Output as JSON
  --with-proxy          Start with proxy server
  -h, --help            Show this help
  -v, --version         Show version
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }
  
  const command = args[0];
  const options: CliOptions = {};
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    
    if (arg === '-v' || arg === '--version') {
      console.log(`drudge v${VERSION}`);
      process.exit(0);
    }
    
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    
    if (arg === '--with-proxy') {
      options.withProxy = true;
      continue;
    }
    
    if (arg === '-c' || arg === '--config') {
      options.config = args[++i];
      continue;
    }
    
    if (arg === '-s' || arg === '--session') {
      options.session = args[++i];
      continue;
    }
  }
  
  try {
    switch (command) {
      case 'start':
        await cmdStart(options);
        break;
      case 'stop':
        await cmdStop(options);
        break;
      case 'trigger':
        await cmdTrigger(options);
        break;
      case 'status':
        await cmdStatus(options);
        break;
      case 'list':
        await cmdList(options);
        break;
      case 'show':
        await cmdShow(options);
        break;
      case 'on':
        await cmdOn(options);
        break;
      case 'off':
        await cmdOff(options);
        break;
      default:
        printHelp();
        process.exit(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(message);
  }
}

main();
