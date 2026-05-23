import { type BrowserContext, chromium } from 'playwright';
import { hasXAuthCookies } from '../src/browser/auth.js';
import { PostDetailScraper } from '../src/browser/post-detail.js';
import { PostProcessor } from '../src/browser/post-processor.js';
import { resolveBrowserProfilePath } from '../src/browser/profile.js';
import { applyStealthToContext, persistentContextOptions } from '../src/browser/stealth.js';
import { TabPool } from '../src/browser/tab-pool.js';
import { loadTweetDetailJson } from '../src/browser/tweet-detail-api.js';
import { loadConfig } from '../src/config/load.js';
import { createScrapeLogger } from '../src/logger.js';
import type { Post } from '../src/types/post.js';

export type LiveXSession = {
  context: BrowserContext;
  scraper: PostDetailScraper;
  scrape: (href: string) => Promise<Post>;
  loadTweetDetailJson: (href: string) => Promise<string | null>;
};

type SharedLiveSession = {
  promise: Promise<LiveXSession>;
  refs: number;
  teardown: () => Promise<void>;
};

let shared: SharedLiveSession | undefined;
let bootstrapPromise: Promise<SharedLiveSession> | undefined;

async function bootstrapSharedSession(configPath: string): Promise<SharedLiveSession> {
  const config = await loadConfig(configPath);
  const log = createScrapeLogger();
  const profilePath = resolveBrowserProfilePath(config);
  const context = await chromium.launchPersistentContext(
    profilePath,
    persistentContextOptions(true),
  );
  await applyStealthToContext(context);

  if (!(await hasXAuthCookies(context))) {
    await context.close();
    throw new Error(
      'Live X parser tests require auth cookies (auth_token + ct0) in the browser profile. Log in via pnpm run scrape first.',
    );
  }

  const pool = await TabPool.create(context, 1, log);
  const processor = new PostProcessor(log);
  const scraper = new PostDetailScraper(pool, processor, log);

  const session: LiveXSession = {
    context,
    scraper,
    scrape: (href: string) => scraper.scrape(href),
    loadTweetDetailJson: (href: string) => pool.run((page) => loadTweetDetailJson(page, href, log)),
  };

  return {
    promise: Promise.resolve(session),
    refs: 0,
    teardown: async () => {
      await pool.close();
      await context.close();
    },
  };
}

/** Acquire a ref-counted Playwright session shared across live X test files. */
export async function acquireLiveXSession(configPath = 'config.json'): Promise<LiveXSession> {
  bootstrapPromise ??= bootstrapSharedSession(configPath);
  shared ??= await bootstrapPromise;
  shared.refs++;
  return shared.promise;
}

/** Release a live session ref; closes Chrome when the last test file finishes. */
export async function releaseLiveXSession(): Promise<void> {
  if (!shared) {
    return;
  }
  shared.refs--;
  if (shared.refs <= 0) {
    const current = shared;
    shared = undefined;
    bootstrapPromise = undefined;
    await current.teardown();
  }
}

export function linkUrls(post: Post): string[] {
  return post.links?.map((link) => link.url) ?? post.linkUrls ?? [];
}

export function resolvedUrl(post: Post, includes: string): string | undefined {
  return linkUrls(post).find((url) => url.includes(includes));
}
