/**
 * Unit tests for the Meta Model API adapter (direct api.meta.ai integration).
 *
 * Meta Model API is OpenAI Chat Completions compatible:
 *   POST https://api.meta.ai/v1/chat/completions
 *   Auth: Bearer MODEL_API_KEY
 *   Models: muse-spark-1.3 (latest), muse-spark-1.3-contributor, 1.2, 1.1
 *
 * Reasoning: top-level `reasoning_effort` (none < minimal < low < medium <
 * high < xhigh). `xhigh` is the public maximum; the proxy's `max` level maps
 * to it. Default is max thinking (xhigh).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	META_BASE_URL,
	MetaAdapter,
	resolveMetaEffort,
} from "../src/adapters/meta.js";
import { registerBuiltinPlugins } from "../src/plugins/builtin-plugins.js";
import { providerRegistry } from "../src/provider-registry.js";
import {
	getReasoningLabel,
	supportsReasoningEffort,
} from "../src/reasoning-effort.js";

test("Meta: base URL defaults to api.meta.ai/v1", () => {
	assert.equal(META_BASE_URL, "https://api.meta.ai/v1");
	const adapter = new MetaAdapter("meta", "", "test-key");
	assert.equal((adapter as any).baseUrl, "https://api.meta.ai/v1");
});

test("Meta: defaults to xhigh (max thinking) with no config", () => {
	const adapter = new MetaAdapter("meta", META_BASE_URL, "test-key");
	const body = (adapter as any).buildRequest(
		"muse-spark-1.3",
		[{ role: "user", content: "hi" }],
		undefined,
		{},
	) as any;
	assert.equal(body.reasoning_effort, "xhigh", "must default to max thinking");
	assert.equal(body.model, "muse-spark-1.3");
	assert.equal(body.stream, true);
});

test("Meta: proxy max maps to xhigh", () => {
	assert.equal(resolveMetaEffort("muse-spark-1.3", "max"), "xhigh");
});

test("Meta: high/medium/low pass through", () => {
	assert.equal(resolveMetaEffort("muse-spark-1.3", "high"), "high");
	assert.equal(resolveMetaEffort("muse-spark-1.3", "medium"), "medium");
	assert.equal(resolveMetaEffort("muse-spark-1.3", "low"), "low");
});

test("Meta: native minimal/xhigh pass through", () => {
	assert.equal(resolveMetaEffort("muse-spark-1.3", "minimal"), "minimal");
	assert.equal(resolveMetaEffort("muse-spark-1.3", "xhigh"), "xhigh");
});

test("Meta: explicit providerOptions effort is honored", () => {
	const adapter = new MetaAdapter("meta", META_BASE_URL, "test-key");
	const body = (adapter as any).buildRequest(
		"muse-spark-1.3",
		[{ role: "user", content: "hi" }],
		undefined,
		{ providerOptions: { openai: { reasoningEffort: "low" } } },
	) as any;
	assert.equal(body.reasoning_effort, "low");
});

test("Meta: meta-scoped providerOptions effort is honored", () => {
	const adapter = new MetaAdapter("meta", META_BASE_URL, "test-key");
	const body = (adapter as any).buildRequest(
		"muse-spark-1.3",
		[{ role: "user", content: "hi" }],
		undefined,
		{ providerOptions: { meta: { reasoningEffort: "medium" } } },
	) as any;
	assert.equal(body.reasoning_effort, "medium");
});

test("Meta: serializes tools in OpenAI format", () => {
	const adapter = new MetaAdapter("meta", META_BASE_URL, "test-key");
	const tools = {
		get_weather: {
			description: "Get weather",
			parameters: {
				type: "object",
				properties: { location: { type: "string" } },
			},
		},
	};
	const body = (adapter as any).buildRequest(
		"muse-spark-1.3",
		[{ role: "user", content: "hi" }],
		tools,
		{},
	) as any;
	assert.equal(body.tools.length, 1);
	assert.equal(body.tools[0].type, "function");
	assert.equal(body.tools[0].function.name, "get_weather");
	assert.equal(body.reasoning_effort, "xhigh");
});

test("Meta: passes standard params correctly", () => {
	const adapter = new MetaAdapter("meta", META_BASE_URL, "test-key");
	const body = (adapter as any).buildRequest(
		"muse-spark-1.3",
		[{ role: "user", content: "hi" }],
		undefined,
		{ maxTokens: 8000, temperature: 0.3, topP: 0.95, stopSequences: ["STOP"] },
	) as any;
	assert.equal(body.max_tokens, 8000);
	assert.equal(body.temperature, 0.3);
	assert.equal(body.top_p, 0.95);
	assert.deepEqual(body.stop, ["STOP"]);
});

test("Meta: reasoning-effort registry recognizes muse-spark", () => {
	assert.ok(
		supportsReasoningEffort("muse-spark-1.3"),
		"muse-spark-1.3 should support reasoning effort",
	);
	assert.ok(
		supportsReasoningEffort("muse-spark-1.3-contributor"),
		"contributor variant should match",
	);
	assert.equal(getReasoningLabel("muse-spark-1.3"), "Muse Spark");
});

test("Meta: provider plugin is registered with correct defaults", () => {
	registerBuiltinPlugins();
	assert.ok(
		providerRegistry.hasProvider("meta"),
		"meta provider should be registered",
	);
	const caps = providerRegistry.getCapabilities("meta");
	assert.equal(caps?.supportsReasoning, true);
	assert.equal(caps?.supportsStreaming, true);
	assert.equal(caps?.supportsTools, true);
});
