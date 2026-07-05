import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, estimateMessageTokens, estimateSystemTokens, estimateToolTokens } from '../src/token-estimator.js';
import type { OpenAIMessage } from '../src/mapper.js';

describe('TokenEstimator', () => {
  it('estimates tokens as length/4', () => {
    assert.equal(estimateTokens('hello'), 2); // 5 chars / 4 = 1.25 → ceil = 2
    assert.equal(estimateTokens('1234'), 1);  // 4 chars / 4 = 1
    assert.equal(estimateTokens('12345'), 2); // 5 chars / 4 = 1.25 → ceil = 2
  });

  it('returns at least 1 for empty string', () => {
    assert.equal(estimateTokens(''), 1);
  });

  it('estimates system prompt tokens', () => {
    const system = 'You are a helpful assistant. '.repeat(100);
    const tokens = estimateSystemTokens(system);
    assert.ok(tokens > 0);
    assert.equal(tokens, Math.ceil(system.length / 4));
  });

  it('estimates system tokens as 0 for empty string', () => {
    assert.equal(estimateSystemTokens(''), 0);
    assert.equal(estimateSystemTokens(undefined as any), 0);
  });

  it('estimates message tokens including role overhead', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    const tokens = estimateMessageTokens(messages);
    assert.ok(tokens > 0);
    // Each message has role overhead (~4 tokens) + content
    assert.ok(tokens >= estimateTokens('hello') + estimateTokens('world'));
  });

  it('handles null content in messages', () => {
    const messages: OpenAIMessage[] = [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } }] },
    ];
    const tokens = estimateMessageTokens(messages);
    assert.ok(tokens > 0);
  });

  it('handles array content parts', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'http://example.com/img.png' } }] },
    ];
    const tokens = estimateMessageTokens(messages);
    assert.ok(tokens > 0);
  });

  it('estimates tool tokens', () => {
    const tools = {
      view_file: { description: 'View file contents', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    };
    const tokens = estimateToolTokens(tools);
    assert.ok(tokens > 0);
    assert.equal(tokens, estimateTokens(JSON.stringify(tools)));
  });

  it('returns 0 for undefined tools', () => {
    assert.equal(estimateToolTokens(undefined), 0);
  });
});
