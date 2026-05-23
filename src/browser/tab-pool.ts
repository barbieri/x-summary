import type { BrowserContext, Page } from 'playwright';
import type { ScrapeLogger } from '../logger.js';

/** Fixed-size pool of Playwright tabs for parallel post-detail scraping. */
export class TabPool {
  private readonly pages: Page[] = [];
  private readonly available: Page[] = [];
  private readonly waiters: Array<(page: Page) => void> = [];
  private readonly log: ScrapeLogger;

  private constructor(log: ScrapeLogger) {
    this.log = log;
  }

  static async create(context: BrowserContext, size: number, log: ScrapeLogger): Promise<TabPool> {
    const pool = new TabPool(log);
    const tabCount = Math.max(1, size);
    for (let i = 0; i < tabCount; i++) {
      const page = await context.newPage();
      pool.pages.push(page);
      pool.available.push(page);
    }
    log.info({ parallelTabs: tabCount }, 'detail tab pool ready');
    return pool;
  }

  async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.acquire();
    try {
      return await fn(page);
    } finally {
      this.release(page);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.pages.map((page) => page.close().catch(() => undefined)));
    this.pages.length = 0;
    this.available.length = 0;
    this.log.debug('detail tab pool closed');
  }

  private async acquire(): Promise<Page> {
    const page = this.available.pop();
    if (page) {
      return page;
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(page: Page): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(page);
      return;
    }
    this.available.push(page);
  }
}
