# Graph Report - antigravity-proxy  (2026-09-10)

## Corpus Check
- 142 files · ~121,228 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 940 nodes · 2111 edges · 68 communities (55 shown, 13 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- CLI Utilities
- Compaction and Routing
- OpenAI-Compatible Providers
- OpenCode Gateways
- Model Discovery
- Provider Plugins
- Project Documentation
- Database Persistence
- Tool Normalization
- Gemini Message Mapping
- Proxy Server Runtime
- Configuration Loading
- Responses API Translation
- Dashboard Configuration
- Quality and Bug Docs
- TypeScript Configuration
- Runtime Dependencies
- Pricing Data
- Dashboard Sessions
- Logging System
- User Data Paths
- Reasoning Effort
- Anthropic Adapter
- Response Streaming State
- Package Contents
- Certificate Generation
- Workspace Context Safety
- Package Metadata
- Request Store
- Google Adapter
- Provider Model Cache
- Development Dependencies
- Package Scripts
- Context Injection
- Model Blocklist
- Shell Launcher
- Rate Limiting
- Session Tracking
- Agent Operating Context
- macOS Launcher Tests
- Context Installer
- API Key Validation
- Safe Response Writes
- Test Runner
- Adapter Test Doubles
- Error Responses
- Dead Code Tests
- Package Version Tests
- Provider Cache Tests
- Windows Start Tests
- Bug Report Template
- Shell Env Tests
- Feature Request Template
- Platform Support Template
- Model Size Flags
- Release History
- Community Standards

## God Nodes (most connected - your core abstractions)
1. `createDashboardHandler()` - 46 edges
2. `OpenAIMessage` - 39 edges
3. `startCommand()` - 28 edges
4. `logger` - 27 edges
5. `handleStreamGenerate()` - 26 edges
6. `ModelResolver` - 25 edges
7. `header()` - 24 edges
8. `OpenAICompatAdapter` - 23 edges
9. `ModelAdapter` - 21 edges
10. `StreamChunk` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Contribution Quality Bar` --semantically_similar_to--> `Pull Request Verification Checklist`  [INFERRED] [semantically similar]
  CONTRIBUTING.md → .github/PULL_REQUEST_TEMPLATE.md
- `Plugin-Based Provider Architecture` --semantically_similar_to--> `Provider Plugin System`  [INFERRED] [semantically similar]
  docs/DEVELOPER.md → AGENTS.md
- `Gemini-to-Provider Format Translation` --semantically_similar_to--> `Universal LLM Translation Proxy`  [INFERRED] [semantically similar]
  CLAUDE.md → README.md
- `Automatic Context Compaction` --semantically_similar_to--> `Compressed External Agent Context`  [INFERRED] [semantically similar]
  docs/CONFIGURATION.md → CLAUDE.md
- `Antigravity Proxy Package Guide` --semantically_similar_to--> `Antigravity Proxy`  [INFERRED] [semantically similar]
  proxy/README.md → README.md

## Import Cycles
- 3-file cycle: `proxy/src/adapter.ts -> proxy/src/provider-registry.ts -> proxy/src/provider-plugin.ts -> proxy/src/adapter.ts`

## Hyperedges (group relationships)
- **Cross-Platform Contribution Quality Gate** — _github_workflows_ci_continuous_integration, _github_pull_request_template_verification_checklist, contributing_contribution_quality_bar, agents_ci_quality_gate [INFERRED 0.95]
- **Context Management and Privacy Modes** — claude_context_compression, security_context_forwarding_privacy, docs_configuration_auto_context_compaction, agent_context_lite_external_agent_runtime_context, agent_context_external_agent_runtime_context [INFERRED 0.85]
- **Provider Extensibility Architecture** — agents_provider_plugin_system, docs_developer_plugin_based_provider_architecture, readme_universal_llm_translation_proxy, docs_developer_local_provider_discovery [INFERRED 0.85]

## Communities (68 total, 13 thin omitted)

### Community 0 - "CLI Utilities"
Cohesion: 0.06
Nodes (96): ADMIN_COMMANDS, elevateAndRun(), isAdmin(), pkg, program, require, certsCommand(), configCommand() (+88 more)

### Community 1 - "Compaction and Routing"
Cohesion: 0.06
Nodes (29): createAdapter(), ProviderConfig, ProviderId, buildSummarizationPrompt(), compactIfNeeded(), getCompactionConfig(), needsCompaction(), selectMessagesToCompact() (+21 more)

### Community 2 - "OpenAI-Compatible Providers"
Cohesion: 0.12
Nodes (13): GroqAdapter, EFFORT_MAP, META_BASE_URL, META_DEFAULT_MODEL, MetaAdapter, resolveMetaEffort(), NvidiaAdapter, extractReasoning() (+5 more)

### Community 3 - "OpenCode Gateways"
Cohesion: 0.10
Nodes (22): GatewayMessagesAdapter, isThinkingRequiredError(), OpencodeGoAdapter, selectGoHandler(), streamWithThinkingRetry(), THINKING_ERROR_PATTERNS, VALID_THINKING_EFFORTS, selectZenHandler() (+14 more)

### Community 4 - "Model Discovery"
Cohesion: 0.09
Nodes (27): cachedResults, getCachedLocalProviders(), getCachedProvider(), getOnlineLocalProviders(), LOCAL_PROVIDERS, LocalProviderCapabilities, LocalProviderInfo, probeProvider() (+19 more)

### Community 5 - "Provider Plugins"
Cohesion: 0.12
Nodes (10): ModelAdapter, buildPlugin(), BUILTIN_PROVIDERS, ProviderDef, registerBuiltinPlugins(), DEFAULT_CAPABILITIES, IProviderPlugin, ProviderCapabilities (+2 more)

### Community 6 - "Project Documentation"
Cohesion: 0.07
Nodes (32): Compressed External Agent Context, Gemini-to-Provider Format Translation, Claude Code Repository Guidance, Universal Reasoning Extraction, Workspace Context Hardening, Automatic Context Compaction, Configuration Guide, Per-Provider Model Mapping (+24 more)

### Community 7 - "Database Persistence"
Cohesion: 0.07
Nodes (4): __dirname, ModelFlagInfo, NOTE: Cannot use logger here — logger.ts imports db.ts, creating a circular…, SMALL_MODEL_TOKENS

### Community 8 - "Tool Normalization"
Cohesion: 0.12
Nodes (16): normalizeToolArgs(), CoreTool, NormalizedToolCall, ToolCapabilityRegistry, ToolParamDef, ToolSchema, WELL_KNOWN_TOOLS, coerceValue() (+8 more)

### Community 9 - "Gemini Message Mapping"
Cohesion: 0.10
Nodes (25): callId(), collapseDuplicateToolPairs(), mapContentsToMessages(), mapGenerationConfig(), MappedConfig, mapSchema(), mapTools(), OpenAIContentPart (+17 more)

### Community 10 - "Proxy Server Runtime"
Cohesion: 0.11
Nodes (25): checkBlocked(), reloadRouter(), BULK_CONTEXT_TAGS, dashboardHandler, __dirname, estTokens(), forwardToGoogle(), genGoogleId() (+17 more)

### Community 11 - "Configuration Loading"
Cohesion: 0.12
Nodes (23): migrateConfig(), NOTE: This function intentionally does NOT use logger to avoid circular, CLI_DIR, __dirname, ENV_EXAMPLE, ENV_PATH, __filename, USER_CONFIG_DIR (+15 more)

### Community 12 - "Responses API Translation"
Cohesion: 0.18
Nodes (12): buildResponsesRequest(), contentToString(), GatewayResponsesAdapter, handleResponsesEvent(), responsesObjectToChunks(), toInputContent(), toResponsesInput(), DEFAULT_OPTS (+4 more)

### Community 13 - "Dashboard Configuration"
Cohesion: 0.13
Nodes (21): buildClearSessionCookie(), buildSessionCookie(), createSession(), destroySession(), getCookie(), getSession(), getSessionTtlMs(), isAuthEnabled() (+13 more)

### Community 14 - "Quality and Bug Docs"
Cohesion: 0.10
Nodes (21): Pull Request Template, Pull Request Verification Checklist, Typecheck Test Build Certificate Sequence, Continuous Integration Workflow, Operating System and Node.js Test Matrix, Cross-Platform CI Quality Gate, Project Operating Guide, Provider Plugin System (+13 more)

### Community 15 - "TypeScript Configuration"
Cohesion: 0.10
Nodes (19): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, outDir (+11 more)

### Community 16 - "Runtime Dependencies"
Cohesion: 0.12
Nodes (17): ai, better-sqlite3, chalk, commander, dotenv, node-forge, ora, dependencies (+9 more)

### Community 17 - "Pricing Data"
Cohesion: 0.14
Nodes (15): DEFAULT_FREE_PROVIDERS, __dirname, getAllPricing(), getPrice(), getProviderPricing(), isProviderFree(), load(), meta (+7 more)

### Community 18 - "Dashboard Sessions"
Cohesion: 0.16
Nodes (14): dashboardDir, dashboardHtml, deleteSessionFile(), __dirname, fileToSession(), getSessionDates(), getSessionsForDate(), invalidateSessionListCache() (+6 more)

### Community 19 - "Logging System"
Cohesion: 0.19
Nodes (13): clearLogBuffer(), ensureStream(), getLogStats(), getRecentLogs(), log(), LOG_LEVELS, LOG_MAX_AGE_DAYS, LOG_MAX_FILES (+5 more)

### Community 20 - "User Data Paths"
Cohesion: 0.15
Nodes (13): __dirname, ensureUserDataWritable(), migrateUserData(), MIGRATION_MARKER, OLD_CERTS_DIR, OLD_DATA_DIR, OLD_LOGS_DIR, USER_CERT_FILE (+5 more)

### Community 21 - "Reasoning Effort"
Cohesion: 0.16
Nodes (13): _config, CONFIG_PATH, __dirname, getReasoningEffortConfig(), getReasoningLabel(), loadFromDisk(), REASONING_EFFORT_PATTERNS, ReasoningEffort (+5 more)

### Community 23 - "Response Streaming State"
Cohesion: 0.24
Nodes (11): cleanupReasoningStore(), extractConvId(), generateResponse(), getRouter(), injectReasoning(), NOTE: toolAction/toolSummary/ToolAction/ToolSummary MUST be passed, ReasoningEntry, reasoningStore (+3 more)

### Community 24 - "Package Contents"
Cohesion: 0.17
Nodes (12): files, dist/, src/, agent-context.md, bin/, dashboard/, .env.example, models.json (+4 more)

### Community 25 - "Certificate Generation"
Cohesion: 0.17
Nodes (11): attrs, cert, certPem, __dirname, keyPem, keys, legacyCertsDir, now (+3 more)

### Community 26 - "Workspace Context Safety"
Cohesion: 0.27
Nodes (11): readAgentContextFull(), readAgentContextReference(), wrapContextFileToolResults(), anonymizePath(), EnvelopeMode, getBody(), getEnvelopeMode(), getMode() (+3 more)

### Community 27 - "Package Metadata"
Cohesion: 0.18
Nodes (10): bin, antigravity, description, engines, node, main, name, postinstall (+2 more)

### Community 30 - "Provider Model Cache"
Cohesion: 0.24
Nodes (9): cache, CachedModels, clearProviderCache(), fetchProviderModels(), getCachedProviderModels(), getMeta(), listKnownProviders(), PROVIDER_META (+1 more)

### Community 31 - "Development Dependencies"
Cohesion: 0.22
Nodes (9): devDependencies, tsx, @types/better-sqlite3, @types/node, typescript, tsx, @types/better-sqlite3, @types/node (+1 more)

### Community 32 - "Package Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, dev, gen-certs, prepublishOnly, start, start:prod, test (+1 more)

### Community 33 - "Context Injection"
Cohesion: 0.31
Nodes (6): ANTIGRAVITY_CONTEXT, __dirname, __dirname, getLiteContextContent(), injectContext(), NOTE: We do NOT inject a "Read the agent-context.md" user message.

### Community 34 - "Model Blocklist"
Cohesion: 0.25
Nodes (8): blocklist, BLOCKLIST_PATH, BlocklistData, __dirname, getBlocklist(), load(), reload(), saveBlocklist()

### Community 35 - "Shell Launcher"
Cohesion: 0.42
Nodes (8): as_user(), err(), info(), ok(), pids_on_port(), start.sh script, step(), warn()

### Community 36 - "Rate Limiting"
Cohesion: 0.25
Nodes (7): config, DEFAULT_CONFIG, getRateLimitConfig(), getRateLimitStats(), RateLimitConfig, resetRateLimits(), windows

### Community 37 - "Session Tracking"
Cohesion: 0.39
Nodes (6): cleanupSessionStore(), clearSessionId(), getSessionId(), SessionEntry, sessionStore, setSessionId()

### Community 38 - "Agent Operating Context"
Cohesion: 0.38
Nodes (7): Background Task Doctrine, External Agent Runtime Context, External Agent Runtime Context Lite, Subagent Doctrine Lite, Verification Doctrine Lite, Subagent Doctrine, Verification Doctrine

### Community 39 - "macOS Launcher Tests"
Cohesion: 0.29
Nodes (6): __dirname, openTs, portTs, repoRoot, startSh, startTs

### Community 40 - "Context Installer"
Cohesion: 0.73
Nodes (5): getDestPath(), getGlobalDir(), getMarkerPath(), hashFile(), installAgentContext()

### Community 42 - "API Key Validation"
Cohesion: 0.50
Nodes (4): DEFAULT_PROVIDER_CONFIGS, getMissingApiKeyVars(), validateApiKey(), config

### Community 44 - "Test Runner"
Cohesion: 0.40
Nodes (4): allTestFiles, args, child, __dirname

### Community 48 - "Package Version Tests"
Cohesion: 0.50
Nodes (3): __dirname, pkg, pkgPath

### Community 49 - "Provider Cache Tests"
Cohesion: 0.50
Nodes (3): __dirname, providerCache, providerCachePath

### Community 50 - "Windows Start Tests"
Cohesion: 0.50
Nodes (3): __dirname, startPs1, startPs1Path

### Community 51 - "Bug Report Template"
Cohesion: 0.67
Nodes (3): Bug Report Template, Bug Reproduction Evidence, Sanitized Proxy Logs

## Knowledge Gaps
- **248 isolated node(s):** `pkg`, `ADMIN_COMMANDS`, `program`, `name`, `version` (+243 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `shellCommand()` connect `CLI Utilities` to `Logging System`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `logger` connect `Responses API Translation` to `CLI Utilities`, `Compaction and Routing`, `OpenAI-Compatible Providers`, `Model Discovery`, `Provider Plugins`, `Tool Normalization`, `Gemini Message Mapping`, `Proxy Server Runtime`, `Configuration Loading`, `Dashboard Sessions`, `Logging System`, `Reasoning Effort`, `Response Streaming State`, `Provider Model Cache`, `Model Blocklist`, `Rate Limiting`, `Context Installer`, `API Key Validation`, `Safe Response Writes`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `OpenAIMessage` connect `OpenAI-Compatible Providers` to `Compaction and Routing`, `OpenCode Gateways`, `Provider Plugins`, `Gemini Message Mapping`, `Responses API Translation`, `Anthropic Adapter`, `Response Streaming State`, `Google Adapter`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `pkg`, `ADMIN_COMMANDS`, `program` to the rest of the system?**
  _248 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `CLI Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.064030131826742 - nodes in this community are weakly interconnected._
- **Should `Compaction and Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.06467661691542288 - nodes in this community are weakly interconnected._
- **Should `OpenAI-Compatible Providers` be split into smaller, more focused modules?**
  _Cohesion score 0.11605937921727395 - nodes in this community are weakly interconnected._