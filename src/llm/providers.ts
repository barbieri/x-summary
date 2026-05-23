import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { xai } from '@ai-sdk/xai';
import { openrouter as openrouterProvider } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { opencode } from 'ai-sdk-provider-opencode-sdk';
import type { LlmConfig, LlmProvider } from '../types/config.js';

export type ProviderFactory = (model: string) => LanguageModel;

const builtInFactories: Record<LlmProvider, ProviderFactory> = {
  openai: (model) => openai(model),
  anthropic: (model) => anthropic(model),
  google: (model) => google(model),
  xai: (model) => xai(model),
  openrouter: (model) => openrouterProvider(model),
  opencode: (model) => opencode(model),
};

const customFactories = new Map<string, ProviderFactory>();

/** Register an additional provider factory for future extensions. */
export function registerLlmProvider(provider: string, factory: ProviderFactory): void {
  customFactories.set(provider, factory);
}

export function createLanguageModel(llm: LlmConfig): LanguageModel {
  const builtIn = builtInFactories[llm.provider as LlmProvider];
  if (builtIn) {
    return builtIn(llm.model);
  }

  const custom = customFactories.get(llm.provider);
  if (custom) {
    return custom(llm.model);
  }

  throw new Error(
    `Unknown LLM provider "${llm.provider}". Built-in: ${Object.keys(builtInFactories).join(', ')}`,
  );
}

export function listBuiltInProviders(): readonly LlmProvider[] {
  return Object.keys(builtInFactories) as LlmProvider[];
}
