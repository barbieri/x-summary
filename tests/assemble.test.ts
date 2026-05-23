import { describe, expect, it } from 'vitest';
import { buildAppState, resolveScrapeCutoff } from '../src/state/assemble.js';
import type { AppConfig } from '../src/types/config.js';
import type { Post } from '../src/types/post.js';
import type { AppState } from '../src/types/state.js';

const config: AppConfig = {
  ownerHandle: 'alice',
  timeWindowMinutes: 60,
  statePath: './tmp/state.json',
  instructionsPath: './INSTRUCTIONS.md',
  monitored: [],
  headless: true,
  llm: { provider: 'openai', model: 'gpt-4.1' },
};

describe('resolveScrapeCutoff', () => {
  it('uses timeWindowMinutes when no previous state', () => {
    const now = Date.parse('2026-05-22T14:00:00.000Z');
    const { cutoffMs, cutoffTimestamp } = resolveScrapeCutoff(config, null, now);
    expect(cutoffTimestamp).toBe('2026-05-22T13:00:00.000Z');
    expect(cutoffMs).toBe(Date.parse('2026-05-22T13:00:00.000Z'));
  });

  it('uses previous state timestamp when incremental', () => {
    const previous: AppState = {
      timestamp: '2026-05-22T12:00:00.000Z',
      cutoffTimestamp: '2026-05-22T11:00:00.000Z',
      posts: {},
      following: [],
      forYouSuggestions: [],
      monitored: {},
    };
    const { cutoffMs, cutoffTimestamp } = resolveScrapeCutoff(config, previous);
    expect(cutoffTimestamp).toBe('2026-05-22T12:00:00.000Z');
    expect(cutoffMs).toBe(Date.parse('2026-05-22T12:00:00.000Z'));
  });
});

describe('buildAppState', () => {
  it('flattens posts into posts map and href feed lists', () => {
    const following: Post[] = [
      {
        href: 'https://x.com/alice/status/1',
        author: 'alice',
        timestamp: '2026-05-22T12:00:00.000Z',
        stats: { comments: 1, reposts: 0, likes: 0 },
        references: [
          {
            href: 'https://x.com/bob/status/2',
            author: 'bob',
            stats: { comments: 0, reposts: 0, likes: 0 },
          },
        ],
      },
    ];

    const state = buildAppState(
      '2026-05-22T13:00:00.000Z',
      '2026-05-22T12:00:00.000Z',
      following,
      [],
      {},
    );

    expect(state.cutoffTimestamp).toBe('2026-05-22T12:00:00.000Z');
    expect(state.following).toEqual(['https://x.com/alice/status/1']);
    expect(state.posts['https://x.com/alice/status/1']).toMatchObject({
      author: 'alice',
      references: ['https://x.com/bob/status/2'],
    });
    expect(state.posts['https://x.com/bob/status/2']).toMatchObject({
      author: 'bob',
    });
  });

  it('uses status URL in feed lists for synthetic repost href', () => {
    const statusUrl = 'https://x.com/alice/status/9';
    const following: Post[] = [
      {
        href: `repost://alice@${statusUrl}`,
        author: 'alice',
        stats: { comments: 0, reposts: 1, likes: 0 },
        references: [
          {
            href: 'https://x.com/bob/status/2',
            author: 'bob',
            stats: { comments: 0, reposts: 0, likes: 0 },
          },
        ],
      },
    ];

    const state = buildAppState(
      '2026-05-22T13:00:00.000Z',
      '2026-05-22T12:00:00.000Z',
      following,
      [],
      {},
    );
    expect(state.following).toEqual([statusUrl]);
    expect(state.posts[`repost://alice@${statusUrl}`]).toBeDefined();
  });
});
