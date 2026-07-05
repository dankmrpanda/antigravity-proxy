import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { needsCompaction, selectMessagesToCompact, buildSummarizationPrompt } from '../src/compaction.js';
import type { OpenAIMessage } from '../src/mapper.js';

describe('Compaction', () => {
  describe('needsCompaction', () => {
    it('returns false when under threshold', () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'hello' },
      ];
      assert.equal(needsCompaction('system', messages, undefined, 128000, 0.8), false);
    });

    it('returns true when over threshold', () => {
      // Create a large message that exceeds 80% of 1000 token window
      const largeContent = 'x'.repeat(4000); // ~1000 tokens
      const messages: OpenAIMessage[] = [
        { role: 'user', content: largeContent },
      ];
      assert.equal(needsCompaction('system', messages, undefined, 1000, 0.8), true);
    });

    it('returns false when compaction disabled', () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'x'.repeat(4000) },
      ];
      assert.equal(needsCompaction('system', messages, undefined, 1000, 0.0), false);
    });
  });

  describe('selectMessagesToCompact', () => {
    it('preserves last N turns', () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'resp1' },
        { role: 'user', content: 'msg2' },
        { role: 'assistant', content: 'resp2' },
        { role: 'user', content: 'msg3' },
      ];
      const { toCompact, toPreserve } = selectMessagesToCompact(messages, 1);
      assert.equal(toCompact.length, 4); // first 4 messages
      assert.equal(toPreserve.length, 1); // last 1 message
    });
  });

  describe('buildSummarizationPrompt', () => {
    it('builds correct prompt', () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ];
      const prompt = buildSummarizationPrompt(messages);
      assert.ok(prompt.includes('hello'));
      assert.ok(prompt.includes('world'));
      assert.ok(prompt.includes('[User]'));
      assert.ok(prompt.includes('[Assistant]'));
    });
  });
});
