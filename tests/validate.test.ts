import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/types/config.js';
import type { AppState } from '../src/types/state.js';
import { assertValid } from '../src/validate/ajv.js';
import { parseJson } from '../src/validate/json.js';

describe('config schema', () => {
  it('accepts a valid config', async () => {
    const config: AppConfig = {
      ownerHandle: 'alice',
      timeWindowMinutes: 30,
      statePath: './tmp/state.json',
      instructionsPath: './INSTRUCTIONS.md',
      monitored: ['bob'],
      headless: true,
      llm: { provider: 'openai', model: 'gpt-4.1' },
    };
    await expect(assertValid('config.schema.json', config, 'Config')).resolves.toEqual(config);
  });

  it('config.example.json validates against config.schema.json', async () => {
    const raw = await readFile(resolve('config.example.json'), 'utf8');
    const parsed = parseJson(raw);
    await expect(assertValid('config.schema.json', parsed, 'Config')).resolves.toBeDefined();
  });

  it('rejects temperature outside 0–2', async () => {
    await expect(
      assertValid(
        'config.schema.json',
        {
          ownerHandle: 'alice',
          timeWindowMinutes: 30,
          instructionsPath: './INSTRUCTIONS.md',
          monitored: [],
          llm: { provider: 'openai', model: 'gpt-4.1', temperature: 3 },
        },
        'Config',
      ),
    ).rejects.toThrow(/validation failed/i);
  });

  it('rejects unknown providers', async () => {
    await expect(
      assertValid(
        'config.schema.json',
        {
          ownerHandle: 'alice',
          timeWindowMinutes: 30,
          instructionsPath: './INSTRUCTIONS.md',
          monitored: [],
          llm: { provider: 'unknown', model: 'x' },
        },
        'Config',
      ),
    ).rejects.toThrow(/validation failed/i);
  });
});

describe('state schema', () => {
  it('accepts posts map with href-only feed lists', async () => {
    const state: AppState = {
      timestamp: new Date().toISOString(),
      cutoffTimestamp: '2026-05-22T11:00:00.000Z',
      posts: {
        'https://x.com/alice/status/1': {
          author: 'alice',
          timestamp: '2026-05-22T12:00:00.000Z',
          stats: { comments: 1, reposts: 2, likes: 3 },
          body: 'Hello https://example.com',
          links: [
            {
              url: 'https://example.com',
              title: 'Example',
              description: 'An example site',
            },
          ],
          references: ['https://x.com/bob/status/2'],
        },
        'https://x.com/bob/status/2': {
          author: 'bob',
          timestamp: '2026-05-22T11:00:00.000Z',
          stats: { comments: 0, reposts: 0, likes: 0 },
        },
      },
      following: ['https://x.com/alice/status/1'],
      forYouSuggestions: [],
      monitored: {},
    };
    await expect(assertValid('state.schema.json', state, 'State')).resolves.toEqual(state);
  });

  it('accepts nested references as href lists in posts', async () => {
    const state: AppState = {
      timestamp: new Date().toISOString(),
      cutoffTimestamp: '2026-05-22T11:00:00.000Z',
      posts: {
        'https://x.com/alice/status/1': {
          stats: { comments: 0, reposts: 0, likes: 0 },
          references: ['https://x.com/bob/status/2'],
        },
        'https://x.com/bob/status/2': {
          stats: { comments: 1, reposts: 0, likes: 0 },
          body: 'Quote of a quote',
          references: ['https://x.com/carol/status/3'],
        },
        'https://x.com/carol/status/3': {
          author: 'carol',
          stats: { comments: 0, reposts: 0, likes: 0 },
        },
      },
      following: ['https://x.com/alice/status/1'],
      forYouSuggestions: [],
      monitored: {},
    };
    await expect(assertValid('state.schema.json', state, 'State')).resolves.toEqual(state);
  });
});
