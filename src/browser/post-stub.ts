import type { Post } from '../types/post.js';
import { normalizePostHref } from './post-processor.js';

/** Minimal post record when detail scraping or nesting fails. */
export function postStub(href: string): Post {
  return {
    href: normalizePostHref(href),
    stats: { comments: 0, reposts: 0, likes: 0 },
  };
}
