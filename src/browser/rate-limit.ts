import type { Page, Response } from 'playwright';

/** Watch API throttling during a single feed walk; stop after bounded retries. */
export class FeedRateLimit {
  private pending = false;
  private retries = 0;
  private readonly onResponse = (response: Response): void => {
    if (response.status() === 429 && response.url().includes('/i/api/')) {
      this.pending = true;
    }
  };

  private readonly page: Page;
  constructor(page: Page) {
    this.page = page;
    page.on('response', this.onResponse);
  }

  async backoff(): Promise<boolean> {
    if (!this.pending) return false;
    if (this.retries >= 3) return true;
    this.pending = false;
    const delay = Math.min(30_000, 2_000 * 2 ** this.retries) + Math.floor(Math.random() * 500);
    this.retries++;
    await this.page.waitForTimeout(delay);
    return false;
  }

  detach(): void {
    this.page.off('response', this.onResponse);
  }
}
