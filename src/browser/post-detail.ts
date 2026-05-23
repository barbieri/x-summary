import type { Locator, Page } from 'playwright';
import { logScrapeFailure, type ScrapeLogger } from '../logger.js';
import { POST_DETAIL_PARSE_TIMEOUT_MS, withTimeout } from '../scrape-timeouts.js';
import type { Post } from '../types/post.js';
import {
  canonicalStatusHref,
  normalizeStatusPageUrl,
  readAuthor,
  readPostHref,
  readStats,
  readTimestamp,
  statusIdFromHref,
  syntheticRepostHref,
} from './article-fields.js';
import { waitAfterDomAction, waitForConversationReady } from './interactions.js';
import { normalizePostHref, type PostProcessor } from './post-processor.js';
import { postStub } from './post-stub.js';
import type { TabPool } from './tab-pool.js';
import { readOwnTweetBodyMarkdown } from './tweet-body.js';
import { loadTweetDetailJson, parsePostFromTweetDetail } from './tweet-detail-api.js';

/** When set, nested scrapes reuse this tab and restore `returnHref` afterward (avoids pool deadlock). */
export type NestedScrapeContext = {
  page: Page;
  returnHref: string;
};

const CONVERSATION_LABEL = 'Timeline: Conversation';

/** Pool-backed scraper with href deduplication for parallel detail parsing. */
export class PostDetailScraper {
  private readonly pool: TabPool;
  private readonly processor: PostProcessor;
  private readonly log: ScrapeLogger;
  private readonly inFlight = new Map<string, Promise<Post>>();

  constructor(pool: TabPool, processor: PostProcessor, log: ScrapeLogger) {
    this.pool = pool;
    this.processor = processor;
    this.log = log;
  }

  async scrapeMany(hrefs: string[]): Promise<Post[]> {
    return Promise.all(hrefs.map((href) => this.scrape(href)));
  }

  async scrape(href: string, nested?: NestedScrapeContext): Promise<Post> {
    const key = normalizePostHref(href);
    const cached = this.processor.getCached(key);
    if (cached) {
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      if (nested) {
        this.log.warn(
          { href: key },
          'nested scrape skipped; same href already in flight (would deadlock)',
        );
        return postStub(href);
      }
      this.log.debug({ href: key }, 'awaiting in-flight post detail scrape');
      return pending;
    }

    const task = this.runScrape(href, nested);
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }

  scrapeLinked(page: Page, href: string, returnHref: string): Promise<Post> {
    return this.scrape(href, { page, returnHref });
  }

  private async runScrape(href: string, nested?: NestedScrapeContext): Promise<Post> {
    const key = normalizePostHref(href);
    const parseWork = nested
      ? () => this.parseOnPage(nested.page, href, nested.returnHref)
      : () => this.pool.run((page) => this.parseOnPage(page, href));

    let post: Post;
    try {
      post = await withTimeout(parseWork(), POST_DETAIL_PARSE_TIMEOUT_MS, `post detail ${key}`);
    } catch (err: unknown) {
      return this.failPost(href, err);
    }

    const finalized = await this.processor.finalize(post, new Set());
    this.processor.remember(finalized);
    return finalized;
  }

  private failPost(href: string, err: unknown): Post {
    logScrapeFailure(this.log, {
      action: 'scrapePostDetail',
      expected: 'TweetDetail GraphQL or conversation timeline',
      href,
      err,
    });
    const stub = postStub(href);
    this.processor.remember(stub);
    return stub;
  }

  private async parseOnPage(page: Page, href: string, returnHref?: string): Promise<Post> {
    const restoreHref = returnHref ? normalizeStatusPageUrl(returnHref) : undefined;
    const focalId = statusIdFromHref(href);

    try {
      if (focalId) {
        const json = await loadTweetDetailJson(page, href, this.log);
        if (json) {
          const post = parsePostFromTweetDetail(json, focalId);
          if (post) {
            this.log.debug({ href, source: 'TweetDetail' }, 'parsed post from API');
            return post;
          }
        }
      }

      this.log.warn({ href }, 'TweetDetail unavailable; falling back to DOM');
      return await parseCurrentConversationDom(page, href, this.log);
    } finally {
      if (restoreHref && normalizeStatusPageUrl(page.url()) !== restoreHref) {
        await page.goto(restoreHref, { waitUntil: 'domcontentloaded' });
        await waitForConversationReady(page, this.log, 'restore focal conversation');
      }
    }
  }
}

async function parseCurrentConversationDom(
  page: Page,
  href: string,
  log: ScrapeLogger,
): Promise<Post> {
  const statusHref = normalizeStatusPageUrl(href);
  if (normalizeStatusPageUrl(page.url()) !== statusHref) {
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    await waitForConversationReady(page, log);
  }

  const articles = conversationArticles(page);
  await articles
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);

  const count = await articles.count();
  if (count === 0) {
    log.warn({ href: statusHref }, 'no conversation articles; keeping href-only stub');
    return postStub(statusHref);
  }

  const focalIdx = await findFocalArticleIndex(articles, statusHref);
  for (let i = 0; i <= focalIdx; i++) {
    await expandArticleUi(page, articles.nth(i), log);
  }

  const thread: Post[] = [];
  for (let i = 0; i < focalIdx; i++) {
    thread.push(await parseArticleSnapshotDom(articles.nth(i), log));
  }

  const focalArticle = conversationArticles(page).nth(focalIdx);
  const bareRepostHandle = await readBareRepostHandle(focalArticle);
  const body = await readOwnTweetBodyMarkdown(focalArticle);

  if (bareRepostHandle && !body) {
    const nested = focalArticle.locator('article[data-testid="tweet"]');
    const nestedHref = await readPostHref(nested.last());
    return {
      href: syntheticRepostHref(bareRepostHandle, statusHref),
      stats: await readStats(focalArticle, log),
      ...(await readAuthor(focalArticle)),
      ...(await readTimestamp(focalArticle)),
      references: nestedHref ? [postStub(normalizeStatusPageUrl(nestedHref))] : [],
    };
  }

  const linkUrls = await collectArticleLinkUrlsDom(focalArticle, body);
  return {
    href: statusHref,
    stats: await readStats(focalArticle, log),
    ...(await readAuthor(focalArticle)),
    ...(await readTimestamp(focalArticle)),
    ...(body ? { body } : {}),
    ...(linkUrls.length ? { linkUrls } : {}),
    ...(thread.length ? { thread } : {}),
  };
}

async function findFocalArticleIndex(articles: Locator, statusHref: string): Promise<number> {
  const targetId = statusIdFromHref(statusHref);
  const count = await articles.count();

  for (let i = 0; i < count; i++) {
    const href = await readPostHref(articles.nth(i));
    if (href && statusIdFromHref(href) === targetId) {
      return i;
    }
  }

  return 0;
}

async function parseArticleSnapshotDom(article: Locator, log: ScrapeLogger): Promise<Post> {
  const href = await readPostHref(article);
  if (!href) {
    throw new Error('thread article missing status href');
  }

  const body = await readOwnTweetBodyMarkdown(article);
  const linkUrls = await collectArticleLinkUrlsDom(article, body);
  return {
    href: normalizeStatusPageUrl(href),
    stats: await readStats(article, log),
    ...(await readAuthor(article)),
    ...(await readTimestamp(article)),
    ...(body ? { body } : {}),
    ...(linkUrls.length ? { linkUrls } : {}),
  };
}

function conversationTimeline(page: Page): Locator {
  return page.getByLabel(CONVERSATION_LABEL, { exact: true });
}

function conversationArticles(page: Page): Locator {
  return conversationTimeline(page).locator('article[data-testid="tweet"]');
}

async function expandArticleUi(page: Page, article: Locator, log: ScrapeLogger): Promise<void> {
  const showMore = article.getByRole('button', { name: /^Show more$/i });
  while (await showMore.isVisible().catch(() => false)) {
    log.info({ action: 'expand show more' }, 'interaction');
    await showMore.click();
    await waitAfterDomAction(page, log, 'expand show more');
  }

  const showPosts = article.getByRole('button', { name: /^Show \d+ posts?$/i });
  while (await showPosts.isVisible().catch(() => false)) {
    log.info({ action: 'expand thread posts' }, 'interaction');
    await showPosts.click();
    await waitAfterDomAction(page, log, 'expand thread posts');
  }
}

async function readBareRepostHandle(article: Locator): Promise<string | null> {
  const social = article.getByTestId('socialContext');
  if (!(await social.count())) {
    return null;
  }

  const profileLink = article.locator('a[href^="/"]').filter({ has: social }).first();
  if (!(await profileLink.count())) {
    return null;
  }

  const href = await profileLink.getAttribute('href');
  if (!href || href.includes('/status/')) {
    return null;
  }

  const handle = href.replace(/^\//, '').split('/')[0]?.replace(/^@/, '');
  return handle ?? null;
}

async function collectArticleLinkUrlsDom(article: Locator, body?: string): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined): void => {
    if (!raw || raw.startsWith('blob:')) {
      return;
    }
    const absolute = toAbsoluteUrl(raw);
    if (!absolute || seen.has(absolute)) {
      return;
    }
    seen.add(absolute);
    urls.push(absolute);
  };

  const card = article.getByTestId('card.wrapper');
  if (await card.count()) {
    const cardLink = card.locator('a[role="link"]');
    if (await cardLink.count()) {
      push(
        await cardLink
          .first()
          .getAttribute('href', { timeout: 3_000 })
          .catch(() => null),
      );
    }
  }

  const photos = article.locator('[data-testid="tweetPhoto"] img[src*="twimg.com"]');
  const photoCount = await photos.count();
  for (let i = 0; i < photoCount; i++) {
    push(await photos.nth(i).getAttribute('src'));
  }

  if (body) {
    for (const url of extractUrlsFromMarkdown(body)) {
      push(url);
    }
  }

  return urls;
}

function toAbsoluteUrl(href: string): string | null {
  try {
    if (href.startsWith('http')) {
      return new URL(href).toString();
    }
    if (href.startsWith('/')) {
      return new URL(href, 'https://x.com').toString();
    }
    return null;
  } catch {
    return null;
  }
}

function extractUrlsFromMarkdown(markdown: string): string[] {
  const urls: string[] = [];
  const pattern = /\]\((https?:\/\/[^)]+)\)|https?:\/\/[^\s)>\]]+/g;
  for (const match of markdown.matchAll(pattern)) {
    const url = (match[1] ?? match[0]).replace(/[.,;:!?)]+$/, '');
    urls.push(url);
  }
  return urls;
}

/** Normalize href for assertions in live parser tests. */
export function expectStatusId(href: string): string {
  const id = statusIdFromHref(href);
  if (!id) {
    throw new Error(`not a status href: ${href}`);
  }
  return id;
}

/** Resolve canonical status URL for assertions in live parser tests. */
export function expectStatusHref(href: string): string {
  return canonicalStatusHref(href);
}
