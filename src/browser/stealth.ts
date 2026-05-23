import type { BrowserContext, chromium } from 'playwright';

type PersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

export const STEALTH_INIT_SCRIPT = `
(() => {
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
    configurable: true,
  });
  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }
})();
`;

/** Options tuned for post-login scraping (Playwright-controlled). */
export function persistentContextOptions(headless: boolean): PersistentContextOptions {
  return {
    headless,
    channel: 'chrome',
    locale: 'en-US',
    ignoreDefaultArgs: ['--use-mock-keychain'], // X seems to detect this, maybe due disabled FedCM?
    acceptDownloads: false,
    serviceWorkers: 'allow',
    chromiumSandbox: true,
  };
}

/**
 * Opens X login in a normal Chrome window without remote-debugging pipes since X will detect it and block login.
 * Playwright only waits for the user to close the browser; do not call page.goto here.
 */
export function loginContextOptions(): PersistentContextOptions {
  const headless = false; // we always want the browser to be visible when logging in
  const baseOptions = persistentContextOptions(headless);
  return {
    ...baseOptions,
    ignoreDefaultArgs: [
      '--remote-debugging-pipe', // X detects this and blocks login
      ...(baseOptions.ignoreDefaultArgs as string[]),
    ],
  };
}

export async function applyStealthToContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(STEALTH_INIT_SCRIPT);
}
