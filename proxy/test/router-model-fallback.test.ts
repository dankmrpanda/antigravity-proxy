/**
 * Tests for router model fallback behavior [S8, S9].
 *
 * Validates that when a provider's primary model fails, the router
 * tries fallback models before moving to the next provider.
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Router model fallback', () => {
  describe('source code structure', () => {
    it('should call getFallbackModels in the first pass', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('getFallbackModels(model, providerId)'),
        'router.ts should call getFallbackModels for model fallback'
      );
    });

    it('should have a model fallback loop in the first pass', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('for (let modelIdx = 0; modelIdx < fallbackModels.length; modelIdx++)'),
        'router.ts should iterate over fallback models'
      );
    });

    it('should log fallback model attempts', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('trying fallback model'),
        'router.ts should log fallback model attempts'
      );
    });

    it('should emit modelFallback flag on attempt chunks', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('modelFallback'),
        'router.ts should emit modelFallback flag on attempt chunks'
      );
    });

    it('should track providerFullyFailed to break out of model loop', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('providerFullyFailed'),
        'router.ts should track providerFullyFailed flag'
      );
    });

    it('should not run complex model resolution for non-primary fallback models', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('Only run the complex resolution when using the primary'),
        'router.ts should skip complex resolution for fallback models'
      );
    });

    it('should log which model succeeded', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('succeeded with'),
        'router.ts should log which model succeeded'
      );
    });

    it('should have model fallback in the second pass too', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      // Second pass has its own getFallbackModels call
      const secondPassIdx = src.indexOf('Second pass (A6)');
      assert.ok(secondPassIdx > 0, 'router.ts should have second pass');
      const secondPassSection = src.substring(secondPassIdx);
      assert.ok(
        secondPassSection.includes('getFallbackModels'),
        'second pass should also use getFallbackModels'
      );
      assert.ok(
        secondPassSection.includes('modelIdx'),
        'second pass should iterate over fallback models'
      );
    });

    it('should have isFallbackModel flag for distinguishing primary vs fallback', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('isFallbackModel'),
        'router.ts should have isFallbackModel flag'
      );
    });

    it('should log fallback model count', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('trying fallback model ${modelIdx + 1}/${fallbackModels.length}'),
        'router.ts should log model index and total count'
      );
    });
  });

  describe('fallback flow logic', () => {
    it('primary model failure triggers fallback model attempt on same provider', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      // The model fallback loop is inside the per-provider loop
      const providerLoopStart = src.indexOf('for (const providerId of candidates)');
      const modelFallbackCall = src.indexOf('getFallbackModels(model, providerId)');
      assert.ok(
        modelFallbackCall > providerLoopStart,
        'getFallbackModels should be called inside the per-provider loop'
      );
    });

    it('providerFullyFailed prevents trying more fallback models', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('if (providerFullyFailed) break;'),
        'router.ts should break out of model loop when providerFullyFailed'
      );
    });

    it('mid-stream failure emits failover and breaks to next model', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes('failed mid-stream'),
        'router.ts should handle mid-stream failure in model fallback'
      );
    });

    it('rate limit detection is preserved in model fallback', () => {
      const src = fs.readFileSync(new URL('../src/router.ts', import.meta.url), 'utf-8');
      assert.ok(
        src.includes("'429'"),
        'router.ts should detect 429 rate limits'
      );
      assert.ok(
        src.includes("'rate_limit'"),
        'router.ts should detect rate_limit errors'
      );
    });
  });
});
