import { describe, expect, it, vi } from 'vitest';
import { PostProcessor } from '../src/browser/post-processor.js';
import { resolveLink } from '../src/links/resolve.js';
import { createScrapeLogger } from '../src/logger.js';
import { ScrapeTimeoutError, withTimeout } from '../src/scrape-timeouts.js';

vi.mock('../src/links/resolve.js', () => ({
  resolveLink: vi.fn(async (url: string) => ({ url, title: 'ok' })),
}));

describe('withTimeout', () => {
  it('rejects when the operation exceeds the limit', async () => {
    await expect(
      withTimeout(new Promise<void>(() => undefined), 20, 'slow task'),
    ).rejects.toBeInstanceOf(ScrapeTimeoutError);
  });
});

describe('PostProcessor link resolution', () => {
  it('keeps url-only link when resolution fails', async () => {
    vi.mocked(resolveLink).mockRejectedValueOnce(new Error('network down'));

    const processor = new PostProcessor(createScrapeLogger());
    const post = await processor.finalize(
      {
        href: 'https://x.com/a/status/1',
        stats: { comments: 0, reposts: 0, likes: 0 },
        linkUrls: ['https://example.com/article'],
      },
      new Set(),
    );

    expect(post.links).toEqual([{ url: 'https://example.com/article' }]);
  });
});
