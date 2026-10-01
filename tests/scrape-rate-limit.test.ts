import { EventEmitter } from 'node:events';
import type { Page, Response } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { FeedRateLimit } from '../src/browser/rate-limit.js';

describe('FeedRateLimit', () => {
  it('backs off with bounded retries then aborts a throttled feed', async () => {
    const emitter = new EventEmitter();
    const waitForTimeout = vi.fn(async () => {
      emitter.emit('response', { status: () => 429, url: () => 'https://x.com/i/api/graphql' });
    });
    const page = Object.assign(emitter, { waitForTimeout }) as unknown as Page;
    const limiter = new FeedRateLimit(page);
    emitter.emit('response', {
      status: () => 429,
      url: () => 'https://x.com/i/api/settings',
    } as Partial<Response>);
    expect(await limiter.backoff()).toBe(false);
    expect(await limiter.backoff()).toBe(false);
    expect(await limiter.backoff()).toBe(false);
    expect(await limiter.backoff()).toBe(true);
    expect(waitForTimeout.mock.calls).toHaveLength(3);
    limiter.detach();
  });
});
