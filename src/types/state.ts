import type { ResolvedLink, Stats } from './post.js';

/** Post payload stored in `AppState.posts` (key = canonical href). */
export type PostRecord = {
  author?: string;
  /** ISO8601 time when the post was published. */
  timestamp?: string;
  stats: Stats;
  /** Markdown body; omitted for reposts without custom text. */
  body?: string;
  /** Hrefs of ancestor posts in the same thread (root-first); keys in posts. */
  thread?: string[];
  /** External links from the body, resolved with title and description. */
  links?: ResolvedLink[];
  /** Hrefs of quoted or referenced posts; keys in posts. */
  references?: string[];
};

export type AppState = {
  /** ISO8601 time when this state snapshot was generated. */
  timestamp: string;
  /** Absolute ISO8601 instant for the start of the collection window (not a duration). */
  cutoffTimestamp: string;
  /** All scraped posts keyed by canonical href. Feed lists and cross-refs point here. */
  posts: Record<string, PostRecord>;
  /** Ordered hrefs into posts for Following > Recent. */
  following: string[];
  /** Ordered hrefs into posts for For You suggestions. */
  forYouSuggestions: string[];
  /** Ordered hrefs into posts per monitored handle. */
  monitored: Record<string, string[]>;
};
