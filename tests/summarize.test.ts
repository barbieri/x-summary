import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSummarizePrompt, summarizeState } from '../src/llm/summarize.js';
import type { AppConfig } from '../src/types/config.js';
import type { AppState } from '../src/types/state.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => 'Summarize nothing.'),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'LLM summary' })),
}));

vi.mock('../src/llm/providers.js', () => ({
  createLanguageModel: vi.fn(() => ({})),
}));

const emptyState: AppState = {
  timestamp: '2026-05-22T12:00:00.000Z',
  cutoffTimestamp: '2026-05-22T11:00:00.000Z',
  posts: {},
  following: [],
  forYouSuggestions: [],
  monitored: {},
};

const baseConfig: AppConfig = {
  ownerHandle: 'alice',
  timeWindowMinutes: 60,
  statePath: './tmp/state.json',
  instructionsPath: './INSTRUCTIONS.md',
  monitored: [],
  headless: true,
  llm: { provider: 'openai', model: 'gpt-4.1' },
};

describe('buildSummarizePrompt', () => {
  it('includes instructions and minified state', () => {
    const { system, prompt } = buildSummarizePrompt('Be brief.', emptyState);
    expect(system).toContain('Be brief.');
    expect(prompt).toContain('# STATE (minified)');
    expect(prompt).toContain(JSON.stringify(emptyState));
  });

  it('includes timezone when provided', () => {
    const config = { timezone: 'America/Sao_Paulo' } as AppConfig;
    const { system } = buildSummarizePrompt('Be brief.', emptyState, config);
    expect(system).toContain('America/Sao_Paulo');
  });
});

describe('summarizeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty string without calling the LLM when posts map is empty', async () => {
    const { generateText } = await import('ai');
    const summary = await summarizeState(baseConfig, emptyState);
    expect(summary).toBe('');
    expect(generateText).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('calls the LLM when summarizeNoPosts is true', async () => {
    const { generateText } = await import('ai');
    const summary = await summarizeState({ ...baseConfig, summarizeNoPosts: true }, emptyState);
    expect(summary).toBe('LLM summary');
    expect(generateText).toHaveBeenCalledOnce();
    expect(readFile).toHaveBeenCalledWith('./INSTRUCTIONS.md', 'utf8');
  });
});
