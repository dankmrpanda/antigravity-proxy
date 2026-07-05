import type { OpenAIMessage } from './mapper.js';

const CHARS_PER_TOKEN = 4;
const ROLE_OVERHEAD_TOKENS = 4; // Approximate tokens for role/formatting per message

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function estimateSystemTokens(system: string): number {
  if (!system) return 0;
  return estimateTokens(system);
}

export function estimateMessageTokens(messages: OpenAIMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += ROLE_OVERHEAD_TOKENS;
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') {
          total += estimateTokens(part);
        } else if (part && typeof part === 'object') {
          total += estimateTokens(JSON.stringify(part));
        }
      }
    }
  }
  return total;
}

export function estimateToolTokens(tools?: Record<string, unknown>): number {
  if (!tools) return 0;
  return estimateTokens(JSON.stringify(tools));
}
