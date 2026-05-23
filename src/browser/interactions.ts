import type { Page } from 'playwright';
import type { ScrapeLogger } from '../logger.js';

const MIN_ACTION_DELAY_MS = 500;

export async function humanDelay(): Promise<void> {
  const jitter = Math.floor(Math.random() * 500);
  await new Promise((resolve) => setTimeout(resolve, MIN_ACTION_DELAY_MS + jitter));
}

/**
 * Wait for client-side fetches to settle after a UI action on X (SPA).
 */
export async function waitForUiSettled(
  page: Page,
  log: ScrapeLogger,
  label: string,
): Promise<void> {
  log.debug({ label }, 'waiting for UI to settle');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await waitForDomIdle(page);
}

/** Lighter settle for in-page actions (Show more, quote navigation) without networkidle. */
export async function waitAfterDomAction(
  page: Page,
  log: ScrapeLogger,
  label: string,
): Promise<void> {
  log.debug({ label }, 'waiting after DOM action');
  await waitForDomIdle(page);
}

/** Wait for a post status page conversation timeline and first tweet article. */
export async function waitForConversationReady(
  page: Page,
  log: ScrapeLogger,
  label = 'post conversation',
): Promise<void> {
  log.debug({ label }, 'waiting for conversation timeline');
  const timeline = page.getByLabel('Timeline: Conversation', { exact: true });
  await timeline.waitFor({ state: 'visible', timeout: 20_000 });
  const articles = timeline.locator('article[data-testid="tweet"]');
  await articles
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);
  await humanDelay();
}

async function waitForDomIdle(page: Page): Promise<void> {
  const busy = page.locator('[aria-busy="true"]');
  if ((await busy.count()) > 0) {
    await busy
      .first()
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => undefined);
  }

  await humanDelay();
}

/** Close transient overlays (layers div) that block timeline controls. */
export async function dismissBlockingLayers(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  const dismissNames = [/^Close$/i, /^Not now$/i, /^Got it$/i, /^Dismiss$/i];
  for (const name of dismissNames) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 2_000 }).catch(() => undefined);
    }
  }
}

export async function tracedClick(
  page: Page,
  log: ScrapeLogger,
  target: { click: (options?: { force?: boolean }) => Promise<void> },
  action: string,
  options?: { force?: boolean },
): Promise<void> {
  log.info({ action }, 'interaction');
  await target.click(options);
  await waitForUiSettled(page, log, action);
}
