import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectStatusHref, expectStatusId } from '../src/browser/post-detail.js';
import {
  acquireLiveXSession,
  type LiveXSession,
  linkUrls,
  releaseLiveXSession,
  resolvedUrl,
} from './live-x-harness.js';
import { LIVE_X_POSTS as POSTS } from './live-x-posts.js';

describe.sequential('live X post parsing', () => {
  let session: LiveXSession;

  beforeAll(async () => {
    session = await acquireLiveXSession();
  }, 120_000);

  afterAll(async () => {
    await releaseLiveXSession();
  }, 30_000);

  it('pmarca repost with body "Oooh." references DrewPavlou thread post', async () => {
    const post = await session.scrape(POSTS.pmarcaRepostOooh);
    expect(post.body).toContain('Oooh.');
    expect(post.references?.length ?? 0).toBeGreaterThan(0);
    expect(expectStatusId(post.references?.[0]?.href ?? '')).toBe(expectStatusId(POSTS.drewThread));
  }, 120_000);

  it('DrewPavlou thread item with brutalist data center and pmarca parent', async () => {
    const post = await session.scrape(POSTS.drewThread);
    expect(post.body).toContain('Needs brutalist data center');
    expect(post.thread?.length ?? 0).toBeGreaterThan(0);
    expect(expectStatusId(post.thread?.[0]?.href ?? '')).toBe(expectStatusId(POSTS.pmarcaImproved));
  }, 120_000);

  it('pmarca repost "Improved it!" with image and JeremyTate original', async () => {
    const post = await session.scrape(POSTS.pmarcaImproved);
    expect(post.body).toContain('Improved it!');
    const urls = linkUrls(post);
    expect(urls.some((url) => url.includes('pbs.twimg.com/media/HI9zximbgAAxUUw'))).toBe(true);
    expect(post.references?.length ?? 0).toBeGreaterThan(0);
    expect(expectStatusId(post.references?.[0]?.href ?? '')).toBe(
      expectStatusId(POSTS.jeremyMedieval),
    );
  }, 120_000);

  it('JeremyTate medieval street post with image', async () => {
    const post = await session.scrape(POSTS.jeremyMedieval);
    expect(post.body).toContain('best preserved medieval street');
    expect(post.body).toContain('Domesday Book');
    const urls = linkUrls(post);
    expect(urls.some((url) => url.includes('pbs.twimg.com/media/HI9GgLyXAAA62ZI'))).toBe(true);
  }, 120_000);

  it('MarioNawfal mask experiment post with embedded video', async () => {
    const post = await session.scrape(POSTS.marioMask);
    expect(post.body).toContain('Mind-blowing experiment');
    expect(post.body).toContain('silicone masks');
    const urls = linkUrls(post);
    expect(urls.some((url) => url.includes('pbs.twimg.com'))).toBe(true);
    expect(urls.some((url) => url.startsWith('blob:'))).toBe(false);
  }, 120_000);

  it('MarioNawfal quote of broadcast post resolves quoted status via TweetDetail', async () => {
    const post = await session.scrape(POSTS.marioQuoteBroadcast);
    expect(post.body).toContain('Strait of Hormuz');
    expect(post.references?.length ?? 0).toBeGreaterThan(0);
    expect(expectStatusId(post.references?.[0]?.href ?? '')).toBe(
      expectStatusId(POSTS.marioBroadcastQuoted),
    );
    const quoted = post.references?.[0];
    expect(quoted?.body).toContain('IRAN ALLOWED 35 SHIPS');
    const urls = linkUrls(quoted ?? post);
    expect(urls.some((url) => url.includes('/i/broadcasts/'))).toBe(true);
    expect(urls.some((url) => url.startsWith('blob:'))).toBe(false);
  }, 180_000);

  it('TheEconomist post with t.co link resolving to economist.com', async () => {
    const post = await session.scrape(POSTS.economistJapan);
    expect(post.body).toContain('Japan');
    expect(post.body).toContain('deflation');
    const economist = resolvedUrl(post, 'economist.com');
    expect(economist).toBeDefined();
    expect(expectStatusHref(economist ?? '')).toContain('economist.com/china');
  }, 120_000);

  it('SpaceX Starship post with t.co link resolving to spacex.com', async () => {
    const post = await session.scrape(POSTS.spacexStarship);
    expect(post.body).toMatch(/Starship V3/i);
    const spacex = resolvedUrl(post, 'spacex.com');
    expect(spacex).toBeDefined();
    expect(expectStatusHref(spacex ?? '')).toContain('spacex.com/launches/starship');
  }, 120_000);
});
