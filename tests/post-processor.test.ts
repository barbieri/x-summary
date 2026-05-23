import { describe, expect, it, vi } from 'vitest';
import { PostProcessor } from '../src/browser/post-processor.js';
import { createScrapeLogger } from '../src/logger.js';
import type { Post } from '../src/types/post.js';

vi.mock('../src/links/resolve.js', () => ({
  resolveLink: vi.fn(async (url: string) => ({ url })),
}));

describe('PostProcessor', () => {
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
});
