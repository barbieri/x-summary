/**
 * Reusable X.com DOM inspector for scraper development.
 *
 * Usage:
 *   pnpm inspect:x [config.json] [--url https://x.com/home] [--action home-following]
 *
 * Actions:
 *   home-following       — home → Following tab → dump timeline chrome + first articles
 *   home-following-sort  — same, then click Following tab to open Popular/Recent dropdown
 *   home-for-you         — home → For you tab → dump articles
 *   articles        — dump article structure on current page (default)
 */
import '../src/env.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { waitForUiSettled } from '../src/browser/interactions.js';
import { resolveBrowserProfilePath } from '../src/browser/profile.js';
import { applyStealthToContext, persistentContextOptions } from '../src/browser/stealth.js';
import { loadConfig } from '../src/config/load.js';
import { createScrapeLogger } from '../src/logger.js';

type InspectAction = 'home-following' | 'home-following-sort' | 'home-for-you' | 'articles';

type CliArgs = {
  configPath: string;
  url: string;
  action: InspectAction;
  outDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let url = 'https://x.com/home';
  let action: InspectAction = 'articles';
  let outDir = './tmp/inspect';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      url = argv[++i];
      continue;
    }
    if (arg === '--action' && argv[i + 1]) {
      action = argv[++i] as InspectAction;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      outDir = argv[++i];
      continue;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return {
    configPath: positional[0] ?? 'config.json',
    url,
    action,
    outDir,
  };
}

/** Serializable snapshot of accessible controls and tweet articles. */
async function captureDomSnapshot(page: Page): Promise<unknown> {
  // Plain string evaluate avoids tsx injecting __name into browser context.
  return page.evaluate(`(() => {
    const pick = (el) => {
      const role = el.getAttribute('role');
      const testId = el.getAttribute('data-testid');
      const aria = el.getAttribute('aria-label');
      const text = (el.textContent ?? '').replace(/s+/g, ' ').trim().slice(0, 120);
      const href = el.tagName === 'A' ? el.href : null;
      const disabled = el.tagName === 'BUTTON' ? el.disabled : el.getAttribute('aria-disabled') === 'true';
      return {
        tag: el.tagName.toLowerCase(),
        role,
        testId,
        ariaLabel: aria,
        text: text || undefined,
        href: href || undefined,
        disabled: disabled || undefined,
      };
    };

    const primary = document.querySelector('[data-testid="primaryColumn"]');
    const tablist =
      document.querySelector('[data-testid="ScrollSnap-List"]') ||
      document.querySelector('[role="tablist"]');

    const tabs = tablist
      ? [...tablist.querySelectorAll('[role="tab"]')].map((el) => ({
          ...pick(el),
          selected: el.getAttribute('aria-selected') === 'true',
          hasPopup: el.getAttribute('aria-haspopup'),
          expanded: el.getAttribute('aria-expanded'),
        }))
      : [];

    const buttonsIn = (root, limit = 40) => {
      if (!root) return [];
      return [...root.querySelectorAll('button,[role="button"]')].slice(0, limit).map((el) => pick(el));
    };

    const articles = [...document.querySelectorAll('article')].slice(0, 5).map((article, i) => {
      const statusLink = [...article.querySelectorAll('a')].find((a) =>
        (a.getAttribute('href') || '').includes('/status/'),
      );
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      const userName = article.querySelector('[data-testid="User-Name"]');
      const time = article.querySelector('time');
      const statButtons = [...article.querySelectorAll('button,[role="button"]')]
        .filter((b) => /reply|repost|like|bookmark|share/i.test(b.getAttribute('aria-label') || ''))
        .map((b) => pick(b));

      return {
        index: i,
        statusHref: statusLink ? statusLink.getAttribute('href') : null,
        tweetText: tweetText ? (tweetText.textContent || '').trim().slice(0, 80) : null,
        userNameHtml: userName ? userName.innerHTML.slice(0, 200) : null,
        timestamp: time ? time.getAttribute('datetime') : null,
        statButtons,
      };
    });

    const sortCandidates = primary
      ? [...primary.querySelectorAll('button, [role="button"], [role="menuitem"]')].filter((el) => {
          const t = (el.textContent || '').toLowerCase();
          const a = (el.getAttribute('aria-label') || '').toLowerCase();
          return /following|recent|popular|sort|timeline|feed|manage/i.test(t) || /following|recent|popular|sort|manage/i.test(a);
        })
      : [];

    const textHits = primary
      ? [...primary.querySelectorAll('span, div, button, [role="button"], [role="combobox"]')]
          .filter((el) => {
            const t = (el.textContent || '').trim();
            return /^(Popular|Recent|Sort by|Following)$/i.test(t) && t.length < 40;
          })
          .slice(0, 20)
          .map((el) => pick(el))
      : [];

    const menus = [...document.querySelectorAll('[role="menu"]')].map((root) => ({
      role: root.getAttribute('role'),
      testId: root.getAttribute('data-testid'),
      hasDropdown: !!root.querySelector('[data-testid="Dropdown"]'),
      items: [...root.querySelectorAll('[role="menuitem"]')]
        .slice(0, 30)
        .map((el) => ({
          ...pick(el),
          selectedSvg: !!el.querySelector(':scope > div:nth-child(2) svg'),
        })),
    }));

    return {
      url: location.href,
      title: document.title,
      tabs,
      primaryColumn: {
        firstButtons: buttonsIn(primary, 25),
        sortCandidates: sortCandidates.map((el) => pick(el)),
        textHits,
      },
      menus,
      articleCount: document.querySelectorAll('article').length,
      articles,
    };
  })()`);
}

async function runAction(
  page: Page,
  action: InspectAction,
  log: ReturnType<typeof createScrapeLogger>,
): Promise<void> {
  if (
    action === 'home-following' ||
    action === 'home-following-sort' ||
    action === 'home-for-you'
  ) {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await waitForUiSettled(page, log, 'inspect home');

    const label = action === 'home-for-you' ? 'For you' : 'Following';
    const tab = page
      .locator('[data-testid="ScrollSnap-List"]')
      .getByRole('tab', { name: label, exact: true });
    await tab.click();
    await waitForUiSettled(page, log, `inspect tab ${label}`);
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);
  const config = await loadConfig(cli.configPath);
  const profilePath = resolveBrowserProfilePath(config);
  const log = createScrapeLogger();
  const outDir = resolve(cli.outDir);
  await mkdir(outDir, { recursive: true });

  const context = await chromium.launchPersistentContext(
    profilePath,
    persistentContextOptions(false),
  );
  await applyStealthToContext(context);

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    if (cli.action === 'articles') {
      await page.goto(cli.url, { waitUntil: 'domcontentloaded' });
      await waitForUiSettled(page, log, 'inspect navigate');
    } else {
      await runAction(page, cli.action, log);
    }

    const snapshot = await captureDomSnapshot(page);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${cli.action}-${stamp}`;
    const jsonPath = resolve(outDir, `${base}.json`);
    await writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    const screenshotPath = resolve(outDir, `${base}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${screenshotPath}`);
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
