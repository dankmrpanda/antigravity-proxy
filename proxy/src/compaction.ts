import { logger } from './logger.js';
import { estimateMessageTokens, estimateSystemTokens, estimateToolTokens } from './token-estimator.js';
import type { OpenAIMessage } from './mapper.js';

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_TAIL_TURNS = 2;

const SUMMARIZATION_TEMPLATE = `You are a conversation summarizer. Summarize the following conversation history into a structured format. Preserve all important context, decisions, and current state.

Output format:
## Objective
- [what the user is trying to accomplish]

## Important Details
- [constraints, decisions, facts, assumptions]

## Work State
- Completed: [finished work, verified facts]
- Active: [current work, partial changes]
- Blocked: [blockers, failing commands]

## Next Move
1. [immediate concrete action]
2. [next action if known]

Conversation to summarize:
`;

export function needsCompaction(
  system: string,
  messages: OpenAIMessage[],
  tools?: Record<string, unknown>,
  contextWindow?: number,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  if (threshold <= 0 || threshold >= 1) return false;
  const window = contextWindow || 128000;
  const maxTokens = Math.floor(window * threshold);
  const systemTokens = estimateSystemTokens(system);
  const messageTokens = estimateMessageTokens(messages);
  const toolTokens = estimateToolTokens(tools);
  const totalTokens = systemTokens + messageTokens + toolTokens;
  return totalTokens > maxTokens;
}

export function selectMessagesToCompact(
  messages: OpenAIMessage[],
  tailTurns: number = DEFAULT_TAIL_TURNS,
): { toCompact: OpenAIMessage[]; toPreserve: OpenAIMessage[] } {
  if (messages.length <= tailTurns) {
    return { toCompact: [], toPreserve: messages };
  }
  const toPreserve = messages.slice(-tailTurns);
  const toCompact = messages.slice(0, -tailTurns);
  return { toCompact, toPreserve };
}

export function buildSummarizationPrompt(messages: OpenAIMessage[]): string {
  const serialized = messages.map(msg => {
    const role = msg.role === 'user' ? '[User]' : '[Assistant]';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return `${role}: ${content}`;
  }).join('\n\n');
  return SUMMARIZATION_TEMPLATE + serialized;
}

export async function compactMessages(
  messages: OpenAIMessage[],
  tailTurns: number = DEFAULT_TAIL_TURNS,
): Promise<OpenAIMessage[]> {
  const { toCompact, toPreserve } = selectMessagesToCompact(messages, tailTurns);
  if (toCompact.length === 0) return messages;

  logger.info(`[compaction] Compacting ${toCompact.length} messages, preserving ${toPreserve.length}`);
  // Placeholder - actual LLM call will be added in Task 4
  return [
    { role: 'user', content: '[Context compacted - summary placeholder]' },
    ...toPreserve,
  ];
}

export function getCompactionConfig() {
  return {
    enabled: process.env.COMPACTION_ENABLED !== 'false',
    threshold: parseFloat(process.env.COMPACTION_THRESHOLD || '0.8'),
    tailTurns: parseInt(process.env.COMPACTION_TAIL_TURNS || '2', 10),
    model: process.env.COMPACTION_MODEL || '',
  };
}
