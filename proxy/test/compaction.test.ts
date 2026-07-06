import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { needsCompaction, selectMessagesToCompact, buildSummarizationPrompt, compactIfNeeded, getCompactionConfig } from '../src/compaction.js';
import type { OpenAIMessage, MappedRequest } from '../src/mapper.js';
import type { Router } from '../src/router.js';
import { loadContextWindowsFromModels, clearContextWindows } from '../src/context-windows.js';

function makeMessages(count: number): OpenAIMessage[] {
  const msgs: OpenAIMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: 'user', content: `user message ${i}` });
    msgs.push({ role: 'assistant', content: `assistant response ${i}` });
  }
  return msgs;
}

function makeMappedRequest(messages: OpenAIMessage[]): MappedRequest {
  return { messages, system: 'system prompt', tools: undefined };
}

function createMockRouter(summaryText: string, shouldError = false): Router {
  const fakeAdapter = {
    stream: async function* () {
      if (shouldError) {
        yield { type: 'error', content: 'mock provider error' };
      } else {
        yield { type: 'text', content: summaryText };
      }
    },
  };

  return {
    adapters: new Map([['openrouter', fakeAdapter as any]]),
    execute: async function* (_providerIds: any, _model: string, messages: OpenAIMessage[]) {
      // Check if the prompt is a summarization request
      const prompt = typeof messages[0]?.content === 'string' ? messages[0].content : '';
      if (prompt.includes('conversation summarizer')) {
        if (shouldError) {
          yield { type: 'error', content: 'mock provider error' };
        } else {
          yield { type: 'text', content: summaryText };
        }
      } else {
        yield { type: 'text', content: 'not a summarization request' };
      }
    },
  } as unknown as Router;
}

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
    it('preserves last N turns (2 messages per turn)', () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'resp1' },
        { role: 'user', content: 'msg2' },
        { role: 'assistant', content: 'resp2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'resp3' },
      ];
      // tailTurns=1 preserves 1 turn = 2 messages (last user+assistant)
      const { toCompact, toPreserve } = selectMessagesToCompact(messages, 1);
      assert.equal(toCompact.length, 4); // first 4 messages
      assert.equal(toPreserve.length, 2); // last 2 messages (1 turn)
    });

    it('preserves all messages when fewer than tailTurns', () => {
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'resp1' },
      ];
      const { toCompact, toPreserve } = selectMessagesToCompact(messages, 2);
      assert.equal(toCompact.length, 0);
      assert.equal(toPreserve.length, 2);
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

  describe('compactIfNeeded', () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv.COMPACTION_ENABLED = process.env.COMPACTION_ENABLED;
      savedEnv.COMPACTION_THRESHOLD = process.env.COMPACTION_THRESHOLD;
      savedEnv.COMPACTION_MODEL = process.env.COMPACTION_MODEL;
      savedEnv.COMPACTION_TAIL_TURNS = process.env.COMPACTION_TAIL_TURNS;
    });

    afterEach(() => {
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
      clearContextWindows();
    });

    it('returns mapped unchanged when compaction disabled', async () => {
      process.env.COMPACTION_ENABLED = 'false';
      const messages = makeMessages(10);
      const mapped = makeMappedRequest(messages);
      const router = createMockRouter('summary');

      const result = await compactIfNeeded(mapped, 'test-model', router);
      assert.deepEqual(result.messages, messages);
    });

    it('returns mapped unchanged when under threshold', async () => {
      process.env.COMPACTION_THRESHOLD = '0.8';
      // Small messages that won't trigger compaction
      const messages: OpenAIMessage[] = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];
      loadContextWindowsFromModels({ 'test-model': 128000 });
      const mapped = makeMappedRequest(messages);
      const router = createMockRouter('summary');

      const result = await compactIfNeeded(mapped, 'test-model', router);
      assert.deepEqual(result.messages, messages);
    });

    it('calls LLM and compacts when over threshold', async () => {
      process.env.COMPACTION_THRESHOLD = '0.1';
      process.env.COMPACTION_TAIL_TURNS = '1';
      // Use a small context window so even small messages exceed threshold
      loadContextWindowsFromModels({ 'test-model': 100 });

      const messages = makeMessages(5); // 10 messages, 5 turns
      const mapped = makeMappedRequest(messages);
      const router = createMockRouter('## Objective\n- Build something\n\n## Work State\n- Active');

      const result = await compactIfNeeded(mapped, 'test-model', router);
      // Should have summary + preserved messages (2 messages for 1 tail turn)
      assert.ok(result.messages.length < messages.length);
      assert.ok(result.messages[0].content?.toString().includes('## Objective'));
      assert.equal(result.messages.length, 3); // summary + 2 preserved
    });

    it('falls back to truncation on LLM error', async () => {
      process.env.COMPACTION_THRESHOLD = '0.1';
      process.env.COMPACTION_TAIL_TURNS = '1';
      loadContextWindowsFromModels({ 'test-model': 100 });

      const messages = makeMessages(5);
      const mapped = makeMappedRequest(messages);
      const router = createMockRouter('', true); // shouldError = true

      const result = await compactIfNeeded(mapped, 'test-model', router);
      // Should fall back to truncation
      assert.ok(result.messages[0].content?.toString().includes('truncated'));
      assert.equal(result.messages.length, 3); // truncation msg + 2 preserved
    });

    it('uses COMPACTION_MODEL env var when set', async () => {
      process.env.COMPACTION_THRESHOLD = '0.1';
      process.env.COMPACTION_MODEL = 'claude-sonnet-4';
      process.env.COMPACTION_TAIL_TURNS = '1';
      loadContextWindowsFromModels({ 'claude-sonnet-4': 200000 });

      const messages: OpenAIMessage[] = [];
      // Create messages that exceed threshold for claude-sonnet-4 (200k window)
      for (let i = 0; i < 100; i++) {
        messages.push({ role: 'user', content: 'x'.repeat(2000) });
        messages.push({ role: 'assistant', content: 'y'.repeat(2000) });
      }
      const mapped = makeMappedRequest(messages);

      let requestedModel = '';
      const router = {
        execute: async function* (providerIds: any, model: string) {
          requestedModel = model;
          yield { type: 'text', content: 'summary' };
        },
      } as unknown as Router;

      const result = await compactIfNeeded(mapped, 'claude-sonnet-4', router);
      assert.equal(requestedModel, 'claude-sonnet-4');
    });
  });

  describe('getCompactionConfig', () => {
    it('returns default config', () => {
      const saved = {
        COMPACTION_ENABLED: process.env.COMPACTION_ENABLED,
        COMPACTION_THRESHOLD: process.env.COMPACTION_THRESHOLD,
        COMPACTION_TAIL_TURNS: process.env.COMPACTION_TAIL_TURNS,
        COMPACTION_MODEL: process.env.COMPACTION_MODEL,
      };

      delete process.env.COMPACTION_ENABLED;
      delete process.env.COMPACTION_THRESHOLD;
      delete process.env.COMPACTION_TAIL_TURNS;
      delete process.env.COMPACTION_MODEL;

      const cfg = getCompactionConfig();
      assert.equal(cfg.enabled, true);
      assert.equal(cfg.threshold, 0.8);
      assert.equal(cfg.tailTurns, 2);
      assert.equal(cfg.model, '');

      for (const [key, val] of Object.entries(saved)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    });
  });
});
