import { mkdir } from 'node:fs/promises';
import {
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  chromium,
  type Page,
} from 'playwright';
import {
  createScrapeLogger,
  type LogLevel,
  logScrapeFailure,
  type ScrapeLogger,
} from '../logger.js';
import type { AppConfig } from '../types/config.js';
import { hasXAuthCookies, manualLoginWindowGuidance, X_LOGIN_URL } from './auth.js';
import { waitForUiSettled } from './interactions.js';
import { runManualLoginWindow } from './login-window.js';
import { resolveBrowserProfilePath } from './profile.js';
import { applyStealthToContext, persistentContextOptions } from './stealth.js';

const X_HOME_URL = 'https://x.com/home';
const OWNER_POLL_MS = 2_000;
const OWNER_LOG_EVERY_MS = 30_000;

export type BrowserSession = {
  context: BrowserContext;
  page: Page;
  profilePath: string;
  cdpAttached: boolean;
  cdpBrowser?: Browser;
};

export type EnsureOwnerSessionOptions = {
  ownerHandle: string;
  abortOnIncorrectOwnerHandle: boolean;
  log: ScrapeLogger;
  headless: boolean;
};

export class OwnerSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerSessionError';
  }
}

let activeSession: BrowserSession | null = null;
let activeProfileKey: string | null = null;
const loggedPages = new WeakSet<Page>();

export async function acquireBrowserSession(
  config: AppConfig,
  log: ScrapeLogger = createScrapeLogger(),
): Promise<BrowserSession> {
  const profilePath = resolveBrowserProfilePath(config);
  const sessionKey = config.browserCdpEndpoint?.trim() || profilePath;

  if (activeSession && activeProfileKey === sessionKey) {
    log.debug({ sessionKey }, 'reusing in-process browser session');
    await activeSession.page.bringToFront().catch(() => undefined);
    return activeSession;
  }

  if (activeSession) {
    log.info({ sessionKey: activeProfileKey }, 'closing previous browser before new session');
    await closeBrowser(activeSession, log);
  }

  activeSession = config.browserCdpEndpoint?.trim()
    ? await attachOverCdp(config.browserCdpEndpoint.trim(), profilePath, log)
    : await openPersistentSession(profilePath, log, config.ownerHandle, config.headless);

  activeProfileKey = sessionKey;
  return activeSession;
}

async function attachOverCdp(
  endpoint: string,
  profilePath: string,
  log: ScrapeLogger,
): Promise<BrowserSession> {
  log.info({ endpoint }, 'attaching to Chrome over CDP');

  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error(
      `No browser context at ${endpoint}. Start Chrome with remote debugging (see README).`,
    );
  }

  await applyStealthToContext(context);
  wireContextPages(context);

  const page = context.pages()[0] ?? (await context.newPage());
  attachBrowserLogging(page);

  await page.goto((await hasXAuthCookies(context)) ? X_HOME_URL : X_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
  });
  await waitForUiSettled(page, log, 'cdp attach');

  return { context, page, profilePath, cdpAttached: true, cdpBrowser: browser };
}

/**
 * Launch scrape-capable Chrome. If unauthenticated, run manual login window first (separate launch).
 */
async function openPersistentSession(
  profilePath: string,
  log: ScrapeLogger,
  expectedOwner: string,
  headless: boolean,
): Promise<BrowserSession> {
  await mkdir(profilePath, { recursive: true });

  let session = await launchScrapeContext(profilePath, log, headless);

  if (!(await hasXAuthCookies(session.context))) {
    log.info('no auth cookies in scrape session; starting manual login window');
    await closeBrowser(session, log);
    await runManualLoginWindow(profilePath, log, 'login', expectedOwner);
    session = await launchScrapeContext(profilePath, log, headless);
  }

  if (!(await hasXAuthCookies(session.context))) {
    throw new OwnerSessionError(
      `Login did not persist to ${profilePath} (missing auth_token/ct0). ${manualLoginWindowGuidance('login', expectedOwner)}`,
    );
  }

  return session;
}

async function launchScrapeContext(
  profilePath: string,
  log: ScrapeLogger,
  headless: boolean,
): Promise<BrowserSession> {
  log.info({ profilePath }, 'opening scrape Chrome profile (Playwright-controlled)');

  const options = persistentContextOptions(headless);
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profilePath, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/process_singleton|singleton|user data dir|profile/i.test(message)) {
      log.error(
        { err: error, profilePath, options },
        'Failed to launch persistent session: %s',
        error,
      );
      throw new Error(
        `Chrome profile is locked at ${profilePath}. Close any other Chrome window using this profile.`,
      );
    }
    throw error;
  }

  await applyStealthToContext(context);
  wireContextPages(context);

  const page = context.pages()[0] ?? (await context.newPage());
  attachBrowserLogging(page);

  await page.goto(X_HOME_URL, { waitUntil: 'domcontentloaded' });
  await waitForUiSettled(page, log, 'scrape session launch');

  const hasAuth = await hasXAuthCookies(context);
  log.info({ profilePath, hasAuth }, 'scrape Chrome session ready');

  return { context, page, profilePath, cdpAttached: false };
}

function wireContextPages(context: BrowserContext): void {
  context.on('page', (page) => {
    attachBrowserLogging(page);
  });
}

function attachBrowserLogging(page: Page): void {
  if (loggedPages.has(page)) {
    return;
  }
  loggedPages.add(page);

  const browserLog = createScrapeLogger().child({ source: 'browser' });

  const messageRemap: { match: RegExp; matchUrl?: RegExp; note: string; level: LogLevel }[] = [
    {
      match:
        /^The resource \S+ was preloaded using link preload but not used within a few seconds/i,
      note: 'Preload warning; ignore',
      level: 'debug',
    },
    { match: /^Banner not shown/i, note: 'Banner not shown; ignore', level: 'debug' },
    {
      match: /GSI_LOGGER|FedCM/i,
      note: 'Google Sign-In noise; use X email/password login instead',
      level: 'error',
    },
    {
      match: /Failed to load resource: the server responded with a status of 503/i,
      matchUrl: /[/][/]ads-api[.]x/i,
      note: 'Failed to load resource advertisement resource',
      level: 'debug',
    },
  ];
  const levelMap: Record<ReturnType<ConsoleMessage['type']> | 'verbose', LogLevel> = {
    assert: 'fatal',
    clear: 'debug',
    count: 'debug',
    dir: 'debug',
    dirxml: 'debug',
    endGroup: 'debug',
    error: 'error',
    warning: 'warn',
    info: 'info',
    debug: 'debug',
    log: 'debug',
    profile: 'trace',
    profileEnd: 'trace',
    startGroup: 'debug',
    startGroupCollapsed: 'debug',
    table: 'debug',
    time: 'debug',
    timeEnd: 'debug',
    trace: 'trace',
    verbose: 'debug',
  };

  page.on('console', (message: ConsoleMessage) => {
    const type = message.type();
    const text = message.text();
    const location = message.location();
    const payload = { type, text, location };

    for (const { match, matchUrl, note, level } of messageRemap) {
      if (match.test(text) && (matchUrl?.test(location.url) ?? true)) {
        browserLog[level]({ ...payload, note }, 'browser console: %s', text);
        return;
      }
    }

    browserLog[levelMap[type]](payload, 'browser console: %s', text);
  });

  page.on('pageerror', (error) => {
    browserLog.error({ err: error.message, stack: error.stack }, 'browser page error');
  });

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('onboarding/task.json') && response.status() >= 400) {
      browserLog.warn(
        {
          url,
          status: response.status(),
          hint: 'X onboarding API failed — finish login in the manual login window',
        },
        'x api response',
      );
    }
  });
}

/**
 * Ensure owner is logged in. May close the scrape session and open a manual login window.
 * Returns an up-to-date session (possibly replaced after login).
 */
export async function ensureOwnerSession(
  session: BrowserSession,
  options: EnsureOwnerSessionOptions,
): Promise<BrowserSession> {
  const log = options.log ?? createScrapeLogger();
  const expected = normalizeOwnerHandle(options.ownerHandle);

  if (await isOwnerSessionActive(session.page, expected)) {
    log.info({ ownerHandle: expected }, 'owner session verified');
    return session;
  }

  const loginRequired = await isLoginRequired(session.page);
  const ownerMismatch = !loginRequired;

  if (options.abortOnIncorrectOwnerHandle) {
    const message = loginRequired
      ? `Login required for @${expected}. ${manualLoginWindowGuidance('login', expected)}`
      : `Active session does not match ownerHandle @${expected}. ${manualLoginWindowGuidance('owner-mismatch', expected)}`;

    logScrapeFailure(log, {
      action: 'ensureOwnerSession',
      expected: `logged in as @${expected}`,
      missing: loginRequired ? 'auth_token and ct0 cookies' : `profile for @${expected}`,
      err: new OwnerSessionError(message),
    });
    throw new OwnerSessionError(message);
  }

  if (!session.cdpAttached) {
    const manualReason = loginRequired ? 'login' : 'owner-mismatch';
    log.warn(
      { expectedOwner: expected, reason: manualReason },
      'opening manual login window to fix session',
    );
    return retryAfterManualLoginWindow(session, options, manualReason);
  }

  if (ownerMismatch) {
    await waitForOwnerOnCdpSession(session, expected, log);
  }

  return session;
}

async function retryAfterManualLoginWindow(
  session: BrowserSession,
  options: EnsureOwnerSessionOptions,
  reason: 'login' | 'owner-mismatch',
): Promise<BrowserSession> {
  const expected = normalizeOwnerHandle(options.ownerHandle);

  await closeBrowser(session, options.log);
  activeSession = null;
  activeProfileKey = null;

  await runManualLoginWindow(session.profilePath, options.log, reason, expected);

  const fresh = await openPersistentSession(
    session.profilePath,
    options.log,
    options.ownerHandle,
    options.headless,
  );
  activeSession = fresh;
  activeProfileKey = session.profilePath;

  return ensureOwnerSession(fresh, options);
}

/** CDP-attached Chrome cannot use the manual login launcher; poll the live browser instead. */
async function waitForOwnerOnCdpSession(
  session: BrowserSession,
  expected: string,
  log: ScrapeLogger,
): Promise<void> {
  const { page } = session;

  log.warn(
    {
      expectedOwner: expected,
      guidance: manualLoginWindowGuidance('owner-mismatch', expected),
    },
    'wrong account on CDP browser — switch to the configured owner in that Chrome window',
  );

  await page.bringToFront();

  const started = Date.now();
  let lastLog = started;

  while (true) {
    if (await isOwnerSessionActive(page, expected)) {
      log.info({ ownerHandle: expected }, 'owner session verified after waiting');
      await page.goto(X_HOME_URL, { waitUntil: 'domcontentloaded' });
      await waitForUiSettled(page, log, 'post-login home');
      return;
    }

    const now = Date.now();
    if (now - lastLog >= OWNER_LOG_EVERY_MS) {
      log.info(
        {
          expectedOwner: expected,
          waitedMs: now - started,
          hasAuthCookies: await hasXAuthCookies(page.context()),
        },
        'still waiting for correct owner on scrape session',
      );
      lastLog = now;
    }

    await page.waitForTimeout(OWNER_POLL_MS);
  }
}

export function normalizeOwnerHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}

export async function isOwnerSessionActive(page: Page, normalizedOwner: string): Promise<boolean> {
  if (!(await hasXAuthCookies(page.context()))) {
    return false;
  }

  if (await isLoginRequired(page)) {
    return false;
  }

  const profile = page.getByRole('link', { name: new RegExp(`@${normalizedOwner}`, 'i') }).first();
  if (await profile.isVisible().catch(() => false)) {
    return true;
  }

  const accountSwitcher = page.getByRole('button', {
    name: new RegExp(`@${normalizedOwner}|account menu`, 'i'),
  });
  if (
    await accountSwitcher
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }

  const profileNav = page.getByTestId('AppTabBar_Profile_Link');
  const href = await profileNav.getAttribute('href').catch(() => null);
  if (href?.toLowerCase().includes(`/${normalizedOwner}`)) {
    return true;
  }

  return false;
}

export async function isLoginRequired(page: Page): Promise<boolean> {
  if (await hasXAuthCookies(page.context())) {
    return false;
  }

  const url = page.url();
  if (/\/login|\/flow\/login/i.test(url)) {
    return true;
  }

  const signIn = page.getByRole('button', { name: /^(log in|sign in)$/i });
  if (
    await signIn
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }

  const signInLink = page.getByRole('link', { name: /^(log in|sign in)$/i });
  if (
    await signInLink
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }

  return true;
}

export async function closeBrowser(
  session: BrowserSession,
  log: ScrapeLogger = createScrapeLogger(),
): Promise<void> {
  if (session.cdpAttached && session.cdpBrowser) {
    log.info('detaching from CDP (leaving your Chrome running)');
    await session.cdpBrowser.close();
  } else {
    log.info({ profilePath: session.profilePath }, 'closing browser; persisting profile to disk');
    await session.context.close();
  }

  if (activeSession === session) {
    activeSession = null;
    activeProfileKey = null;
  }
}
