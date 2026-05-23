import type { Locator, Page } from 'playwright';
import { DEFAULT_PARALLEL_TABS } from '../config/load.js';
import { createScrapeLogger, logScrapeFailure } from '../logger.js';
import { buildAppState, collectStateHrefs, resolveScrapeCutoff } from '../state/assemble.js';
import type { AppConfig } from '../types/config.js';
import type { Post } from '../types/post.js';
import type { AppState } from '../types/state.js';
import { canonicalFeedHref, readPostHref, readTimestamp } from './article-fields.js';
import { tracedClick, waitAfterDomAction, waitForUiSettled } from './interactions.js';
import { PostDetailScraper } from './post-detail.js';
import { normalizePostHref, PostProcessor } from './post-processor.js';
import { TabPool } from './tab-pool.js';
import {
  type FeedScrollKind,
  isAdTweet,
  scrollPastArticle,
  scrollTimelineDown,
  timelineTweetArticles,
} from './timeline.js';

export type ScrapeOptions = {
  config: AppConfig;
  previousState: AppState | null;
};

const FOLLOWING_TAB = 'Following';
const FOR_YOU_TAB = 'For you';
const RECENT_SORT = 'Recent';

type TimelineContext = {
  cutoffMs: number;
  stopHrefs: Set<string>;
  skipHrefs?: Set<string>;
  processor: PostProcessor;
  detailScraper: PostDetailScraper;
};

type FeedKind = 'home' | 'profile';

/**
 * Collect posts from Following (Recent), For You suggestions, and monitored profiles.
 * Following is scraped first; For You skips posts already seen in Following.
 */
export async function scrapeTimelines(page: Page, options: ScrapeOptions): Promise<AppState> {
  const log = createScrapeLogger();
  const { cutoffMs, cutoffTimestamp } = resolveScrapeCutoff(options.config, options.previousState);
  const previousHrefs = collectPreviousHrefs(options.previousState);
  const processor = new PostProcessor(log);
  const tabPool = await TabPool.create(
    page.context(),
    options.config.parallelTabs ?? DEFAULT_PARALLEL_TABS,
    log,
  );
  const detailScraper = new PostDetailScraper(tabPool, processor, log);

  log.info(
    {
      timeWindowMinutes: options.config.timeWindowMinutes,
      cutoffTimestamp,
      incremental: Boolean(options.previousState),
      parallelTabs: options.config.parallelTabs ?? DEFAULT_PARALLEL_TABS,
    },
    'starting scrape',
  );

  try {
    const followingCtx: TimelineContext = {
      cutoffMs,
      stopHrefs: previousHrefs,
      processor,
      detailScraper,
    };

    const following = await scrapeFollowingRecent(page, followingCtx, log);

    const followingHrefs = new Set<string>();
    for (const post of following) {
      followingHrefs.add(normalizePostHref(canonicalFeedHref(post.href)));
      processor.collectAllHrefs(post, followingHrefs);
    }
    log.info({ count: following.length, unique: followingHrefs.size }, 'following feed complete');

    const forYouSuggestions = await scrapeForYouSuggestions(
      page,
      {
        cutoffMs,
        stopHrefs: previousHrefs,
        skipHrefs: followingHrefs,
        processor,
        detailScraper,
      },
      log,
    );

    const monitored: Record<string, Post[]> = {};
    for (const handle of options.config.monitored) {
      log.info({ handle }, 'scraping monitored profile');
      monitored[handle] = await scrapeMonitoredProfile(
        page,
        handle,
        {
          cutoffMs,
          stopHrefs: previousHrefs,
          processor,
          detailScraper,
        },
        log,
      );
    }

    return buildAppState(
      new Date().toISOString(),
      cutoffTimestamp,
      following,
      forYouSuggestions,
      monitored,
    );
  } finally {
    await tabPool.close();
  }
}

async function scrapeFollowingRecent(
  page: Page,
  ctx: TimelineContext,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<Post[]> {
  log.info({ tab: FOLLOWING_TAB, sort: RECENT_SORT }, 'scraping following');
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await waitForUiSettled(page, log, 'home');
  await ensureFollowingTabSelected(page, log);
  await selectFollowingRecentSort(page, log);
  await page.keyboard.press('Escape');
  await waitAfterDomAction(page, log, 'close following sort menu');
  await timelineTweetArticles(page)
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);
  return scrollAndCollectPosts(page, ctx, log, 'following', 'home');
}

async function scrapeForYouSuggestions(
  page: Page,
  ctx: TimelineContext,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<Post[]> {
  log.info({ tab: FOR_YOU_TAB }, 'scraping for-you suggestions');
  await selectHomeTab(page, FOR_YOU_TAB, log);
  return scrollAndCollectPosts(page, ctx, log, 'forYouSuggestions', 'home');
}

async function scrapeMonitoredProfile(
  page: Page,
  handle: string,
  ctx: TimelineContext,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<Post[]> {
  const normalized = handle.replace(/^@/, '');
  log.info({ handle: normalized }, 'navigating to profile');
  await page.goto(`https://x.com/${normalized}`, { waitUntil: 'domcontentloaded' });
  await waitForUiSettled(page, log, `profile:${normalized}`);
  return scrollAndCollectPosts(page, ctx, log, `monitored:${normalized}`, 'profile');
}

async function selectHomeTab(
  page: Page,
  label: string,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<void> {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await waitForUiSettled(page, log, 'home');

  const tab = homeFeedTab(page, label);
  if (!(await tab.isVisible().catch(() => false))) {
    logScrapeFailure(log, {
      action: 'selectHomeTab',
      expected: `tab "${label}" visible`,
      missing: 'home tab',
      err: new Error(`Tab not found: ${label}`),
    });
    throw new Error(`Home tab not found: ${label}`);
  }

  await tracedClick(page, log, tab, `select tab ${label}`);
}

function homeFeedTab(page: Page, label: string): Locator {
  return page
    .locator('[data-testid="ScrollSnap-List"]')
    .getByRole('tab', { name: label, exact: true });
}

async function ensureFollowingTabSelected(
  page: Page,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<void> {
  const tab = homeFeedTab(page, FOLLOWING_TAB);
  if ((await tab.getAttribute('aria-selected')) === 'true') {
    return;
  }
  log.info({ action: 'select Following tab' }, 'interaction');
  await tab.click();
  await waitAfterDomAction(page, log, 'select Following tab');
}

function followingSortDropdown(page: Page): Locator {
  return page.getByRole('menu').filter({
    has: page.getByRole('menuitem', { name: RECENT_SORT, exact: true }),
  });
}

async function selectFollowingRecentSort(
  page: Page,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<void> {
  await ensureFollowingSortMenuOpen(page, log);

  if (await isFollowingSortSelected(page, RECENT_SORT)) {
    log.info({ sort: RECENT_SORT }, 'following sort already selected');
    await page.keyboard.press('Escape');
    return;
  }

  const recent = followingSortDropdown(page).getByRole('menuitem', {
    name: RECENT_SORT,
    exact: true,
  });
  if (!(await recent.isVisible().catch(() => false))) {
    log.warn({ sort: RECENT_SORT }, 'could not find Following sort menuitem; continuing');
    await page.keyboard.press('Escape');
    return;
  }

  await tracedClick(page, log, recent, `select following sort ${RECENT_SORT}`, { force: true });
}

async function ensureFollowingSortMenuOpen(
  page: Page,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<void> {
  const tab = homeFeedTab(page, FOLLOWING_TAB);
  await tab.waitFor({ state: 'visible', timeout: 15_000 });

  const dropdown = followingSortDropdown(page);
  if (await dropdown.isVisible().catch(() => false)) {
    return;
  }

  log.info({ action: 'Following tab (open sort menu)' }, 'interaction');
  await tab.click();
  await waitAfterDomAction(page, log, 'Following tab (open sort menu)');

  await followingSortDropdown(page)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => undefined);
}

async function isFollowingSortSelected(page: Page, sort: string): Promise<boolean> {
  const item = followingSortDropdown(page).getByRole('menuitem', { name: sort, exact: true });
  if (!(await item.count())) {
    return false;
  }
  return (await item.locator(':scope > div').nth(1).locator('svg').count()) > 0;
}

type ArticleStep = 'advanced' | 'continue' | 'stop';

async function stepTimelineArticle(
  page: Page,
  ctx: TimelineContext,
  article: Locator,
  seenInFeed: Set<string>,
  posts: Post[],
  feed: string,
  scrollKind: FeedScrollKind,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<ArticleStep> {
  if (await isAdTweet(article)) {
    return 'continue';
  }

  const href = await readPostHref(article);
  if (!href) {
    return 'continue';
  }

  const hrefKey = normalizePostHref(href);
  if (seenInFeed.has(hrefKey)) {
    return 'continue';
  }
  seenInFeed.add(hrefKey);

  if (ctx.skipHrefs?.has(hrefKey)) {
    log.debug({ href: hrefKey, feed }, 'skipping post already collected from Following');
    await scrollPastArticle(page, article, log, scrollKind);
    return 'advanced';
  }

  const timestamp = (await readTimestamp(article)).timestamp;
  const feedHrefKey = normalizePostHref(canonicalFeedHref(hrefKey));
  if (ctx.stopHrefs.has(feedHrefKey) || isOlderThanCutoffTimestamp(timestamp, ctx.cutoffMs)) {
    return 'stop';
  }

  log.debug({ href: hrefKey, feed }, 'scraping post detail');
  posts.push(await ctx.detailScraper.scrape(href));
  await scrollPastArticle(page, article, log, scrollKind);
  return 'advanced';
}

async function scrollForMoreTimelinePosts(
  page: Page,
  kind: FeedKind,
  scrollKind: FeedScrollKind,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<'moved' | 'stalled'> {
  const articleCount = await feedArticles(page, kind).count();
  const scrolled = await scrollTimelineDown(page, log, articleCount, scrollKind);
  return scrolled ? 'moved' : 'stalled';
}

async function advanceTimelineOnce(
  page: Page,
  ctx: TimelineContext,
  kind: FeedKind,
  seenInFeed: Set<string>,
  posts: Post[],
  feed: string,
  scrollKind: FeedScrollKind,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<ArticleStep> {
  const articles = feedArticles(page, kind);
  const count = await articles.count();

  for (let i = 0; i < count; i++) {
    const step = await stepTimelineArticle(
      page,
      ctx,
      articles.nth(i),
      seenInFeed,
      posts,
      feed,
      scrollKind,
      log,
    );
    if (step !== 'continue') {
      return step;
    }
  }

  return 'continue';
}

async function scrollAndCollectPosts(
  page: Page,
  ctx: TimelineContext,
  log: ReturnType<typeof createScrapeLogger>,
  feed: string,
  kind: FeedKind,
): Promise<Post[]> {
  const posts: Post[] = [];
  const seenInFeed = new Set<string>();
  let staleScrolls = 0;
  const scrollKind: FeedScrollKind = kind;

  for (let attempts = 0; attempts < 600; attempts++) {
    const step = await advanceTimelineOnce(
      page,
      ctx,
      kind,
      seenInFeed,
      posts,
      feed,
      scrollKind,
      log,
    );

    if (step === 'stop') {
      log.info(
        { feed, timelineItems: posts.length, reason: 'stop condition' },
        'timeline walk ended',
      );
      return posts;
    }

    if (step === 'advanced') {
      staleScrolls = 0;
      continue;
    }

    const scrollResult = await scrollForMoreTimelinePosts(page, kind, scrollKind, log);
    if (scrollResult === 'stalled') {
      staleScrolls++;
      if (staleScrolls >= 4) {
        log.info(
          { feed, timelineItems: posts.length, reason: 'stalled scroll' },
          'timeline walk ended',
        );
        break;
      }
    } else {
      staleScrolls = 0;
    }
  }

  log.info({ feed, timelineItems: posts.length, reason: 'iteration limit' }, 'timeline walk ended');
  return posts;
}

function feedArticles(page: Page, kind: FeedKind): Locator {
  if (kind === 'home') {
    return timelineTweetArticles(page);
  }
  return page.locator('article[data-testid="tweet"]');
}

function isOlderThanCutoffTimestamp(timestamp: string | undefined, cutoffMs: number): boolean {
  const ts = timestamp ? Date.parse(timestamp) : Number.NaN;
  return !Number.isNaN(ts) && ts < cutoffMs;
}

function collectPreviousHrefs(state: AppState | null): Set<string> {
  if (!state) {
    return new Set();
  }
  return collectStateHrefs(state);
}
