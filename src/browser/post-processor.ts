import { resolveLink } from '../links/resolve.js';
import type { ScrapeLogger } from '../logger.js';
import { SCRAPE_ITEM_TIMEOUT_MS, withTimeout } from '../scrape-timeouts.js';
import type { Post, ResolvedLink } from '../types/post.js';

export function normalizePostHref(href: string): string {
  if (href.startsWith('repost://')) {
    return href;
  }
  try {
    const url = new URL(href);
    url.hash = '';
    return url.toString();
  } catch {
    return href;
  }
}

/** Cache posts and resolved links; guard threads/references against cycles. */
export class PostProcessor {
  private readonly postCache = new Map<string, Post>();
  private readonly linkCache = new Map<string, ResolvedLink>();

  private readonly log: ScrapeLogger;

  constructor(log: ScrapeLogger) {
    this.log = log;
  }

  getCached(href: string): Post | undefined {
    return this.postCache.get(normalizePostHref(href));
  }

  remember(post: Post): void {
    this.postCache.set(normalizePostHref(post.href), post);
  }

  collectAllHrefs(post: Post, into: Set<string>): void {
    const key = normalizePostHref(post.href);
    if (into.has(key)) {
      return;
    }
    into.add(key);
    for (const ref of post.references ?? []) {
      this.collectAllHrefs(ref, into);
    }
    for (const item of post.thread ?? []) {
      this.collectAllHrefs(item, into);
    }
  }

  async finalize(post: Post, cycleGuard: Set<string>, remember = true): Promise<Post> {
    const key = normalizePostHref(post.href);
    const cached = this.postCache.get(key);
    if (cached) {
      return cached;
    }

    if (cycleGuard.has(key)) {
      this.log.debug({ href: key }, 'cycle detected; omitting nested content');
      return post;
    }

    cycleGuard.add(key);

    const urlList = post.linkUrls?.length
      ? post.linkUrls
      : extractUrlsFromMarkdown(post.body ?? '');
    const links = urlList.length ? await this.resolveLinksCached(urlList) : undefined;

    const references = await this.finalizeNested(post.references ?? [], cycleGuard, false);
    const thread = await this.finalizeNested(post.thread ?? [], cycleGuard, false);

    cycleGuard.delete(key);

    const {
      references: _refs,
      thread: _thread,
      links: _links,
      linkUrls: _linkUrls,
      ...base
    } = post;
    const finalized: Post = {
      ...base,
      ...(links?.length ? { links } : {}),
      ...(references.length ? { references } : {}),
      ...(thread.length ? { thread } : {}),
    };

    if (remember) {
      this.postCache.set(key, finalized);
    }
    return finalized;
  }

  private async finalizeNested(
    posts: Post[],
    cycleGuard: Set<string>,
    remember: boolean,
  ): Promise<Post[]> {
    const result: Post[] = [];
    for (const item of posts) {
      const key = normalizePostHref(item.href);
      if (cycleGuard.has(key)) {
        this.log.debug({ href: key }, 'cycle detected; skipping reference/thread insert');
        continue;
      }
      result.push(await this.finalize(item, cycleGuard, remember));
    }
    return result;
  }

  private async resolveLinksCached(urls: string[]): Promise<ResolvedLink[]> {
    const results: ResolvedLink[] = [];
    for (const url of urls) {
      const cached = this.linkCache.get(url);
      if (cached) {
        results.push(cached);
        continue;
      }
      if (isDirectMediaUrl(url)) {
        const link = { url };
        this.linkCache.set(url, link);
        results.push(link);
        continue;
      }
      try {
        const resolved = await withTimeout(
          resolveLink(url),
          SCRAPE_ITEM_TIMEOUT_MS,
          `external link ${url}`,
        );
        this.linkCache.set(url, resolved);
        results.push(resolved);
      } catch (err) {
        this.log.warn({ url, err }, 'external link resolution failed; keeping url only');
        const fallback = { url };
        this.linkCache.set(url, fallback);
        results.push(fallback);
      }
    }
    return results;
  }
}

function isDirectMediaUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return (
      /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(pathname) ||
      pathname.includes('/video/') ||
      pathname.includes('/amplify_video/')
    );
  } catch {
    return false;
  }
}

function extractUrlsFromMarkdown(markdown: string): string[] {
  const urls: string[] = [];
  const pattern = /https?:\/\/[^\s)>\]]+/g;
  for (const match of markdown.matchAll(pattern)) {
    urls.push(match[0].replace(/[.,;:!?)]+$/, ''));
  }
  return urls;
}
