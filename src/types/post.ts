export type Stats = {
  comments: number;
  reposts: number;
  likes: number;
};

export type ResolvedLink = {
  url: string;
  title?: string;
  description?: string;
};

/** Scraped post graph used while collecting; flattened into AppState on save. */
export type Post = {
  href: string;
  stats: Stats;
  author?: string;
  /** ISO8601 time when the post was published. */
  timestamp?: string;
  /** Markdown body; omitted for reposts without custom text. */
  body?: string;
  /** External URLs in priority order (set during scrape; resolved in finalize). */
  linkUrls?: string[];
  /** Straight path from a referenced in-thread post up to the root. */
  thread?: Post[];
  /** External links extracted from the body, resolved with metadata. */
  links?: ResolvedLink[];
  /** Quoted or referenced posts, embedded inline in state (may nest further). */
  references?: Post[];
};
