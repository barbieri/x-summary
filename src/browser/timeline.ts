import type { Locator, Page } from 'playwright';
import type { ScrapeLogger } from '../logger.js';
import { humanDelay, waitAfterDomAction } from './interactions.js';

/** Virtualized home feed posts live under this landmark (inside Home timeline). */
export const HOME_TIMELINE_LABEL = 'Timeline: Your Home Timeline';

export type FeedScrollKind = 'home' | 'profile';

/**
 * Timeline tweet articles: `[data-testid="tweet"]` inside the home timeline landmark.
 * Ads are skipped — they sit under `[data-testid="placementTracking"]`.
 */
export function timelineTweetArticles(page: Page): Locator {
  return page.getByLabel(HOME_TIMELINE_LABEL).locator('article[data-testid="tweet"]');
}

export async function isAdTweet(article: Locator): Promise<boolean> {
  return (
    (await article.locator('xpath=ancestor::*[@data-testid="placementTracking"][1]').count()) > 0
  );
}

/** Scroll window to top so the Following sort menu (off-viewport group) can be interacted with. */
export async function scrollTimelineToTop(page: Page): Promise<void> {
  await page.evaluate('window.scrollTo(0, 0)');
  await humanDelay();
}

function feedScrollRegion(page: Page, kind: FeedScrollKind): Locator {
  if (kind === 'home') {
    return page.getByLabel(HOME_TIMELINE_LABEL);
  }
  return page.locator('[data-testid="primaryColumn"]');
}

async function moveMouseToFeed(page: Page, kind: FeedScrollKind): Promise<void> {
  const box = await feedScrollRegion(page, kind)
    .boundingBox()
    .catch(() => null);
  if (!box) {
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height * 0.45, 520));
}

async function scrollFeedPixels(
  page: Page,
  deltaY: number,
  kind: FeedScrollKind,
): Promise<boolean> {
  await moveMouseToFeed(page, kind);
  await page.mouse.wheel(0, deltaY);

  return page.evaluate<boolean>(
    `((delta, feedKind, label) => {
      const tryScroll = (el) => {
        if (!el) {
          return false;
        }
        const style = window.getComputedStyle(el);
        const scrollable =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 1;
        if (!scrollable) {
          return false;
        }
        const before = el.scrollTop;
        el.scrollTop += delta;
        return el.scrollTop > before;
      };
      if (feedKind === 'home') {
        const timeline = document.querySelector('[aria-label="' + label + '"]');
        let node = timeline;
        while (node) {
          if (tryScroll(node)) {
            return true;
          }
          node = node.parentElement;
        }
      }
      const primary = document.querySelector('[data-testid="primaryColumn"]');
      if (tryScroll(primary)) {
        return true;
      }
      const before = window.scrollY;
      window.scrollBy(0, delta);
      return window.scrollY > before;
    })(${deltaY}, ${JSON.stringify(kind)}, ${JSON.stringify(HOME_TIMELINE_LABEL)})`,
  );
}

/** Scroll the feed so the next virtualized posts can load. */
export async function scrollTimelineDown(
  page: Page,
  log: ScrapeLogger,
  knownArticleCount: number,
  kind: FeedScrollKind,
): Promise<boolean> {
  const moved = await scrollFeedPixels(page, 1_800, kind);
  await humanDelay();
  await waitAfterDomAction(page, log, 'timeline scroll');

  const afterCount =
    kind === 'home'
      ? await timelineTweetArticles(page).count()
      : await page.locator('article[data-testid="tweet"]').count();
  if (afterCount > knownArticleCount) {
    return true;
  }

  return moved;
}

/** After scraping a post, scroll it out of view so X loads the next timeline items. */
export async function scrollPastArticle(
  page: Page,
  article: Locator,
  log: ScrapeLogger,
  kind: FeedScrollKind,
): Promise<void> {
  await article.scrollIntoViewIfNeeded().catch(() => undefined);
  await article.evaluate((el) => {
    el.scrollIntoView({ block: 'end', inline: 'nearest' });
  });
  await humanDelay();

  const box = await article.boundingBox().catch(() => null);
  const deltaY = box ? Math.ceil(box.height) + 480 : 1_200;
  await scrollFeedPixels(page, deltaY, kind);
  await humanDelay();
  await waitAfterDomAction(page, log, 'scroll past post');
}
