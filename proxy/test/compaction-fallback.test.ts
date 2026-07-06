/**
 * Integration tests for compaction + fallback chain working together.
 *
 * Tests:
 * 1. Compaction pipeline end-to-end (summarization via LLM, truncation fallback)
 * 2. Fallback chain execution (provider failure → next provider)
 * 3. Model fallback within a provider (primary model → fallback model)
 * 4. Compaction triggering, then fallback chain executing on the summary request
 * 5. Both features combined: compact context, then route summary through fallback
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsCompaction,
  selectMessagesToCompact,
  buildSummarizationPrompt,
  compactIfNeeded,
  getCompactionConfig,
} from '../src/compaction.js';
import { Router } from '../src/router.js';
import { ModelResolver } from '../src/models.js';
import {
  loadContextWindowsFromModels,
  clearContextWindows,
} from '../src/context-windows.js';
import type { OpenAIMessage, MappedRequest } from '../src/mapper.js';
import type { StreamChunk, ModelAdapter } from '../src/adapters/types.js';
import type { ProviderConfig } from '../src/adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessages(count: number, sizePerMessage = 100): OpenAIMessage[] {
  const msgs: OpenAIMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: 'user', content: 'u'.repeat(sizePerMessage) + ` msg${i}` });
    msgs.push({ role: 'assistant', content: 'a'.repeat(sizePerMessage) + ` resp${i}` });
  }
  return msgs;
}

function makeMappedRequest(
  messages: OpenAIMessage[],
  opts?: { system?: string; tools?: Record<string, unknown> },
): MappedRequest {
  return {
    messages,
    system: opts?.system ?? 'You are a helpful assistant.',
    tools: opts?.tools,
  };
}

function createMockAdapter(
  chunks: StreamChunk[],
): ModelAdapter & { callLog: Array<{ model: string; attempt: number }> } {
  const callLog: Array<{ model: string; attempt: number }> = [];
  let attemptCount = 0;

  return {
    provider: 'mock',
    callLog,
    async *stream(
      model: string,
      _messages: OpenAIMessage[],
      _tools?: Record<string, unknown>,
      _config?: Record<string, unknown>,
      _signal?: AbortSignal,
      _system?: string,
    ): AsyncGenerator<StreamChunk> {
      callLog.push({ model, attempt: attemptCount++ });
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  } as ModelAdapter & { callLog: Array<{ model: string; attempt: number }> };
}

function createErrorAdapter(errorMessage: string): ModelAdapter {
  return {
    provider: 'mock-error',
    async *stream(): AsyncGenerator<StreamChunk> {
      yield { type: 'error', content: errorMessage };
    },
  };
}

function buildRouter(
  adapters: Map<string, ModelAdapter>,
  opts?: { retries?: number; backoffMs?: number; resolver?: ModelResolver },
): Router {
  const resolver = opts?.resolver ?? new ModelResolver();
  const router = new Router([], resolver, {
    retries: opts?.retries ?? 1,
    backoffMs: opts?.backoffMs ?? 1,
  });
  (router as any).adapters = adapters;
  return router;
}

async function collectChunks(gen: AsyncGenerator<any>): Promise<any[]> {
  const results: any[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

/**
 * Mock config.providerPriority to point at our mock providers.
 * Returns a restore function.
 */
async function mockProviderPriority(
  providers: string[],
): Promise<() => void> {
  const configMod = await import('../src/config.js');
  const orig = configMod.config.providerPriority;
  (configMod.config as any).providerPriority = providers;
  return () => {
    (configMod.config as any).providerPriority = orig;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Compaction Pipeline End-to-End', () => {
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

  it('compacts messages when over threshold using LLM summary', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '2';
    delete process.env.COMPACTION_MODEL;

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(8);
    const mapped = makeMappedRequest(messages);

    const summaryText = '## Objective\n- Test task\n\n## Work State\n- Active';
    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createMockAdapter([{ type: 'text', content: summaryText }]));

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.equal(result.messages.length, 5);
      assert.ok(
        result.messages[0].content?.toString().includes('[Context compacted]'),
        'First message should be the compaction summary',
      );
      assert.ok(
        result.messages[0].content?.toString().includes('## Objective'),
        'Summary should contain the LLM-generated content',
      );
      assert.equal(result.messages[1].content?.toString().includes('msg6'), true);
      assert.equal(result.messages[4].content?.toString().includes('resp7'), true);
    } finally {
      restore();
    }
  });

  it('falls back to truncation when LLM summary fails', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(6);
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createErrorAdapter('provider is down'));

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.equal(result.messages.length, 3);
      assert.ok(
        result.messages[0].content?.toString().includes('truncated'),
        'Should use truncation fallback',
      );
    } finally {
      restore();
    }
  });

  it('falls back to truncation when LLM returns empty summary', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(6);
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createMockAdapter([{ type: 'text', content: '   ' }]));

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.ok(
        result.messages[0].content?.toString().includes('truncated'),
        'Empty summary should trigger truncation fallback',
      );
    } finally {
      restore();
    }
  });

  it('preserves system prompt and tools through compaction', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(6);
    const tools = { read_file: { description: 'Read a file' }, write_file: { description: 'Write a file' } };
    const mapped = makeMappedRequest(messages, {
      system: 'You are a coding assistant.',
      tools,
    });

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createMockAdapter([{ type: 'text', content: 'summary here' }]));

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.equal(result.system, 'You are a coding assistant.');
      assert.deepEqual(result.tools, tools);
    } finally {
      restore();
    }
  });

  it('does not compact when under threshold', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.99';

    loadContextWindowsFromModels({ 'test-model': 1_000_000 });

    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createMockAdapter([{ type: 'text', content: 'nope' }]));
    const router = buildRouter(adapters);

    const result = await compactIfNeeded(mapped, 'test-model', router);
    assert.deepEqual(result.messages, messages);
  });

  it('does not compact when disabled', async () => {
    process.env.COMPACTION_ENABLED = 'false';

    const messages = makeMessages(10);
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createMockAdapter([{ type: 'text', content: 'nope' }]));
    const router = buildRouter(adapters);

    const result = await compactIfNeeded(mapped, 'test-model', router);
    assert.deepEqual(result.messages, messages);
  });
});

describe('Integration: Fallback Chain Execution', () => {
  it('falls through to second provider when first fails', async () => {
    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createErrorAdapter('provider-a is down'));
    adapters.set('provider-b', createMockAdapter([{ type: 'text', content: 'Hello from provider-b' }]));

    const resolver = new ModelResolver();
    const router = new Router([], resolver, { retries: 1, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'Hello' }];
    const chunks = await collectChunks(
      router.execute(['provider-a', 'provider-b'], 'test-model', messages),
    );

    const attemptChunks = chunks.filter((c: any) => c.type === 'attempt');
    assert.ok(attemptChunks.length >= 2, 'Should have at least 2 attempt chunks');

    const textChunks = chunks.filter((c: any) => c.type === 'text');
    assert.equal(textChunks.length, 1);
    assert.equal(textChunks[0].content, 'Hello from provider-b');
    assert.equal(textChunks[0].provider, 'provider-b');
  });

  it('exhausts all providers and yields final error', async () => {
    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createErrorAdapter('a failed'));
    adapters.set('provider-b', createErrorAdapter('b failed'));

    const resolver = new ModelResolver();
    const router = new Router([], resolver, { retries: 1, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'Hello' }];
    const chunks = await collectChunks(
      router.execute(['provider-a', 'provider-b'], 'model', messages),
    );

    const errorChunks = chunks.filter((c: any) => c.type === 'error');
    assert.ok(errorChunks.length > 0);
    const lastChunk = errorChunks[errorChunks.length - 1];
    assert.ok(lastChunk.content?.includes('All providers failed'));
  });

  it('retries on transient failure before moving to next provider', async () => {
    const adapters = new Map<string, ModelAdapter>();

    let providerACallCount = 0;
    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(): AsyncGenerator<StreamChunk> {
        providerACallCount++;
        if (providerACallCount <= 2) {
          yield { type: 'error', content: 'transient error' };
        } else {
          yield { type: 'text', content: 'recovered!' };
        }
      },
    });

    const resolver = new ModelResolver();
    const router = new Router([], resolver, { retries: 3, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'test' }];
    const chunks = await collectChunks(
      router.execute(['provider-a'], 'model', messages),
    );

    const textChunks = chunks.filter((c: any) => c.type === 'text');
    assert.equal(textChunks.length, 1);
    assert.equal(textChunks[0].content, 'recovered!');
    assert.ok(providerACallCount >= 3);
  });

  it('caps retries at 2 when multiple providers are candidates', async () => {
    const adapters = new Map<string, ModelAdapter>();
    let providerACalls = 0;
    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(): AsyncGenerator<StreamChunk> {
        providerACalls++;
        yield { type: 'error', content: 'always fails' };
      },
    });
    adapters.set('provider-b', {
      provider: 'provider-b',
      async *stream(): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'b-ok' };
      },
    });

    const resolver = new ModelResolver();
    const router = new Router([], resolver, { retries: 10, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'hi' }];
    const chunks = await collectChunks(
      router.execute(['provider-a', 'provider-b'], 'model', messages),
    );

    // With multiple candidates, perProviderRetries = min(2, 10) = 2
    assert.ok(providerACalls <= 3, `Provider A capped at 3, got ${providerACalls}`);

    const textChunks = chunks.filter((c: any) => c.type === 'text');
    assert.equal(textChunks[0]?.provider, 'provider-b');
  });
});

describe('Integration: Model Fallback Within Provider', () => {
  it('tries fallback models before moving to next provider', async () => {
    const adapters = new Map<string, ModelAdapter>();
    const callLog: string[] = [];

    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(model: string): AsyncGenerator<StreamChunk> {
        callLog.push(`a:${model}`);
        if (model === 'primary-a') {
          yield { type: 'error', content: 'primary model not available' };
        } else {
          yield { type: 'text', content: `success via ${model}` };
        }
      },
    });

    const resolver = new ModelResolver();
    (resolver as any).providerMap = {
      'test-model': {
        'provider-a': ['primary-a', 'fallback-a1', 'fallback-a2'],
      },
    };

    const router = new Router([], resolver, { retries: 1, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'test' }];
    const chunks = await collectChunks(
      router.execute(['provider-a'], 'test-model', messages),
    );

    assert.ok(callLog.includes('a:primary-a'), 'Should try primary model');
    assert.ok(callLog.includes('a:fallback-a1'), 'Should try fallback model');

    const textChunks = chunks.filter((c: any) => c.type === 'text');
    assert.ok(textChunks[0].content?.includes('fallback-a1'));

    const attemptChunks = chunks.filter((c: any) => c.type === 'attempt');
    const fallbackAttempt = attemptChunks.find((c: any) => c.modelFallback === true);
    assert.ok(fallbackAttempt, 'Fallback attempt should have modelFallback flag');
  });

  it('all fallback models exhausted on provider-a, then tries provider-b', async () => {
    const adapters = new Map<string, ModelAdapter>();
    const callLog: string[] = [];

    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(model: string): AsyncGenerator<StreamChunk> {
        callLog.push(`a:${model}`);
        yield { type: 'error', content: `${model} down` };
      },
    });
    adapters.set('provider-b', {
      provider: 'provider-b',
      async *stream(model: string): AsyncGenerator<StreamChunk> {
        callLog.push(`b:${model}`);
        yield { type: 'text', content: `b-ok with ${model}` };
      },
    });

    const resolver = new ModelResolver();
    (resolver as any).providerMap = {
      'test-model': {
        'provider-a': ['primary-a', 'fallback-a1'],
        'provider-b': ['primary-b'],
      },
    };

    const router = new Router([], resolver, { retries: 1, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'hi' }];
    const chunks = await collectChunks(
      router.execute(['provider-a', 'provider-b'], 'test-model', messages),
    );

    assert.ok(callLog.includes('a:primary-a'));
    assert.ok(callLog.includes('a:fallback-a1'));
    assert.ok(callLog.includes('b:primary-b'));

    const textChunks = chunks.filter((c: any) => c.type === 'text');
    assert.equal(textChunks[0].provider, 'provider-b');
  });
});

describe('Integration: Compaction + Fallback Chain Combined', () => {
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

  it('compaction summary request goes through provider fallback', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(6);
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();

    let providerACalls = 0;
    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(): AsyncGenerator<StreamChunk> {
        providerACalls++;
        yield { type: 'error', content: 'compaction provider down' };
      },
    });

    adapters.set('provider-b', {
      provider: 'provider-b',
      async *stream(): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: '## Objective\n- Combined test' };
      },
    });

    const restore = await mockProviderPriority(['provider-a', 'provider-b']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.ok(
        result.messages[0].content?.toString().includes('## Objective'),
        'Summary should come from provider-b',
      );
      assert.equal(result.messages.length, 3);
      assert.ok(providerACalls >= 1, 'Provider A should have been called');
    } finally {
      restore();
    }
  });

  it('all compaction providers fail → truncation fallback', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(6);
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createErrorAdapter('a down'));
    adapters.set('provider-b', createErrorAdapter('b down'));

    const restore = await mockProviderPriority(['provider-a', 'provider-b']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.ok(
        result.messages[0].content?.toString().includes('truncated'),
        'Should use truncation when all compaction providers fail',
      );
      assert.equal(result.messages.length, 3);
    } finally {
      restore();
    }
  });

  it('model fallback within compaction: primary model fails, fallback succeeds', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';
    process.env.COMPACTION_MODEL = '';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages = makeMessages(6);
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    const callLog: string[] = [];

    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(model: string): AsyncGenerator<StreamChunk> {
        callLog.push(model);
        if (model === 'primary-summary') {
          yield { type: 'error', content: 'model overloaded' };
        } else {
          yield { type: 'text', content: '## Work State\n- Completed via fallback' };
        }
      },
    });

    const resolver = new ModelResolver();
    (resolver as any).providerMap = {
      'test-model': {
        'provider-a': ['primary-summary', 'fallback-summary'],
      },
    };

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const router = new Router([], resolver, { retries: 1, backoffMs: 1 });
      (router as any).adapters = adapters;

      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.ok(
        result.messages[0].content?.toString().includes('## Work State'),
        'Should get summary from fallback model',
      );
      assert.ok(callLog.includes('primary-summary'), 'Should try primary first');
      assert.ok(callLog.includes('fallback-summary'), 'Should try fallback');
    } finally {
      restore();
    }
  });

  it('compaction with custom COMPACTION_MODEL uses correct model', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';
    process.env.COMPACTION_MODEL = 'my-custom-compaction-model';

    loadContextWindowsFromModels({ 'my-custom-compaction-model': 200000 });

    // 100 turns × 2 msgs × ~504 tokens each ≈ 100800 tokens > 10% of 200k
    const messages: OpenAIMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push({ role: 'user', content: 'x'.repeat(2000) });
      messages.push({ role: 'assistant', content: 'y'.repeat(2000) });
    }
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    const callLog: string[] = [];

    adapters.set('provider-a', {
      provider: 'provider-a',
      async *stream(model: string): AsyncGenerator<StreamChunk> {
        callLog.push(model);
        yield { type: 'text', content: 'custom model summary' };
      },
    });

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const resolver = new ModelResolver();
      resolver.defaultModel = '';
      resolver.defaultProvider = '';
      const router = buildRouter(adapters, { resolver });
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.ok(result.messages[0].content?.toString().includes('custom model summary'));
      assert.ok(
        callLog.includes('my-custom-compaction-model'),
        'Compaction should use the COMPACTION_MODEL',
      );
    } finally {
      restore();
    }
  });
});

describe('Integration: Edge Cases', () => {
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    clearContextWindows();
  });

  it('selectMessagesToCompact preserves correct tail turns', () => {
    const messages = makeMessages(10);

    const { toCompact, toPreserve } = selectMessagesToCompact(messages, 2);
    assert.equal(toCompact.length, 16);
    assert.equal(toPreserve.length, 4);

    const result2 = selectMessagesToCompact(messages, 3);
    assert.equal(result2.toCompact.length, 14);
    assert.equal(result2.toPreserve.length, 6);
  });

  it('selectMessagesToCompact returns all as preserved when few messages', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const { toCompact, toPreserve } = selectMessagesToCompact(messages, 2);
    assert.equal(toCompact.length, 0);
    assert.equal(toPreserve.length, 2);
  });

  it('needsCompaction returns false for threshold=0 or threshold=1', () => {
    const messages = makeMessages(100);
    assert.equal(needsCompaction('sys', messages, undefined, 1000, 0), false);
    assert.equal(needsCompaction('sys', messages, undefined, 1000, 1), false);
    assert.equal(needsCompaction('sys', messages, undefined, 1000, -0.5), false);
    assert.equal(needsCompaction('sys', messages, undefined, 1000, 1.5), false);
  });

  it('buildSummarizationPrompt formats messages correctly', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
    ];
    const prompt = buildSummarizationPrompt(messages);
    assert.ok(prompt.includes('[User]: What is 2+2?'));
    assert.ok(prompt.includes('[Assistant]: 4'));
    assert.ok(prompt.includes('conversation summarizer'));
  });

  it('getCompactionConfig reads env vars correctly', () => {
    process.env.COMPACTION_ENABLED = 'false';
    process.env.COMPACTION_THRESHOLD = '0.5';
    process.env.COMPACTION_TAIL_TURNS = '3';
    process.env.COMPACTION_MODEL = 'gpt-4o';

    const cfg = getCompactionConfig();
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.threshold, 0.5);
    assert.equal(cfg.tailTurns, 3);
    assert.equal(cfg.model, 'gpt-4o');
  });

  it('compaction preserves message role ordering', async () => {
    process.env.COMPACTION_ENABLED = 'true';
    process.env.COMPACTION_THRESHOLD = '0.1';
    process.env.COMPACTION_TAIL_TURNS = '1';

    loadContextWindowsFromModels({ 'test-model': 100 });

    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'a'.repeat(500) },
      { role: 'assistant', content: 'b'.repeat(500) },
      { role: 'user', content: 'c'.repeat(500) },
      { role: 'assistant', content: 'd'.repeat(500) },
    ];
    const mapped = makeMappedRequest(messages);

    const adapters = new Map<string, ModelAdapter>();
    adapters.set('provider-a', createMockAdapter([{ type: 'text', content: '## Summary\nDone' }]));

    const restore = await mockProviderPriority(['provider-a']);
    try {
      const router = buildRouter(adapters);
      const result = await compactIfNeeded(mapped, 'test-model', router);

      assert.equal(result.messages[0].role, 'user');
      assert.equal(result.messages[1].role, 'user');
      assert.equal(result.messages[2].role, 'assistant');
    } finally {
      restore();
    }
  });

  it('router returns no-providers error when candidates list is empty', async () => {
    const adapters = new Map<string, ModelAdapter>();
    const resolver = new ModelResolver();
    // Clear default provider to ensure candidates is empty
    resolver.defaultProvider = '';
    resolver.defaultModel = '';
    const router = new Router([], resolver, { retries: 1, backoffMs: 1 });
    (router as any).adapters = adapters;

    const messages: OpenAIMessage[] = [{ role: 'user', content: 'hi' }];
    const chunks = await collectChunks(
      router.execute([], 'model', messages),
    );

    const errorChunks = chunks.filter((c: any) => c.type === 'error');
    assert.ok(errorChunks.length > 0);
    assert.ok(errorChunks[0].content?.includes('No providers available'));
  });
});
