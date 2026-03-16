/**
 * Finish Reason Extractor
 * 从三种协议响应中提取 finish_reason
 * 唯一真源：所有 finish_reason 提取
 */

import type { Protocol, FinishReasonResult } from './types.js';

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * 从 OpenAI Chat Completions 响应提取 finish_reason
 */
function extractOpenAIFinishReason(body: RecordLike): string | undefined {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = asRecord(choices[0]);
  return readString(firstChoice?.finish_reason);
}

/**
 * 从 OpenAI Responses API 响应提取 finish_reason
 */
function extractResponsesFinishReason(body: RecordLike): string | undefined {
  // Responses API: status field
  const status = readString(body.status)?.toLowerCase();
  if (status === 'completed') return 'stop';
  if (status === 'requires_action') return 'tool_calls';
  
  // Responses API: output array
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const type = readString(itemRecord?.type)?.toLowerCase();
    if (type === 'function_call' || type === 'tool_call') {
      return 'tool_calls';
    }
  }
  
  // Incomplete details
  const incomplete = asRecord(body.incomplete_details);
  const incompleteReason = readString(incomplete?.reason);
  if (incompleteReason) {
    const normalized = incompleteReason.toLowerCase();
    if (normalized === 'max_output_tokens' || normalized === 'max_tokens') {
      return 'length';
    }
    return normalized;
  }
  
  return undefined;
}

/**
 * 从 Anthropic Messages 响应提取 finish_reason
 */
function extractAnthropicFinishReason(body: RecordLike): string | undefined {
  const stopReason = readString(body.stop_reason);
  if (!stopReason) return undefined;
  
  const normalized = stopReason.toLowerCase().trim();
  
  switch (normalized) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    default:
      return normalized;
  }
}

/**
 * 从 Gemini 响应提取 finish_reason
 */
function extractGeminiFinishReason(body: RecordLike): string | undefined {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const firstCandidate = asRecord(candidates[0]);
  
  // Gemini: finishReason field
  const finishReason = readString(firstCandidate?.finishReason);
  if (finishReason) {
    const normalized = finishReason.toUpperCase();
    switch (normalized) {
      case 'STOP':
      case 'MAX_TOKENS':
        return 'stop';
      case 'SAFETY':
        return 'content_filter';
      case 'RECITATION':
        return 'recitation';
      case 'OTHER':
        return 'other';
      default:
        return normalized.toLowerCase();
    }
  }
  
  // Gemini: stop_reason field (some versions)
  const stopReason = readString(body.stop_reason);
  if (stopReason) {
    const normalized = stopReason.toLowerCase();
    if (normalized === 'end_turn') return 'stop';
    if (normalized === 'tool_use') return 'tool_calls';
    return normalized;
  }
  
  return undefined;
}

/**
 * 检测响应协议
 */
export function detectProtocol(path: string): Protocol {
  const lowered = path.toLowerCase();
  
  if (lowered.includes('/v1/responses')) {
    return 'openai'; // Responses API is still OpenAI protocol
  }
  if (lowered.includes('/v1/chat/completions')) {
    return 'openai';
  }
  if (lowered.includes('/v1/messages')) {
    return 'anthropic';
  }
  if (lowered.includes('/v1beta/') || lowered.includes('/v1p') || lowered.includes('generateContent')) {
    return 'gemini';
  }
  
  // Default to OpenAI
  return 'openai';
}

/**
 * 提取 finish_reason
 * 唯一真源：所有 finish_reason 提取
 */
export function extractFinishReason(
  body: unknown,
  protocol: Protocol,
  triggerOn: string[] = ['stop']
): FinishReasonResult {
  const record = asRecord(body);
  
  if (!record) {
    return { protocol, finishReason: undefined, shouldTrigger: false };
  }
  
  let finishReason: string | undefined;
  
  switch (protocol) {
    case 'openai':
      // Try both Chat Completions and Responses API
      finishReason = extractOpenAIFinishReason(record) || extractResponsesFinishReason(record);
      break;
    case 'anthropic':
      finishReason = extractAnthropicFinishReason(record);
      break;
    case 'gemini':
      finishReason = extractGeminiFinishReason(record);
      break;
  }
  
  const shouldTrigger = finishReason 
    ? triggerOn.includes(finishReason) 
    : false;
  
  return { protocol, finishReason, shouldTrigger };
}
