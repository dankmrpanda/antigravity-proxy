/**
 * Meta Model API adapter
 *
 * Direct integration with Meta's Model API (https://api.meta.ai/v1) for
 * Muse Spark models — OpenAI Chat Completions compatible.
 *
 * Docs: https://ai.developer.meta.com/docs/getting-started/overview
 * - Base URL: https://api.meta.ai/v1
 * - Auth: Bearer MODEL_API_KEY
 * - Endpoint: POST /chat/completions (OpenAI-compatible)
 * - Models: muse-spark-1.3 (latest, recommended), muse-spark-1.3-contributor,
 *   muse-spark-1.2, muse-spark-1.1
 * - Context window: 1,048,576 tokens
 *
 * Reasoning:
 * Muse Spark is a reasoning model — it thinks before answering. Depth is
 * controlled by top-level `reasoning_effort` on Chat Completions:
 *   none < minimal < low < medium < high < xhigh
 * `xhigh` is the maximum depth on the public endpoint (the `max` label used
 * for Muse Spark 1.3's strongest preview config maps to it). `none` is not
 * supported by Muse Spark (API returns 400).
 *
 * This adapter always sends maximum reasoning unless a per-model override
 * says otherwise:
 * - per-model config `max` → `xhigh` (public maximum)
 * - `high`/`medium`/`low` pass through; `minimal` supported
 * - no config → `xhigh` (max thinking by default)
 */

import type { OpenAIMessage } from "../mapper.js";
import type { ReasoningEffort } from "../reasoning-effort.js";
import { getEffortForModel } from "../reasoning-effort.js";
import { OpenAICompatAdapter } from "./openai.js";

export const META_BASE_URL = "https://api.meta.ai/v1";
export const META_DEFAULT_MODEL = "muse-spark-1.3";

/** Proxy effort → Meta API reasoning_effort value. */
const EFFORT_MAP: Record<Exclude<ReasoningEffort, "default">, string> = {
	low: "low",
	medium: "medium",
	high: "high",
	max: "xhigh",
};

/** Resolve the reasoning_effort string to send for a model. Pure — unit-tested. */
export function resolveMetaEffort(
	model: string,
	explicitEffort?: string | null,
): string {
	if (explicitEffort && explicitEffort !== "default") {
		const mapped = (EFFORT_MAP as Record<string, string>)[explicitEffort];
		if (mapped) return mapped;
		// Already a native Meta value (minimal/xhigh) — pass through.
		if (
			["minimal", "low", "medium", "high", "xhigh", "max"].includes(
				explicitEffort,
			)
		) {
			return explicitEffort === "max" ? "xhigh" : explicitEffort;
		}
	}
	const perModel = getEffortForModel(model);
	if (perModel && perModel !== "default") {
		return EFFORT_MAP[perModel] || "xhigh";
	}
	// Default: max thinking.
	return "xhigh";
}

export class MetaAdapter extends OpenAICompatAdapter {
	constructor(provider: string, baseUrl: string, apiKey: string) {
		super(provider, baseUrl || META_BASE_URL, apiKey);
	}

	protected buildRequest(
		model: string,
		messages: OpenAIMessage[],
		tools?: Record<string, unknown>,
		config?: Record<string, unknown>,
	): Record<string, unknown> {
		const body: Record<string, unknown> = {
			model,
			messages: this.serializeMessages(messages),
			stream: true,
		};

		if (tools && Object.keys(tools).length > 0) {
			body.tools = Object.entries(tools).map(([name, tool]: [string, any]) => ({
				type: "function",
				function: {
					name,
					description: tool.description || "",
					parameters: tool.parameters || {},
				},
			}));
		}
		if (config?.maxTokens) body.max_tokens = config.maxTokens;
		if (config?.temperature != null) body.temperature = config.temperature;
		if (config?.topP != null) body.top_p = config.topP;
		if ((config as any)?.stopSequences?.length)
			body.stop = (config as any).stopSequences;

		// Always maximum reasoning effort unless overridden per model.
		const explicitEffort =
			(config as any)?.providerOptions?.openai?.reasoningEffort ||
			(config as any)?.providerOptions?.meta?.reasoningEffort;
		body.reasoning_effort = resolveMetaEffort(model, explicitEffort);

		return body;
	}
}
