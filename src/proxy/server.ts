/**
 * HTTP Proxy Server
 * HTTP 代理服务器，支持三大协议
 */

import http from 'node:http';
import type { HeartbeatConfig } from '../core/config.js';
import { handleProxyRequest } from './request-handler.js';

export interface ProxyServerOptions {
  config: HeartbeatConfig;
  anthropicUpstream?: string;
  openaiUpstream?: string;
  geminiUpstream?: string;
}

interface ActiveServer {
  server: http.Server;
  port: number;
  protocol: string;
  upstream: string;
}

const activeServers: ActiveServer[] = [];

/**
 * 解析请求体
 */
async function parseRequestBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      
      if (!body) {
        resolve(null);
        return;
      }
      
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(body);
      }
    });
    
    req.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * 提取请求头
 */
function extractHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    }
  }
  
  return headers;
}

/**
 * 创建单个代理服务器
 */
function createProxyServer(
  protocol: string,
  upstream: string,
  config: HeartbeatConfig
): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const body = await parseRequestBody(req);
      const headers = extractHeaders(req);
      
      const result = await handleProxyRequest(
        {
          method: req.method || 'GET',
          path: req.url || '/',
          headers,
          body
        },
        {
          config,
          upstreamBase: upstream
        }
      );
      
      // Set response headers
      for (const [key, value] of Object.entries(result.headers)) {
        if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
      
      res.statusCode = result.status;
      
      if (result.body && typeof result.body === 'object') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result.body));
      } else {
        res.end(result.body ? String(result.body) : '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    }
  });
}

/**
 * 启动所有代理服务器
 */
export async function startProxyServers(
  options: ProxyServerOptions
): Promise<void> {
  const { config } = options;
  
  const proxy = config.proxy;
  if (!proxy || !proxy.enabled) {
    console.log('[Proxy] Proxy disabled in config');
    return;
  }
  
  const anthropicPort = proxy.anthropicPort || 8081;
  const openaiPort = proxy.openaiPort || 8082;
  const geminiPort = proxy.geminiPort || 8083;

  const servers: Array<{
    protocol: string;
    port: number;
    upstream: string;
  }> = [
    {
      protocol: 'anthropic',
      port: anthropicPort,
      upstream: options.anthropicUpstream || 'https://api.anthropic.com'
    },
    {
      protocol: 'openai',
      port: openaiPort,
      upstream: options.openaiUpstream || 'https://api.openai.com'
    },
    {
      protocol: 'gemini',
      port: geminiPort,
      upstream: options.geminiUpstream || 'https://generativelanguage.googleapis.com'
    }
  ];
  
  for (const { protocol, port, upstream } of servers) {
    const server = createProxyServer(protocol, upstream, config);
    
    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        console.log(`[Proxy] ${protocol} proxy listening on port ${port} -> ${upstream}`);
        resolve();
      });
    });
    
    activeServers.push({ server, port, protocol, upstream });
  }
}

/**
 * 停止所有代理服务器
 */
export async function stopProxyServers(): Promise<void> {
  for (const { server, protocol, port } of activeServers) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log(`[Proxy] ${protocol} proxy stopped on port ${port}`);
        resolve();
      });
    });
  }
  
  activeServers.length = 0;
}

/**
 * 获取活跃服务器信息
 */
export function getActiveServers(): Array<{
  protocol: string;
  port: number;
  upstream: string;
}> {
  return activeServers.map(({ protocol, port, upstream }) => ({
    protocol,
    port,
    upstream
  }));
}
