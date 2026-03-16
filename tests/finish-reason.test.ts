/**
 * Finish Reason Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractFinishReason, detectProtocol } from '../src/proxy/finish-reason.js';

describe('detectProtocol', () => {
  it('should detect OpenAI Chat Completions', () => {
    assert.strictEqual(detectProtocol('/v1/chat/completions'), 'openai');
  });
  
  it('should detect OpenAI Responses API', () => {
    assert.strictEqual(detectProtocol('/v1/responses'), 'openai');
  });
  
  it('should detect Anthropic Messages', () => {
    assert.strictEqual(detectProtocol('/v1/messages'), 'anthropic');
  });
  
  it('should detect Gemini', () => {
    assert.strictEqual(detectProtocol('/v1beta/models/gemini-pro:generateContent'), 'gemini');
  });
  
  it('should default to openai for unknown paths', () => {
    assert.strictEqual(detectProtocol('/unknown'), 'openai');
  });
});

describe('extractFinishReason', () => {
  describe('OpenAI Chat Completions', () => {
    it('should extract stop finish_reason', () => {
      const body = {
        choices: [{ finish_reason: 'stop', message: { content: 'Hello' } }]
      };
      
      const result = extractFinishReason(body, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, 'stop');
      assert.strictEqual(result.shouldTrigger, true);
    });
    
    it('should extract tool_calls finish_reason', () => {
      const body = {
        choices: [{ finish_reason: 'tool_calls', message: {} }]
      };
      
      const result = extractFinishReason(body, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, 'tool_calls');
      assert.strictEqual(result.shouldTrigger, false);
    });
    
    it('should extract length finish_reason', () => {
      const body = {
        choices: [{ finish_reason: 'length', message: {} }]
      };
      
      const result = extractFinishReason(body, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, 'length');
      assert.strictEqual(result.shouldTrigger, false);
    });
  });
  
  describe('OpenAI Responses API', () => {
    it('should detect completed status as stop', () => {
      const body = {
        status: 'completed',
        output: [{ type: 'message', content: 'Hello' }]
      };
      
      const result = extractFinishReason(body, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, 'stop');
      assert.strictEqual(result.shouldTrigger, true);
    });
    
    it('should detect requires_action as tool_calls', () => {
      const body = {
        status: 'requires_action',
        required_action: { type: 'submit_tool_outputs' }
      };
      
      const result = extractFinishReason(body, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, 'tool_calls');
    });
  });
  
  describe('Anthropic', () => {
    it('should extract end_turn as stop', () => {
      const body = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello' }]
      };
      
      const result = extractFinishReason(body, 'anthropic', ['stop']);
      
      assert.strictEqual(result.finishReason, 'stop');
      assert.strictEqual(result.shouldTrigger, true);
    });
    
    it('should extract tool_use as tool_calls', () => {
      const body = {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'test' }]
      };
      
      const result = extractFinishReason(body, 'anthropic', ['stop']);
      
      assert.strictEqual(result.finishReason, 'tool_calls');
    });
    
    it('should extract max_tokens as length', () => {
      const body = {
        stop_reason: 'max_tokens'
      };
      
      const result = extractFinishReason(body, 'anthropic', ['stop']);
      
      assert.strictEqual(result.finishReason, 'length');
    });
  });
  
  describe('Gemini', () => {
    it('should extract STOP as stop', () => {
      const body = {
        candidates: [{ finishReason: 'STOP' }]
      };
      
      const result = extractFinishReason(body, 'gemini', ['stop']);
      
      assert.strictEqual(result.finishReason, 'stop');
      assert.strictEqual(result.shouldTrigger, true);
    });
    
    it('should extract SAFETY as content_filter', () => {
      const body = {
        candidates: [{ finishReason: 'SAFETY' }]
      };
      
      const result = extractFinishReason(body, 'gemini', ['stop']);
      
      assert.strictEqual(result.finishReason, 'content_filter');
    });
    
    it('should extract MAX_TOKENS as stop', () => {
      const body = {
        candidates: [{ finishReason: 'MAX_TOKENS' }]
      };
      
      const result = extractFinishReason(body, 'gemini', ['stop']);
      
      assert.strictEqual(result.finishReason, 'stop');
    });
  });
  
  describe('Edge cases', () => {
    it('should return undefined for null body', () => {
      const result = extractFinishReason(null, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, undefined);
      assert.strictEqual(result.shouldTrigger, false);
    });
    
    it('should return undefined for empty body', () => {
      const result = extractFinishReason({}, 'openai', ['stop']);
      
      assert.strictEqual(result.finishReason, undefined);
      assert.strictEqual(result.shouldTrigger, false);
    });
  });
});
