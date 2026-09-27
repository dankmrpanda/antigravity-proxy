import { logger } from './logger.js';
import { estimateMessageTokens, estimateSystemTokens, estimateToolTokens } from './token-estimator.js';
import type { OpenAIMessage, MappedRequest } from './mapper.js';
import { sanitizeToolPairs } from './mapper.js';
import type { Router } from './router.js';
import { config } from './config.js';
import { getContextWindow } from './context-windows.js';
import { modelResolver } from './models.js';

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
  // Each turn is a user + assistant pair (2 messages) — but tool-heavy
  // histories interleave assistant(tool_calls) + tool(result) groups, so a
  // naive slice can cut mid-group. Cutting mid-group leaves an orphan tool
  // output in toPreserve whose assistant call was compacted away, which
  // strict providers (Responses `function_call_output.call_id`) reject with
  // 400 ("No function call found for function call output ...").
  const preserveCount = tailTurns * 2;
  if (messages.length <= preserveCount) {
    return { toCompact: [], toPreserve: messages };
  }
  let cut = messages.length - preserveCount;
  // Never start the preserved tail on a tool result — expand backwards to
  // include its assistant call.
  while (cut > 0 && messages[cut]?.role === 'tool') {
    cut--;
  }
  // Never leave an assistant tool call dangling at the end of toCompact
  // (its results would start toPreserve as orphans) — expand the preserved
  // tail backwards to keep the whole group together.
  while (
    cut > 0 &&
    messages[cut - 1]?.role === 'assistant' &&
    (messages[cut - 1]?.tool_calls?.length || 0) > 0
  ) {
    cut--;
    while (cut > 0 && messages[cut]?.role === 'tool') {
      cut--;
    }
  }
  const toPreserve = messages.slice(cut);
  const toCompact = messages.slice(0, cut);
  return { toCompact, toPreserve };
}

export function buildSummarizationPrompt(messages: OpenAIMessage[]): string {
  const serialized = messages.map(msg => {
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const calls = msg.tool_calls
        .map((tc) => `[Tool call: ${tc.function.name} ${tc.function.arguments}]`)
        .join(' ');
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
      return `[Assistant]: ${text} ${calls}`.trim();
    }
    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
      return `[Tool result ${msg.tool_call_id || ''}]: ${content}`;
    }
    const role = msg.role === 'user' ? '[User]' : '[Assistant]';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return `${role}: ${content}`;
  }).join('\n\n');
  return SUMMARIZATION_TEMPLATE + serialized;
}

/**
 * Attempt LLM-powered compaction. Falls back to truncation on failure.
 * Returns the mapped request with messages compacted if needed.
 */
export async function compactIfNeeded(
  mapped: MappedRequest,
  model: string,
  router: Router,
): Promise<MappedRequest> {
  const cfg = getCompactionConfig();
  if (!cfg.enabled) return mapped;

  const contextWindow = getContextWindow(model);
  const system = mapped.system || '';
  const tools = mapped.tools as Record<string, unknown> | undefined;

  if (!needsCompaction(system, mapped.messages, tools, contextWindow, cfg.threshold)) {
    return mapped;
  }

  logger.info(`[compaction] Compaction needed for model ${model} (window: ${contextWindow})`);

  const { toCompact, toPreserve } = selectMessagesToCompact(mapped.messages, cfg.tailTurns);
  if (toCompact.length === 0) return mapped;

  const prompt = buildSummarizationPrompt(toCompact);
  const compactionModel = cfg.model || model;

  try {
    const providerIds = config.providerPriority;
    // Use router's execute to get a non-streaming summary
    let summary = '';
    const gen = router.execute(
      providerIds,
      compactionModel,
      [{ role: 'user', content: prompt }],
      undefined,
      { maxTokens: 2048, temperature: 0.3 },
    );

    for await (const chunk of gen) {
      if (chunk.type === 'text') summary += chunk.content || '';
      if (chunk.type === 'error') throw new Error(chunk.content || 'compaction LLM error');
    }

    if (!summary.trim()) {
      throw new Error('Empty summary from LLM');
    }

    logger.info(`[compaction] LLM summary obtained (${summary.length} chars)`);

    // The preserved tail can still start with a tool result whose call was
    // summarized away (e.g. tailTurns lands mid-history) or end with a
    // dangling call. Sanitize so strict providers never see an orphan.
    const safePreserve = sanitizeToolPairs(toPreserve);
    const compactedMessages: OpenAIMessage[] = [
      { role: 'user', content: `[Context compacted]\n${summary}` },
      ...safePreserve,
    ];

    return { ...mapped, messages: sanitizeToolPairs(compactedMessages) };
  } catch (err: any) {
    logger.warn(`[compaction] LLM summarization failed, falling back to truncation: ${err.message}`);
    const safePreserve = sanitizeToolPairs(toPreserve);
    const fallbackMessages: OpenAIMessage[] = [
      { role: 'user', content: '[Context compacted - earlier conversation truncated]' },
      ...safePreserve,
    ];
    return { ...mapped, messages: sanitizeToolPairs(fallbackMessages) };
  }
}

export function getCompactionConfig() {
  return {
    enabled: process.env.COMPACTION_ENABLED !== 'false' && modelResolver.compactionEnabled,
    threshold: parseFloat(process.env.COMPACTION_THRESHOLD || String(modelResolver.compactionThreshold)),
    tailTurns: parseInt(process.env.COMPACTION_TAIL_TURNS || String(modelResolver.compactionTailTurns), 10),
    model: process.env.COMPACTION_MODEL || modelResolver.compactionModel,
  };
}
