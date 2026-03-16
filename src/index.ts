/**
 * Drudge Library Entry
 */

// Core
export { resolveConfig, getDefaultStateDir } from './core/config.js';
export { 
  startDaemon, 
  stopDaemon, 
  isDaemonRunning, 
  triggerOnce 
} from './core/daemon.js';
export {
  loadSession,
  saveSession,
  removeSession,
  listSessions,
  listEnabledSessions,
  setSessionEnabled,
  updateSession
} from './core/state-store.js';
export {
  triggerHeartbeat,
  shouldTrigger,
  readHeartbeatPrompt
} from './core/trigger.js';

// TMUX
export {
  isTmuxSessionAlive,
  resolveTmuxWorkingDirectory,
  normalizeTmuxSessionTarget,
  resolveTmuxInjectionTarget
} from './tmux/session-probe.js';
export {
  injectTmuxText
} from './tmux/injector.js';

// Clock
export {
  buildTimeTag,
  formatTimeTag,
  buildTimeTagLine
} from './clock/time-tag.js';

// Proxy
export {
  startProxyServers,
  stopProxyServers,
  getActiveServers
} from './proxy/server.js';
export {
  extractFinishReason,
  detectProtocol
} from './proxy/finish-reason.js';

// Types
export type { HeartbeatConfig } from './core/config.js';
export type { HeartbeatSession } from './core/state-store.js';
export type { InjectResult } from './tmux/injector.js';
export type { TimeTag } from './clock/time-tag.js';
export type { Protocol, ProxyRequest, ProxyResponse, FinishReasonResult } from './proxy/types.js';
