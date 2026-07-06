/**
 * Tests for ModelResolver — model fallback array support.
 *
 * Validates that ProviderModelMap accepts both string and string[]
 * values, resolve() returns the primary (first) model, and
 * getFallbackModels() returns the full fallback list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelResolver } from '../src/models.js';

function createResolver(providerModels: Record<string, Record<string, string | string[]>>): ModelResolver {
  const resolver = new ModelResolver();
  // Directly inject the provider map to avoid filesystem dependency
  (resolver as any).providerMap = providerModels;
  return resolver;
}

// --- resolve() ---

test('resolve: string value returns string directly', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: 'mimo-v2.5-free' },
  });
  assert.equal(r.resolve('gemini-3.5-flash', 'zen'), 'mimo-v2.5-free');
});

test('resolve: array value returns first element', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: ['mimo-v2.5-free', 'deepseek-v4-flash-free'] },
  });
  assert.equal(r.resolve('gemini-3.5-flash', 'zen'), 'mimo-v2.5-free');
});

test('resolve: array with single element returns that element', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: ['only-model'] },
  });
  assert.equal(r.resolve('gemini-3.5-flash', 'zen'), 'only-model');
});

test('resolve: string value without provider falls through to flatMap logic', () => {
  const r = createResolver({});
  // No provider mapping, no flatMap — returns the model name itself
  assert.equal(r.resolve('some-model', 'zen'), 'some-model');
});

test('resolve: models/ prefix stripped then resolved from array', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: ['mimo-v2.5-free', 'fallback-2'] },
  });
  assert.equal(r.resolve('models/gemini-3.5-flash', 'zen'), 'mimo-v2.5-free');
});

test('resolve: findPrimaryModel fallback with array value', () => {
  const r = createResolver({
    'claude-sonnet-4-6-thinking': { zen: ['mimo-v2.5-free'] },
  });
  // "claude-sonnet-4-6" should find "claude-sonnet-4-6-thinking" via findPrimaryModel
  assert.equal(r.resolve('claude-sonnet-4-6', 'zen'), 'mimo-v2.5-free');
});

// --- getFallbackModels() ---

test('getFallbackModels: returns full array for array value', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: ['mimo-v2.5-free', 'deepseek-v4-flash-free'] },
  });
  const result = r.getFallbackModels('gemini-3.5-flash', 'zen');
  assert.deepEqual(result, ['mimo-v2.5-free', 'deepseek-v4-flash-free']);
});

test('getFallbackModels: returns single-element array for string value', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: 'mimo-v2.5-free' },
  });
  const result = r.getFallbackModels('gemini-3.5-flash', 'zen');
  assert.deepEqual(result, ['mimo-v2.5-free']);
});

test('getFallbackModels: returns resolved model as fallback when no mapping', () => {
  const r = createResolver({});
  const result = r.getFallbackModels('unknown-model', 'zen');
  assert.deepEqual(result, ['unknown-model']);
});

test('getFallbackModels: models/ prefix resolved', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: ['primary', 'secondary', 'tertiary'] },
  });
  const result = r.getFallbackModels('models/gemini-3.5-flash', 'zen');
  assert.deepEqual(result, ['primary', 'secondary', 'tertiary']);
});

test('getFallbackModels: findPrimaryModel fallback returns full array', () => {
  const r = createResolver({
    'claude-sonnet-4-6-thinking': { zen: ['model-a', 'model-b'] },
  });
  const result = r.getFallbackModels('claude-sonnet-4-6', 'zen');
  assert.deepEqual(result, ['model-a', 'model-b']);
});

test('getFallbackModels: returns a copy, not the original array', () => {
  const original = ['model-a', 'model-b'];
  const r = createResolver({
    'test-model': { zen: original },
  });
  const result = r.getFallbackModels('test-model', 'zen');
  result.push('model-c');
  assert.deepEqual(original, ['model-a', 'model-b']);
});

// --- getDefaultModel() with array ---

test('getDefaultModel: extracts primary from array in providerMap', () => {
  const r = createResolver({
    default: { zen: ['primary-default', 'secondary-default'] },
  });
  assert.equal(r.getDefaultModel('zen'), 'primary-default');
});

test('getDefaultModel: returns string directly from providerMap', () => {
  const r = createResolver({
    default: { zen: 'my-default-model' },
  });
  assert.equal(r.getDefaultModel('zen'), 'my-default-model');
});

// --- Backward compatibility ---

test('backward compat: mixed string and array values in same map', () => {
  const r = createResolver({
    'model-a': { zen: 'single-model' },
    'model-b': { zen: ['first', 'second'] },
  });
  assert.equal(r.resolve('model-a', 'zen'), 'single-model');
  assert.equal(r.resolve('model-b', 'zen'), 'first');
  assert.deepEqual(r.getFallbackModels('model-a', 'zen'), ['single-model']);
  assert.deepEqual(r.getFallbackModels('model-b', 'zen'), ['first', 'second']);
});

test('backward compat: getProvidersForModel works with array values', () => {
  const r = createResolver({
    'gemini-3.5-flash': { zen: ['mimo-v2.5-free', 'deepseek-v4-flash-free'] },
  });
  const providers = r.getProvidersForModel('gemini-3.5-flash');
  assert.deepEqual(providers, ['zen']);
});
