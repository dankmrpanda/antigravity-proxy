import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeToolPairs, type OpenAIMessage } from '../src/mapper.js';
import { toResponsesInput, handleResponsesEvent } from '../src/adapters/gateway-responses.js';
import { OpenAICompatAdapter } from '../src/adapters/openai.js';
import { getRouter, streamResponse } from '../src/engine.js';
import { selectMessagesToCompact } from '../src/compaction.js';
import { Router } from '../src/router.js';
import { ModelResolver } from '../src/models.js';

function call(id: string, name = 'list_dir') {
  return { id, type: 'function' as const, function: { name, arguments: '{}' } };
}

test('router skips unconfigured remote providers while allowing local providers without keys', () => {
  const router = new Router([
    { id: 'nvidia', priority: 0, enabled: true },
    { id: 'openrouter', priority: 1, enabled: true, apiKey: '  ' },
    { id: 'ollama', priority: 2, enabled: true },
  ], new ModelResolver());
  assert.ok(!(router as any).adapters.has('nvidia'));
  assert.ok(!(router as any).adapters.has('openrouter'));
  assert.ok((router as any).adapters.has('ollama'));
});

test('history repair removes only unanswered calls from a parallel batch', () => {
  const history: OpenAIMessage[] = [
    { role: 'assistant', content: 'Inspecting', tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'b', content: 'files' },
    { role: 'user', content: 'continue' },
  ];
  const repaired = sanitizeToolPairs(history);
  assert.deepEqual(repaired[0].tool_calls?.map(tc => tc.id), ['b']);
  assert.equal(repaired[1].tool_call_id, 'b');
  assert.equal(history[0].tool_calls?.length, 2, 'repair must not mutate the source history');
});

test('history repair rejects forward references and duplicate tool outputs', () => {
  const repaired = sanitizeToolPairs([
    { role: 'tool', tool_call_id: 'a', content: 'early' },
    { role: 'assistant', content: null, tool_calls: [call('a')] },
    { role: 'tool', tool_call_id: 'a', content: 'valid' },
    { role: 'tool', tool_call_id: 'a', content: 'duplicate' },
    { role: 'user', content: 'continue' },
  ]);
  assert.equal(repaired[0].role, 'user');
  assert.deepEqual(repaired.filter(m => m.role === 'tool').map(m => m.content), ['valid']);
  assert.ok(repaired.some(m => String(m.content).includes('duplicate')));
});

test('both serializers repair missing IDs and forward tool references', () => {
  const messages: OpenAIMessage[] = [
    { role: 'tool', content: 'missing ID' },
    { role: 'tool', tool_call_id: 'a', content: 'early' },
    { role: 'assistant', content: null, tool_calls: [call('a')] },
    { role: 'user', content: 'continue' },
  ];
  const adapter = new OpenAICompatAdapter('test', 'http://localhost', 'test');
  const chat = (adapter as any).serializeMessages(messages);
  assert.ok(chat.every((m: any) => m.role !== 'tool'));
  const { input } = toResponsesInput(messages);
  assert.ok(input.every(item => item.type !== 'function_call_output' && item.type !== 'function_call'));
});

test('compaction preserves a complete parallel call/result group', () => {
  const group: OpenAIMessage[] = [
    { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'b', content: 'second' },
    { role: 'tool', tool_call_id: 'a', content: 'first' },
  ];
  const { toCompact, toPreserve } = selectMessagesToCompact([
    { role: 'user', content: 'old' },
    ...group,
    { role: 'user', content: 'continue' },
  ], 1);
  assert.deepEqual(toCompact, [{ role: 'user', content: 'old' }]);
  assert.deepEqual(toPreserve.slice(0, 3), group);
});

test('history repair disambiguates reused call IDs and remains idempotent', () => {
  const repaired = sanitizeToolPairs([
    { role: 'assistant', content: null, tool_calls: [call('a')] },
    { role: 'tool', tool_call_id: 'a', content: 'first' },
    { role: 'assistant', content: null, tool_calls: [call('a')] },
    { role: 'tool', tool_call_id: 'a', content: 'second' },
  ]);
  assert.notEqual(repaired[0].tool_calls![0].id, repaired[2].tool_calls![0].id);
  assert.equal(repaired[3].tool_call_id, repaired[2].tool_calls![0].id);
  assert.deepEqual(sanitizeToolPairs(repaired), repaired);
});

test('adapters reject truncated tool JSON instead of forwarding empty arguments', async (t) => {
  const adapter = new OpenAICompatAdapter('test', 'http://localhost', 'test');
  const sse = [
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'list_dir', arguments: '{"DirectoryPath":' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'length' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  t.mock.method(adapter as any, 'fetchWithRetry', async () => new Response(sse, {
    headers: { 'content-type': 'text/event-stream' },
  }));
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream('test', [])) {
      assert.notEqual(chunk.type, 'tool-call');
    }
  }, /truncated.*token limit/);
  assert.throws(() => handleResponsesEvent({ type: 'response.output_item.done', item: {
    type: 'function_call', name: 'list_dir', arguments: '{"DirectoryPath":',
  } }), /malformed JSON/);
});

test('engine rejects missing required fields before returning a tool call', async (t) => {
  t.mock.method(getRouter(), 'execute', async function* () {
    yield { type: 'tool-call', name: 'list_dir', args: {} };
  });
  await assert.rejects(async () => {
    for await (const chunk of streamResponse({ messages: [], tools: {
      list_dir: { parameters: { type: 'object', properties: {
        DirectoryPath: { type: 'string' },
      }, required: ['DirectoryPath'] } },
    } }, 'test')) {
      assert.notEqual(chunk.type, 'tool-call');
    }
  }, /Invalid tool call list_dir.*DirectoryPath/);
});

test('engine returns canonical tool names, defaults and isolated concurrent schemas', async (t) => {
  const router = getRouter();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(router, 'execute', async function* (_providers: unknown, model: string) {
    if (model === 'agent') {
      await gate;
      yield { type: 'tool-call', name: 'listDir', args: {
        AbsolutePath: '/tmp', toolSummary: 'Inspect', toolAction: 'List',
      } };
      yield { type: 'tool-call', name: 'manageTask', args: {} };
    } else {
      yield { type: 'text', content: 'checkpoint' };
    }
  });
  const collect = async (gen: AsyncGenerator<any>) => {
    const chunks = [];
    for await (const chunk of gen) chunks.push(chunk);
    return chunks;
  };
  const agent = collect(streamResponse({ messages: [], tools: {
    list_dir: { parameters: { type: 'object', properties: {
      DirectoryPath: { type: 'string' }, toolSummary: { type: 'string' }, toolAction: { type: 'string' },
    }, required: ['DirectoryPath', 'toolSummary', 'toolAction'] } },
  } }, 'agent'));
  await collect(streamResponse({ messages: [] }, 'checkpoint'));
  release();
  const chunks = await agent;
  assert.equal(chunks[0].name, 'list_dir');
  assert.deepEqual(chunks[0].args, { DirectoryPath: '/tmp', toolSummary: 'Inspect', toolAction: 'List' });
  assert.equal(chunks[1].name, 'manage_task');
  assert.equal(chunks[1].args.Action, 'list');
});
