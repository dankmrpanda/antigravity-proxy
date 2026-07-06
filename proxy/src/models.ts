import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectModelCapabilities } from './model-capabilities.js';
import type { ModelCapabilities } from './model-capabilities.js';
import type { ProviderId } from './adapter.js';

export type RoutingMode = 'priority-chain' | 'per-model-per-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = path.resolve(__dirname, '..', 'models.json');

export type ProviderModelValue = string | string[];

export interface ProviderModelMap {
  [antigravityModel: string]: {
    [providerId: string]: ProviderModelValue;
  };
}

export class ModelResolver {
  private flatMap: Record<string, string> = {};
  private providerMap: ProviderModelMap = {};
  routingMode: RoutingMode = 'priority-chain';
  globalProviderPriority: ProviderId[] = ['openrouter', 'nvidia', 'anthropic', 'google', 'zen', 'opencode-go', 'openai', 'groq', 'ollama', 'vllm', 'lmstudio'];
  titleModel: string = '';
  fallbackModel: string = '';
  defaultProvider: ProviderId | '' = '';
  defaultModel: string = '';
  compactionEnabled: boolean = true;
  compactionThreshold: number = 0.8;
  compactionModel: string = '';
  compactionTailTurns: number = 2;

  constructor() {
    this.load();
  }

  load(): void {
    this.flatMap = {};
    this.providerMap = {};

    try {
      if (fs.existsSync(MODELS_PATH)) {
        const raw = fs.readFileSync(MODELS_PATH, 'utf-8');
        const file = JSON.parse(raw);
        if (file._provider_models) {
          this.providerMap = file._provider_models;
        }
        if (file._routing_mode === 'per-model-per-provider' || file._routing_mode === 'priority-chain') {
          this.routingMode = file._routing_mode;
        }
        if (Array.isArray(file._global_provider_priority)) {
          this.globalProviderPriority = file._global_provider_priority;
        }
        if (typeof file._title_model === 'string') {
          this.titleModel = file._title_model;
        }
        if (typeof file._fallback_model === 'string') {
          this.fallbackModel = file._fallback_model;
        }
        if (typeof file._default_provider === 'string') {
          this.defaultProvider = file._default_provider as ProviderId;
        }
        if (typeof file._default_model === 'string') {
          this.defaultModel = file._default_model;
        }
        if (typeof file._compaction_enabled === 'boolean') {
          this.compactionEnabled = file._compaction_enabled;
        }
        if (typeof file._compaction_threshold === 'number') {
          this.compactionThreshold = file._compaction_threshold;
        }
        if (typeof file._compaction_model === 'string') {
          this.compactionModel = file._compaction_model;
        }
        if (typeof file._compaction_tail_turns === 'number') {
          this.compactionTailTurns = file._compaction_tail_turns;
        }
        for (const [k, v] of Object.entries(file)) {
          if (!k.startsWith('_')) this.flatMap[k] = String(v);
        }
      }
    } catch { /* use defaults */ }
  }

  reload(): void {
    this.load();
  }

  private extractPrimary(value: ProviderModelValue): string {
    return Array.isArray(value) ? value[0] : value;
  }

  getDefaultModel(providerId?: string): string {
    if (providerId) {
      const fromProviderMap = this.providerMap['default']?.[providerId];
      if (fromProviderMap != null) return this.extractPrimary(fromProviderMap);
    }
    return this.flatMap['default'] || '';
  }

  /**
   * Returns the full list of fallback models for a given antigravity model + provider.
   * Falls back to the resolved primary model as a single-element array if no mapping exists.
   */
  getFallbackModels(model: string, providerId: string): string[] {
    const value = this.providerMap[model]?.[providerId];
    if (value != null) {
      return Array.isArray(value) ? [...value] : [value];
    }
    const short = model.replace(/^models\//, '');
    if (short !== model) {
      const shortValue = this.providerMap[short]?.[providerId];
      if (shortValue != null) {
        return Array.isArray(shortValue) ? [...shortValue] : [shortValue];
      }
    }
    const primary = this.findPrimaryModel(short);
    if (primary) {
      const primaryValue = this.providerMap[primary]?.[providerId];
      if (primaryValue != null) {
        return Array.isArray(primaryValue) ? [...primaryValue] : [primaryValue];
      }
    }
    return [short || model];
  }

  resolve(model: string, providerId?: string): string {
    if (providerId && this.providerMap[model]?.[providerId] != null) {
      return this.extractPrimary(this.providerMap[model][providerId]);
    }
    const short = model.replace(/^models\//, '');
    if (short !== model && providerId && this.providerMap[short]?.[providerId] != null) {
      return this.extractPrimary(this.providerMap[short][providerId]);
    }
    if (this.flatMap[model]) return this.flatMap[model];
    if (this.flatMap[short]) return this.flatMap[short];
    for (const key of Object.keys(this.flatMap)) {
      if (key === 'default') continue;
      if (short.startsWith(key) || key.startsWith(short)) return this.flatMap[key];
    }
    const primary = this.findPrimaryModel(short);
    if (primary && providerId && this.providerMap[primary]?.[providerId] != null) {
      return this.extractPrimary(this.providerMap[primary][providerId]);
    }
    return short || model;
  }

  getProvidersForModel(model: string): string[] | null {
    const exact = this.providerMap[model];
    if (exact) return Object.keys(exact);
    const short = model.replace(/^models\//, '');
    if (short !== model) {
      const exactShort = this.providerMap[short];
      if (exactShort) return Object.keys(exactShort);
    }
    const primary = this.findPrimaryModel(short);
    if (primary && primary !== short) {
      const primaryProviders = this.providerMap[primary];
      if (primaryProviders) return Object.keys(primaryProviders);
    }
    // Reverse lookup: model starts with config key (e.g., "gemini-3.5-flash-extra-low" → "gemini-3.5-flash")
    // OR config key starts with model (e.g., "gemini-3-flash" → "gemini-3.5-flash")
    // Exact match above already catches exact variant names, so this only runs for unmatched names.
    for (const key of Object.keys(this.providerMap)) {
      if (key === 'default' || key === short) continue;
      if (short.startsWith(key + '-') || key.startsWith(short + '-')) {
        const keyProviders = this.providerMap[key];
        if (keyProviders) return Object.keys(keyProviders);
      }
    }
    return null;
  }

  private findPrimaryModel(model: string): string | null {
    for (const key of Object.keys(this.providerMap)) {
      if (key === 'default' || key === model) continue;
      // Config key "claude-sonnet-4-6-thinking" should match model "claude-sonnet-4-6"
      // because the key starts with the model + "-" (the key is a longer variant).
      if (key.startsWith(model + '-')) return key;
    }
    const stripped = model.replace(/-thinking$/, '');
    if (stripped !== model && this.providerMap[stripped]) return stripped;
    for (const key of Object.keys(this.providerMap)) {
      if (key === 'default' || key === stripped) continue;
      if (key.startsWith(stripped + '-')) return key;
    }
    return null;
  }

  hasModel(model: string): boolean {
    const short = model.replace(/^models\//, '');
    if (this.providerMap[model] || this.providerMap[short]) return true;
    if (this.flatMap[model] || this.flatMap[short]) return true;
    for (const key of Object.keys(this.flatMap)) {
      if (key === 'default') continue;
      if (short.startsWith(key) || key.startsWith(short)) return true;
    }
    return false;
  }

  getFlatMap(): Record<string, string> {
    return { ...this.flatMap };
  }

  getProviderMap(): ProviderModelMap {
    return JSON.parse(JSON.stringify(this.providerMap));
  }

  /**
   * Detect capabilities for a model by its name.
   * Uses pattern matching on the resolved model name.
   */
  getCapabilities(modelOrResolved: string): ModelCapabilities {
    return detectModelCapabilities(modelOrResolved);
  }

  /**
   * Resolve a model name and then detect its capabilities.
   */
  resolveWithCapabilities(model: string, providerId?: string): { resolvedModel: string; capabilities: ModelCapabilities } {
    const resolvedModel = this.resolve(model, providerId);
    return {
      resolvedModel,
      capabilities: detectModelCapabilities(resolvedModel),
    };
  }
}

export const modelResolver = new ModelResolver();
