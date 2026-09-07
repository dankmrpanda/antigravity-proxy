/**
 * Anthropic Messages API over an OpenCode gateway base URL (Go /messages,
 * Zen /messages). Same protocol as AnthropicAdapter, but authenticates like
 * the gateway expects (Bearer + stable x-opencode-session + distinct UA)
 * and always runs maximum thinking.
 */

import { randomUUID } from 'crypto';
import { AnthropicAdapter } from './anthropic.js';

export class GatewayMessagesAdapter extends AnthropicAdapter {
  constructor(baseUrl: string, apiKey: string, gatewayProvider: string) {
    super(baseUrl, apiKey);
    this.provider = gatewayProvider;
  }

  protected override buildHeaders(config?: Record<string, unknown>): Record<string, string> {
    const sessionId = (config as any)?.providerOptions?.sessionId || randomUUID();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'x-opencode-session': String(sessionId),
      'User-Agent': 'antigravity-proxy/1.0.7',
    };
  }

  /**
   * Always maximum thinking: largest budget that still leaves headroom for
   * output (budget must stay below max_tokens).
   */
  protected override thinkingBudget(maxTokens: number): number | null {
    return Math.max(1024, Math.min(16384, maxTokens - 1024));
  }
}
