/**
 * Proxy Types
 * 代理相关类型定义
 */

export type Protocol = 'openai' | 'anthropic' | 'gemini';

export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface FinishReasonResult {
  protocol: Protocol;
  finishReason: string | undefined;
  shouldTrigger: boolean;
}
