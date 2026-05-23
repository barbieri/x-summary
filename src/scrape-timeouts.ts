/** Timeout for conversation DOM parsing (navigation + thread/quote nesting). */
export const POST_DETAIL_PARSE_TIMEOUT_MS = 60_000;

/** Per-item timeout for external link resolution. */
export const SCRAPE_ITEM_TIMEOUT_MS = 30_000;

export class ScrapeTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'ScrapeTimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ScrapeTimeoutError(label, ms));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
