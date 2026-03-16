/**
 * Proxy Request Handler
 * 处理代理请求转发
 */

import type { Protocol, ProxyRequest, ProxyResponse } from './types.js';
import { extractFinishReason, detectProtocol } from './finish-reason.js';
import type { HeartbeatConfig } from '../core/config.js';
import { triggerOnce } from '../core/daemon.js';

export interface ProxyHandlerContext {
  config: HeartbeatConfig;
  upstreamBase: string;
}

/**
 * 构建上游 URL
 */
function buildUpstreamUrl(
  upstreamBase: string,
  path: string,
  query?: Record<string, string>
): string {
  const url = new URL(path, upstreamBase);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

/**
 * 提取会话 ID
 * 从请求头或查询参数中获取 tmux session id
 */
function extractSessionId(request: ProxyRequest): string | undefined {
  // Try headers
  const sessionId = request.headers['x-heartbeat-session'] 
    || request.headers['x-tmux-session'];
  if (sessionId) return sessionId;
  
  // Try query params (if body contains them)
  const body = asRecord(request.body);
  return body?.tmuxSessionId as string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 转发请求到上游
 */
async function forwardRequest(
  upstreamUrl: string,
  request: ProxyRequest
): Promise<Response> {
  const headers = new Headers();
  
  // Copy headers (exclude some hop-by-hop headers)
  for (const [key, value] of Object.entries(request.headers)) {
    if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  
  const fetchOptions: RequestInit = {
    method: request.method,
    headers
  };
  
  if (request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
    headers.set('content-type', 'application/json');
    fetchOptions.body = JSON.stringify(request.body);
  }
  
  return fetch(upstreamUrl, fetchOptions);
}

/**
 * 处理代理请求
 */
export async function handleProxyRequest(
  request: ProxyRequest,
  context: ProxyHandlerContext
): Promise<ProxyResponse & { shouldTriggerHeartbeat?: boolean }> {
  const upstreamUrl = buildUpstreamUrl(context.upstreamBase, request.path);
  
  // Forward request
  const upstreamResponse = await forwardRequest(upstreamUrl, request);
  
  // Parse response body
  const contentType = upstreamResponse.headers.get('content-type') || '';
  let body: unknown = null;
  
  if (contentType.includes('application/json')) {
    const text = await upstreamResponse.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } else {
    body = await upstreamResponse.text();
  }
  
  // Extract finish reason
  const protocol = detectProtocol(request.path);
  const finishReasonResult = extractFinishReason(
    body,
    protocol,
    context.config.finishReason.triggerOn
  );
  
  // Trigger heartbeat if needed
  let shouldTriggerHeartbeat = false;
  if (finishReasonResult.shouldTrigger) {
    const sessionId = extractSessionId(request);
    if (sessionId) {
      try {
        const result = await triggerOnce(sessionId, context.config);
        shouldTriggerHeartbeat = result.ok;
      } catch {
        // Fail silently
      }
    }
  }
  
  // Build response headers
  const headers: Record<string, string> = {};
  upstreamResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });
  
  return {
    status: upstreamResponse.status,
    headers,
    body,
    shouldTriggerHeartbeat
  };
}
