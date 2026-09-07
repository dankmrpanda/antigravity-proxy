/**
 * Regression tests for the opencode-go / zen / nvidia router failures:
 *
 * 1. opencode-go 400 MissingSessionID — the Go gateway requires a stable
 *    `x-opencode-session` header on EVERY request (including the first of a
 *    conversation) plus a non-generic User-Agent.
 *    See https://opencode.ai/docs/go/#where-can-i-use-it
 * 2. zen 401 "Model omen-alpha is not supported" — the Go-only default model
 *    must never be sent to Zen; each priority provider needs its own default.
 * 3. nvidia 404 — same root cause as (2): a foreign model id sent to NVIDIA.
 * 4. opencode-go 400 [1210] thinking-required (glm-5.3-flash) — the model
 *    always thinks; requests without reasoning_effort low/high/max are
 *    rejected. Fixed via reasoning-effort.json entry.
 * 5. nvidia 410 Gone — stepfun-ai/step-3.7-flash EOL 2026-08-28; replaced
 *    with live minimaxai/minimax-m3.
 * 6. zen 400 MissingSessionID "free tier can only be used in OpenCode" —
 *    Zen gateway also requires x-opencode-session; ZenAdapter now sends it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpencodeGoAdapter, selectGoHandler } from '../src/adapters/opencode-go.js';
import { ZenAdapter, selectZenHandler } from '../src/adapters/zen.js';
import { getGoEndpoint, isGoChatCompatible, findEndpointMismatches, endpointError } from '../src/opencode-endpoints.js';
import { classifyProviderError } from '../src/router.js';
import { modelResolver } from '../src/models.js';

// ─── x-opencode-session header ──────────────────────────────────────────

test('G1: OpencodeGoAdapter sends x-opencode-session from providerOptions.sessionId', () => {
  const adapter = new OpencodeGoAdapter('opencode-go', 'https://opencode.ai/zen/go/v1', 'k');
  const headers = (adapter as any).buildHeaders({ providerOptions: { sessionId: 'sess-abc-123' } });
  assert.equal(headers['x-opencode-session'], 'sess-abc-123');
});

test('G2: OpencodeGoAdapter still sends a session header when no sessionId configured (never MissingSessionID)', () => {
  const adapter = new OpencodeGoAdapter('opencode-go', 'https://opencode.ai/zen/go/v1', 'k');
  for (const cfg of [undefined, {}, { providerOptions: {} }]) {
    const headers = (adapter as any).buildHeaders(cfg);
    assert.ok(headers['x-opencode-session'], `expected fallback session header for config ${JSON.stringify(cfg)}`);
    assert.ok(String(headers['x-opencode-session']).length >= 8, 'fallback session id should be non-trivial');
  }
});

test('G3: OpencodeGoAdapter identifies itself with its own User-Agent (not a generic SDK name)', () => {
  const adapter = new OpencodeGoAdapter('opencode-go', 'https://opencode.ai/zen/go/v1', 'k');
  const headers = (adapter as any).buildHeaders({ providerOptions: { sessionId: 's' } });
  assert.ok(headers['User-Agent'], 'expected User-Agent header');
  assert.match(String(headers['User-Agent']), /antigravity/i);
});

test('G4: OpencodeGoAdapter keeps Authorization + Content-Type headers', () => {
  const adapter = new OpencodeGoAdapter('opencode-go', 'https://opencode.ai/zen/go/v1', 'secret-key');
  const headers = (adapter as any).buildHeaders({ providerOptions: { sessionId: 's' } });
  assert.equal(headers['Authorization'], 'Bearer secret-key');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('G5: OpencodeGoAdapter buildRequest still puts session_id in body for cache discounts', () => {
  const adapter = new OpencodeGoAdapter('opencode-go', 'https://opencode.ai/zen/go/v1', 'k');
  const body = (adapter as any).buildRequest(
    'omen-alpha',
    [{ role: 'user', content: 'hi' }],
    undefined,
    { providerOptions: { sessionId: 'sess-abc-123' } },
  );
  assert.equal(body.session_id, 'sess-abc-123');
});

// ─── Per-provider model routing ─────────────────────────────────────────
// NOTE: assertions below are config-shape checks, not local-config checks,
// so they hold for any models.json (including upstream defaults).

test('G6: provider defaults never leak a foreign-only model id', () => {
  modelResolver.reload();
  for (const provider of ['opencode-go', 'zen', 'nvidia']) {
    const def = modelResolver.getDefaultModel(provider);
    if (def) {
      const mismatches = findEndpointMismatches({ default: { [provider]: def } });
      assert.deepEqual(mismatches, [], `default ${provider} model unsupported: ${def}`);
    }
  }
});

// ─── Zen session header (free-tier MissingSessionID) ────────────────────

test('G9: ZenAdapter sends x-opencode-session from providerOptions.sessionId', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'k');
  const headers = (adapter as any).buildHeaders({ providerOptions: { sessionId: 'sess-zen-1' } });
  assert.equal(headers['x-opencode-session'], 'sess-zen-1');
  assert.match(String(headers['User-Agent']), /antigravity/i);
});

test('G10: ZenAdapter still sends a session header when none configured', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'k');
  const headers = (adapter as any).buildHeaders({});
  assert.ok(headers['x-opencode-session'], 'zen must never omit x-opencode-session');
});

// ─── Always-maximum effort on Go/Zen chat path ─────────────────────────

test('G11: OpencodeGoAdapter always sends reasoning_effort=max', () => {
  const adapter = new OpencodeGoAdapter('opencode-go', 'https://opencode.ai/zen/go/v1', 'k');
  for (const m of ['omen-alpha', 'glm-5.3-flash', 'mimo-v2.5', 'kimi-k2.7-code']) {
    const body = (adapter as any).buildRequest(
      m,
      [{ role: 'user', content: 'hi' }],
      undefined,
      { providerOptions: { sessionId: 's', openai: { reasoningEffort: 'low' } } },
    );
    assert.equal(body.reasoning_effort, 'max', `${m} must use max effort even when low requested`);
  }
});

test('G12: ZenAdapter always sends reasoning_effort=max', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'k');
  const body = (adapter as any).buildRequest(
    'mimo-v2.5-free',
    [{ role: 'user', content: 'hi' }],
    undefined,
    {},
  );
  assert.equal(body.reasoning_effort, 'max');
});

// ─── Retired NVIDIA model must not be referenced ────────────────────────

test('G13: models.json contains no references to EOL stepfun-ai/step-3.7-flash', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'models.json'), 'utf-8');
  assert.ok(!raw.includes('step-3.7-flash'), 'EOL model still referenced in models.json');
  modelResolver.reload();
  assert.equal(modelResolver.getDefaultModel('nvidia'), 'minimaxai/minimax-m3');
});

// ─── Go per-model endpoint requirements ───────────────────────────────

test('G14: documented Go endpoints are classified correctly', () => {
  // chat/completions (OpenAI-compatible)
  for (const m of ['omen-alpha', 'deepseek-v4-flash', 'glm-5.3-flash', 'kimi-k2.7-code', 'mimo-v2.5']) {
    assert.equal(getGoEndpoint(m), 'unknown', `${m} should not be flagged (chat-compatible or unlisted)`);
    assert.ok(isGoChatCompatible(m), `${m} should be chat-compatible`);
  }
  // Responses API models
  for (const m of ['muse-spark-1.3-contributor', 'grok-4.6', 'gpt-5.6-luna']) {
    assert.equal(getGoEndpoint(m), 'responses');
    assert.ok(!isGoChatCompatible(m));
  }
  // Anthropic Messages API models
  for (const m of ['minimax-m3', 'qwen3.7-max', 'qwen3.6-plus']) {
    assert.equal(getGoEndpoint(m), 'messages');
    assert.ok(!isGoChatCompatible(m));
  }
});

test('G15: validator passes current mappings (only Zen google-native is flagged)', () => {
  modelResolver.reload();
  const mismatches = findEndpointMismatches(modelResolver.getProviderMap());
  assert.deepEqual(mismatches, [], `unexpected mismatches: ${mismatches.join('; ')}`);
});

test('G16: Go/Zen handlers route by model endpoint (model never switched)', () => {
  assert.equal(selectGoHandler('omen-alpha'), 'chat');
  assert.equal(selectGoHandler('muse-spark-1.3-contributor'), 'responses');
  assert.equal(selectGoHandler('minimax-m3'), 'messages');
  assert.equal(selectZenHandler('mimo-v2.5-free'), 'chat');
  assert.equal(selectZenHandler('claude-sonnet-4-6'), 'messages');
  assert.equal(selectZenHandler('gpt-5.6-luna'), 'responses');
  assert.equal(selectZenHandler('gemini-3.5-flash'), 'google-native');
});

test('G17: validator flags Zen google-native mappings (unit)', () => {
  const bad = findEndpointMismatches({
    'some-alias': { 'opencode-go': 'minimax-m3', 'zen': 'gemini-3.5-flash' },
    'default': { 'opencode-go': 'omen-alpha' },
  });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /some-alias.*zen:gemini-3\.5-flash/);
});

test('G18: endpoint guard error matches the router deterministic pattern', () => {
  const err = endpointError('zen', 'gemini-3.5-flash', 'models/gemini-3.5-flash');
  assert.match(err.message, /which this proxy does not support/);
  assert.equal(classifyProviderError(`[zen] API error 400: ${err.message}`), 'failover');
});
