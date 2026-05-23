import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectStatusId } from '../src/browser/post-detail.js';
import {
  extractUrlsFromPlainText,
  parsePostFromTweetDetail,
} from '../src/browser/tweet-detail-api.js';
import { acquireLiveXSession, type LiveXSession, releaseLiveXSession } from './live-x-harness.js';
import { LIVE_X_POSTS } from './live-x-posts.js';
import {
  expectTweetDetailShapePreserved,
  extractTweetDetailParserShape,
} from './tweet-detail-shape.js';

const FIXTURES = resolve('tests/fixtures/tweet-detail');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf8');
}

function statusId(href: string): string {
  return expectStatusId(href);
}

describe('extractUrlsFromPlainText', () => {
  it('joins line-broken broadcast URLs', () => {
    const text = 'IRAN ALLOWED 35 SHIPS\nhttps://\nx.com/i/broadcasts/1YxNrrZZDqOxw…';
    expect(extractUrlsFromPlainText(text)).toEqual(['https://x.com/i/broadcasts/1YxNrrZZDqOxw']);
  });
});

describe.sequential('parsePostFromTweetDetail (live TweetDetail + fixture shape)', () => {
  let session: LiveXSession;

  beforeAll(async () => {
    session = await acquireLiveXSession();
  }, 120_000);

  afterAll(async () => {
    await releaseLiveXSession();
  }, 30_000);

  it('Mario quote with video media and nested broadcast reference', async () => {
    const href = LIVE_X_POSTS.marioQuoteBroadcast;
    const focalId = statusId(href);
    const fixtureJson = loadFixture('mario-quote.json');

    const liveJson = await session.loadTweetDetailJson(href);
    expect(liveJson, 'TweetDetail GraphQL response missing from live X').toBeTruthy();

    const liveShape = extractTweetDetailParserShape(liveJson as string, focalId);
    const fixtureShape = extractTweetDetailParserShape(fixtureJson, focalId);
    expect(liveShape).toBeTruthy();
    expect(fixtureShape).toBeTruthy();
    expectTweetDetailShapePreserved(
      liveShape as NonNullable<typeof liveShape>,
      fixtureShape as NonNullable<typeof fixtureShape>,
    );

    const post = parsePostFromTweetDetail(liveJson as string, focalId);
    expect(post?.body).toContain('Strait of Hormuz');
    expect(post?.references?.length).toBe(1);
    expect(expectStatusId(post?.references?.[0]?.href ?? '')).toBe(
      statusId(LIVE_X_POSTS.marioBroadcastQuoted),
    );
    expect(post?.references?.[0]?.body).toContain('IRAN ALLOWED 35 SHIPS');
    const urls = post?.linkUrls ?? [];
    expect(urls.some((url) => url.includes('pbs.twimg.com'))).toBe(true);
    expect(urls.some((url) => url.startsWith('blob:'))).toBe(false);
    const refUrls = post?.references?.[0]?.linkUrls ?? [];
    expect(refUrls.some((url) => url.includes('/i/broadcasts/'))).toBe(true);
  }, 120_000);

  it('Drew thread with pmarca parent', async () => {
    const href = LIVE_X_POSTS.drewThread;
    const focalId = statusId(href);
    const fixtureJson = loadFixture('drew-thread.json');

    const liveJson = await session.loadTweetDetailJson(href);
    expect(liveJson, 'TweetDetail GraphQL response missing from live X').toBeTruthy();

    const liveShape = extractTweetDetailParserShape(liveJson as string, focalId);
    const fixtureShape = extractTweetDetailParserShape(fixtureJson, focalId);
    expect(liveShape).toBeTruthy();
    expect(fixtureShape).toBeTruthy();
    expectTweetDetailShapePreserved(
      liveShape as NonNullable<typeof liveShape>,
      fixtureShape as NonNullable<typeof fixtureShape>,
    );

    const post = parsePostFromTweetDetail(liveJson as string, focalId);
    expect(post?.body).toContain('Needs brutalist data center');
    expect(post?.thread?.length).toBe(1);
    expect(expectStatusId(post?.thread?.[0]?.href ?? '')).toBe(
      statusId(LIVE_X_POSTS.pmarcaImproved),
    );
    expect(post?.linkUrls?.some((url) => url.includes('pbs.twimg.com/media/'))).toBe(true);
  }, 120_000);

  it('pmarca quote with Drew reference', async () => {
    const href = LIVE_X_POSTS.pmarcaRepostOooh;
    const focalId = statusId(href);
    const fixtureJson = loadFixture('pmarca-quote.json');

    const liveJson = await session.loadTweetDetailJson(href);
    expect(liveJson, 'TweetDetail GraphQL response missing from live X').toBeTruthy();

    const liveShape = extractTweetDetailParserShape(liveJson as string, focalId);
    const fixtureShape = extractTweetDetailParserShape(fixtureJson, focalId);
    expect(liveShape).toBeTruthy();
    expect(fixtureShape).toBeTruthy();
    expectTweetDetailShapePreserved(
      liveShape as NonNullable<typeof liveShape>,
      fixtureShape as NonNullable<typeof fixtureShape>,
    );

    const post = parsePostFromTweetDetail(liveJson as string, focalId);
    expect(post?.body).toContain('Oooh.');
    expect(post?.references?.length).toBe(1);
    expect(expectStatusId(post?.references?.[0]?.href ?? '')).toBe(
      statusId(LIVE_X_POSTS.drewThread),
    );
  }, 120_000);
});
