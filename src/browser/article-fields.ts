import type { Locator } from 'playwright';
import type { ScrapeLogger } from '../logger.js';
import type { Post } from '../types/post.js';

/** Status URL used in feed lists when a post is keyed by a synthetic repost href. */
export function canonicalFeedHref(href: string): string {
  const match = /^repost:\/\/[^@]+@(.+)$/.exec(href);
  return match?.[1] ?? href;
}

export function syntheticRepostHref(handle: string, statusHref: string): string {
  const normalized = handle.replace(/^@/, '');
  return `repost://${normalized}@${statusHref}`;
}

export function isSyntheticRepostHref(href: string): boolean {
  return href.startsWith('repost://');
}

/** Canonical status page URL (`/handle/status/id`) without `/photo` or query suffixes. */
export function canonicalStatusHref(raw: string): string {
  const absolute = raw.startsWith('http') ? raw : `https://x.com${raw}`;
  try {
    const url = new URL(absolute);
    const match = url.pathname.match(/^(\/[^/]+\/status\/\d+)/);
    if (match) {
      return `https://x.com${match[1]}`;
    }
    return absolute;
  } catch {
    return absolute;
  }
}

export function statusIdFromHref(href: string): string | null {
  const match = canonicalStatusHref(href).match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
}

export async function readPostHref(article: Locator): Promise<string | null> {
  const links = article.getByRole('link');
  const count = await links.count();
  let fallback: string | null = null;

  for (let i = 0; i < count; i++) {
    const raw = await links.nth(i).getAttribute('href');
    if (!raw?.includes('/status/')) {
      continue;
    }
    const canonical = canonicalStatusHref(raw);
    const path = new URL(canonical).pathname;
    if (/^\/[^/]+\/status\/\d+$/.test(path)) {
      return canonical;
    }
    fallback ??= canonical;
  }

  return fallback;
}

export function normalizeStatusPageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Stats live in `[role="group"]` → `[data-testid="reply|retweet|like"]`. */
export async function readStats(article: Locator, log: ScrapeLogger): Promise<Post['stats']> {
  const readByTestId = async (testId: string): Promise<number> => {
    const button = article.getByTestId(testId).first();
    if (!(await button.count())) {
      log.debug({ testId }, 'stat control not found, defaulting to 0');
      return 0;
    }
    const text = await button.innerText().catch(() => '0');
    return parseMetricCount(text);
  };

  return {
    comments: await readByTestId('reply'),
    reposts: await readByTestId('retweet'),
    likes: await readByTestId('like'),
  };
}

/** Handle from `[data-testid="User-Name"] a[role="link"]` href (`/handle`). */
export async function readAuthor(article: Locator): Promise<{ author?: string }> {
  const userBlock = article.getByTestId('User-Name');
  if (await userBlock.count()) {
    const link = userBlock.getByRole('link').first();
    const href = await link.getAttribute('href');
    if (href) {
      const handle = href.replace(/^\//, '').split('/')[0]?.replace(/^@/, '');
      if (handle) {
        return { author: handle };
      }
    }
  }

  return {};
}

export async function readTimestamp(article: Locator): Promise<{ timestamp?: string }> {
  const time = article.locator('time').first();
  const datetime = await time.getAttribute('datetime').catch(() => null);
  return datetime ? { timestamp: datetime } : {};
}

function parseMetricCount(raw: string): number {
  const text = raw.trim().toUpperCase();
  if (!text || text === '—') {
    return 0;
  }
  const match = /^([\d,.]+)\s*([KMB])?/.exec(text);
  if (!match) {
    return 0;
  }
  const base = Number.parseFloat(match[1]?.replace(/,/g, '') ?? '0');
  const suffix = match[2];
  const multiplier =
    suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}
