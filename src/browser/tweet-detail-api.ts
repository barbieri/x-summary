import type { Page } from 'playwright';
import type { ScrapeLogger } from '../logger.js';
import type { Post, Stats } from '../types/post.js';
import { normalizeStatusPageUrl, statusIdFromHref, syntheticRepostHref } from './article-fields.js';
import { waitForConversationReady } from './interactions.js';
import { plainTextToMarkdown } from './tweet-body.js';

type UrlEntity = {
  url?: string;
  expanded_url?: string;
  display_url?: string;
};

type MediaEntity = {
  type?: string;
  url?: string;
  expanded_url?: string;
  display_url?: string;
  media_url_https?: string;
  video_info?: { variants?: Array<{ url?: string; content_type?: string }> };
};

type LegacyTweet = {
  id_str?: string;
  created_at?: string;
  full_text?: string;
  reply_count?: number;
  retweet_count?: number;
  favorite_count?: number;
  is_quote_status?: boolean;
  in_reply_to_status_id_str?: string;
  conversation_id_str?: string;
  entities?: { urls?: UrlEntity[]; media?: MediaEntity[] };
  extended_entities?: { media?: MediaEntity[] };
};

type RawTweetResult = {
  rest_id?: string;
  legacy?: LegacyTweet;
  core?: { user_results?: { result?: { core?: { screen_name?: string } } } };
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
  quoted_status_result?: { result?: RawTweetResult };
  retweeted_status_result?: { result?: RawTweetResult };
  card?: {
    legacy?: { binding_values?: Array<{ key?: string; value?: { string_value?: string } }> };
  };
};

export type TweetDetailListener = {
  waitFor: (timeoutMs?: number) => Promise<string | null>;
  detach: () => void;
};

/** Listen for TweetDetail GraphQL on the next matching response. */
export function attachTweetDetailListener(page: Page, focalTweetId: string): TweetDetailListener {
  let captured: string | null = null;
  let settled = false;
  const waiters: Array<(value: string | null) => void> = [];

  const notify = (value: string | null): void => {
    if (settled) {
      return;
    }
    settled = true;
    captured = value;
    for (const resolve of waiters) {
      resolve(value);
    }
    waiters.length = 0;
  };

  const handler = async (response: {
    url: () => string;
    text: () => Promise<string>;
  }): Promise<void> => {
    const url = response.url();
    if (!url.includes('TweetDetail') || !url.includes(focalTweetId)) {
      return;
    }
    try {
      notify(await response.text());
    } catch {
      // ignore truncated bodies
    }
  };

  page.on('response', handler);

  return {
    waitFor: (timeoutMs = 15_000) => {
      if (captured) {
        return Promise.resolve(captured);
      }
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          page.off('response', handler);
          resolve(captured);
        }, timeoutMs);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
    detach: () => {
      page.off('response', handler);
    },
  };
}

/** Navigate (or reload) and wait for TweetDetail JSON. */
export async function loadTweetDetailJson(
  page: Page,
  href: string,
  log: ScrapeLogger,
): Promise<string | null> {
  const focalId = statusIdFromHref(href);
  if (!focalId) {
    return null;
  }

  const listener = attachTweetDetailListener(page, focalId);
  const target = normalizeStatusPageUrl(href);

  try {
    if (normalizeStatusPageUrl(page.url()) !== target) {
      await page.goto(href, { waitUntil: 'domcontentloaded' });
    } else {
      log.debug({ focalId }, 'reloading conversation to capture TweetDetail');
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await waitForConversationReady(page, log);
    return await listener.waitFor(15_000);
  } finally {
    listener.detach();
  }
}

/** Parse focal post (thread, quotes, media) from TweetDetail GraphQL JSON. */
export function parsePostFromTweetDetail(json: string, focalTweetId: string): Post | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const graph = indexTweetResults(parsed);
  const focal = graph.get(focalTweetId);
  if (!focal) {
    return null;
  }

  return buildPostFromNode(focal, graph, {
    includeThread: true,
    includeQuotes: true,
    allowSyntheticRepost: true,
  });
}

function indexTweetResults(json: unknown): Map<string, RawTweetResult> {
  const graph = new Map<string, RawTweetResult>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const node = value as RawTweetResult;
    const id = node.legacy?.id_str;
    const author = node.core?.user_results?.result?.core?.screen_name;
    if (id && author) {
      graph.set(id, node);
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  };

  visit(json);
  return graph;
}

type BuildOptions = {
  includeThread: boolean;
  includeQuotes: boolean;
  allowSyntheticRepost: boolean;
};

function postBaseFields(
  author: string,
  legacy: LegacyTweet,
): { stats: Stats; author?: string; timestamp?: string } {
  const timestamp = parseTwitterDate(legacy.created_at);
  return {
    stats: mapStats(legacy),
    ...(author ? { author } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

function buildBareRepostPost(
  node: RawTweetResult,
  graph: Map<string, RawTweetResult>,
  author: string,
  href: string,
  legacy: LegacyTweet,
): Post {
  const retweeted = node.retweeted_status_result?.result;
  if (!retweeted) {
    throw new Error('bare retweet missing retweeted_status_result');
  }
  return {
    href: syntheticRepostHref(author, href),
    ...postBaseFields(author, legacy),
    references: [
      buildPostFromNode(retweeted, graph, {
        includeThread: false,
        includeQuotes: true,
        allowSyntheticRepost: false,
      }),
    ],
  };
}

function buildQuoteReferences(
  node: RawTweetResult,
  graph: Map<string, RawTweetResult>,
  options: BuildOptions,
): Post[] {
  const quoted = node.quoted_status_result?.result;
  if (!options.includeQuotes || !quoted) {
    return [];
  }
  return [
    buildPostFromNode(quoted, graph, {
      includeThread: false,
      includeQuotes: false,
      allowSyntheticRepost: false,
    }),
  ];
}

function buildPostFromNode(
  node: RawTweetResult,
  graph: Map<string, RawTweetResult>,
  options: BuildOptions,
): Post {
  const legacy = node.legacy;
  if (!legacy?.id_str) {
    throw new Error('tweet node missing id_str');
  }

  const author = node.core?.user_results?.result?.core?.screen_name ?? '';
  const href = statusHref(author, legacy.id_str);

  if (options.allowSyntheticRepost && isBareRetweet(node)) {
    return buildBareRepostPost(node, graph, author, href, legacy);
  }

  const body = tweetBodyMarkdown(node);
  const linkUrls = collectLinkUrls(node);
  const references = buildQuoteReferences(node, graph, options);
  const thread = options.includeThread ? buildThreadChain(node, graph) : [];

  return {
    href,
    ...postBaseFields(author, legacy),
    ...(body ? { body } : {}),
    ...(linkUrls.length ? { linkUrls } : {}),
    ...(references.length ? { references } : {}),
    ...(thread.length ? { thread } : {}),
  };
}

function buildThreadChain(node: RawTweetResult, graph: Map<string, RawTweetResult>): Post[] {
  const thread: Post[] = [];
  const seen = new Set<string>();
  let current: RawTweetResult | undefined = node;

  while (current?.legacy?.in_reply_to_status_id_str) {
    const parentId = current.legacy.in_reply_to_status_id_str;
    if (seen.has(parentId)) {
      break;
    }
    seen.add(parentId);
    const parent = graph.get(parentId);
    if (!parent) {
      break;
    }
    thread.unshift(
      buildPostFromNode(parent, graph, {
        includeThread: false,
        includeQuotes: false,
        allowSyntheticRepost: false,
      }),
    );
    current = parent;
  }

  return thread;
}

function isBareRetweet(node: RawTweetResult): boolean {
  const retweeted = node.retweeted_status_result?.result;
  if (!retweeted) {
    return false;
  }
  if (node.legacy?.is_quote_status) {
    return false;
  }
  const text = tweetPlainText(node).trim();
  if (!text) {
    return true;
  }
  return /^RT @\w+:/i.test(text);
}

function tweetPlainText(node: RawTweetResult): string {
  return node.note_tweet?.note_tweet_results?.result?.text ?? node.legacy?.full_text ?? '';
}

function tweetBodyMarkdown(node: RawTweetResult): string | undefined {
  const text = tweetPlainText(node).trim();
  if (!text) {
    return undefined;
  }

  const anchors: Array<{ text: string; href: string }> = [];
  for (const url of node.legacy?.entities?.urls ?? []) {
    if (url.expanded_url) {
      anchors.push({
        text: url.display_url ?? url.url ?? url.expanded_url,
        href: url.expanded_url,
      });
    }
  }
  for (const media of mediaEntities(node)) {
    if (media.expanded_url && media.display_url) {
      anchors.push({ text: media.display_url, href: media.expanded_url });
    }
  }

  return plainTextToMarkdown(text, anchors);
}

function mediaEntities(node: RawTweetResult): MediaEntity[] {
  return node.legacy?.extended_entities?.media ?? node.legacy?.entities?.media ?? [];
}

function collectLinkUrls(node: RawTweetResult): string[] {
  const urls = new Set<string>();
  const add = (raw?: string): void => {
    if (!raw || raw.startsWith('blob:')) {
      return;
    }
    try {
      const url = new URL(raw);
      if (isHttpUrl(url)) {
        urls.add(url.toString());
      }
    } catch {
      if (raw.startsWith('/')) {
        urls.add(new URL(raw, 'https://x.com').toString());
      }
    }
  };

  for (const url of node.legacy?.entities?.urls ?? []) {
    add(url.expanded_url);
  }

  for (const media of mediaEntities(node)) {
    add(media.expanded_url);
    add(media.media_url_https);
    for (const variant of media.video_info?.variants ?? []) {
      if (variant.content_type?.startsWith('video/')) {
        add(variant.url);
      }
    }
  }

  for (const binding of node.card?.legacy?.binding_values ?? []) {
    const value = binding.value?.string_value;
    if (binding.key?.includes('url') || value?.startsWith('http')) {
      add(value);
    }
  }

  for (const url of extractUrlsFromPlainText(tweetPlainText(node))) {
    add(url);
  }

  return [...urls];
}

function mapStats(legacy: LegacyTweet): Stats {
  return {
    comments: legacy.reply_count ?? 0,
    reposts: legacy.retweet_count ?? 0,
    likes: legacy.favorite_count ?? 0,
  };
}

function statusHref(author: string, id: string): string {
  return normalizeStatusPageUrl(`https://x.com/${author}/status/${id}`);
}

function parseTwitterDate(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Extract http(s) URLs from plain tweet text (handles line-broken x.com URLs). */
export function extractUrlsFromPlainText(text: string): string[] {
  const normalized = text.replace(/\s+/g, '');
  const urls: string[] = [];
  const pattern = /https?:\/\/[^\s]+|(?:https?:\/\/)?(?:x\.com|twitter\.com)\/[^\s]+/gi;
  for (const match of normalized.matchAll(pattern)) {
    let url = match[0].replace(/[.,;:!?)…]+$/, '');
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }
    urls.push(url);
  }
  return urls;
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}
