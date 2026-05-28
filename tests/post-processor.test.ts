import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostProcessor } from '../src/browser/post-processor.js';
import { resolveLink } from '../src/links/resolve.js';
import { createScrapeLogger } from '../src/logger.js';
import { buildAppState } from '../src/state/assemble.js';
import type { Post } from '../src/types/post.js';
import { assertValid } from '../src/validate/ajv.js';

vi.mock('../src/links/resolve.js', () => ({
  resolveLink: vi.fn(async (url: string) => ({ url })),
}));

describe('PostProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops nesting at cycle detection', async () => {
    const log = createScrapeLogger();
    const processor = new PostProcessor(log);

    const a: Post = {
      href: 'https://x.com/a/status/1',
      author: 'a',
      timestamp: '2026-05-22T12:00:00.000Z',
      stats: { comments: 0, reposts: 0, likes: 0 },
      references: [
        {
          href: 'https://x.com/b/status/2',
          author: 'b',
          timestamp: '2026-05-22T12:00:00.000Z',
          stats: { comments: 0, reposts: 0, likes: 0 },
          references: [
            {
              href: 'https://x.com/a/status/1',
              author: 'a',
              timestamp: '2026-05-22T12:00:00.000Z',
              stats: { comments: 0, reposts: 0, likes: 0 },
            },
          ],
        },
      ],
    };

    const result = await processor.finalize(a, new Set());
    expect(result.references).toHaveLength(1);
    expect(result.references?.[0]?.references ?? []).toHaveLength(0);
  });

  it('reuses cached posts by href', async () => {
    const log = createScrapeLogger();
    const processor = new PostProcessor(log);
    const post: Post = {
      href: 'https://x.com/a/status/1',
      author: 'a',
      timestamp: '2026-05-22T12:00:00.000Z',
      stats: { comments: 0, reposts: 0, likes: 0 },
      body: 'hi',
    };
    const first = await processor.finalize(post, new Set());
    const second = processor.getCached('https://x.com/a/status/1');
    expect(second).toEqual(first);
  });

  it('skips invalid raw link URLs before persisting state', async () => {
    const log = createScrapeLogger();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const processor = new PostProcessor(log);

    const post = await processor.finalize(
      {
        href: 'https://x.com/doodlestein/status/2052910351474209258',
        author: 'doodlestein',
        timestamp: '2026-05-22T12:00:00.000Z',
        stats: { comments: 0, reposts: 0, likes: 0 },
        linkUrls: [
          'https://example.com/ok',
          'blob:https://x.com/video',
          'not a url',
          'https://example.com/ok',
        ],
      },
      new Set(),
    );

    expect(resolveLink).toHaveBeenCalledTimes(1);
    expect(post.links).toEqual([{ url: 'https://example.com/ok' }]);
    expect(warn).toHaveBeenCalledWith(
      { url: 'blob:https://x.com/video' },
      'invalid external link skipped',
    );
    expect(warn).toHaveBeenCalledWith({ url: 'not a url' }, 'invalid external link skipped');

    const state = buildAppState(
      '2026-05-22T13:00:00.000Z',
      '2026-05-22T12:00:00.000Z',
      [post],
      [],
      {},
    );
    await expect(assertValid('state.schema.json', state, 'State')).resolves.toEqual(state);
  });

  it('skips resolver results that are not valid state link URLs', async () => {
    vi.mocked(resolveLink).mockResolvedValueOnce({ url: 'not a uri' });
    const log = createScrapeLogger();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const processor = new PostProcessor(log);

    const post = await processor.finalize(
      {
        href: 'https://x.com/a/status/1',
        stats: { comments: 0, reposts: 0, likes: 0 },
        linkUrls: ['https://example.com/bad-redirect'],
      },
      new Set(),
    );

    expect(post.links).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      { url: 'https://example.com/bad-redirect', resolved: { url: 'not a uri' } },
      'resolved external link is invalid; skipping',
    );
  });
});
