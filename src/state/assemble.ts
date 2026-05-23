import { canonicalFeedHref } from '../browser/article-fields.js';
import { normalizePostHref } from '../browser/post-processor.js';
import type { AppConfig } from '../types/config.js';
import type { Post } from '../types/post.js';
import type { AppState, PostRecord } from '../types/state.js';

/** Derive scrape window start as an absolute ISO8601 instant (stored in state.cutoffTimestamp). */
export function resolveScrapeCutoff(
  config: AppConfig,
  previousState: AppState | null,
  nowMs: number = Date.now(),
): { cutoffMs: number; cutoffTimestamp: string } {
  if (previousState) {
    return {
      cutoffMs: Date.parse(previousState.timestamp),
      cutoffTimestamp: previousState.timestamp,
    };
  }
  const cutoffMs = nowMs - config.timeWindowMinutes * 60 * 1000;
  return {
    cutoffMs,
    cutoffTimestamp: new Date(cutoffMs).toISOString(),
  };
}

/** Flatten scraped posts into `posts` plus href-only feed lists. */
export function buildAppState(
  timestamp: string,
  cutoffTimestamp: string,
  following: Post[],
  forYouSuggestions: Post[],
  monitored: Record<string, Post[]>,
): AppState {
  const posts: Record<string, PostRecord> = {};

  for (const post of following) {
    ingestPost(post, posts);
  }
  for (const post of forYouSuggestions) {
    ingestPost(post, posts);
  }
  for (const list of Object.values(monitored)) {
    for (const post of list) {
      ingestPost(post, posts);
    }
  }

  return {
    timestamp,
    cutoffTimestamp,
    posts,
    following: following.map((post) => normalizePostHref(canonicalFeedHref(post.href))),
    forYouSuggestions: forYouSuggestions.map((post) =>
      normalizePostHref(canonicalFeedHref(post.href)),
    ),
    monitored: Object.fromEntries(
      Object.entries(monitored).map(([handle, list]) => [
        handle,
        list.map((post) => normalizePostHref(canonicalFeedHref(post.href))),
      ]),
    ),
  };
}

function ingestPost(post: Post, posts: Record<string, PostRecord>): void {
  const key = normalizePostHref(post.href);
  for (const ref of post.references ?? []) {
    ingestPost(ref, posts);
  }
  for (const item of post.thread ?? []) {
    ingestPost(item, posts);
  }
  if (posts[key]) {
    return;
  }
  posts[key] = toPostRecord(post);
}

function toPostRecord(post: Post): PostRecord {
  return {
    stats: post.stats,
    ...(post.author ? { author: post.author } : {}),
    ...(post.timestamp ? { timestamp: post.timestamp } : {}),
    ...(post.body ? { body: post.body } : {}),
    ...(post.links?.length ? { links: post.links } : {}),
    ...(post.thread?.length
      ? { thread: post.thread.map((item) => normalizePostHref(item.href)) }
      : {}),
    ...(post.references?.length
      ? { references: post.references.map((item) => normalizePostHref(item.href)) }
      : {}),
  };
}

/** All post hrefs in a persisted state (feeds, references, thread). */
export function collectStateHrefs(state: AppState): Set<string> {
  const hrefs = new Set<string>();
  const add = (href: string): void => {
    hrefs.add(normalizePostHref(href));
  };

  for (const href of state.following) {
    add(href);
  }
  for (const href of state.forYouSuggestions) {
    add(href);
  }
  for (const list of Object.values(state.monitored)) {
    for (const href of list) {
      add(href);
    }
  }
  for (const key of Object.keys(state.posts)) {
    add(key);
  }
  for (const record of Object.values(state.posts)) {
    for (const href of record.references ?? []) {
      add(href);
    }
    for (const href of record.thread ?? []) {
      add(href);
    }
  }

  return hrefs;
}
