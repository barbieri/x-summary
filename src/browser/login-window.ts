import { type BrowserContext, chromium } from 'playwright';
import type { ScrapeLogger } from '../logger.js';
import { type ManualLoginReason, manualLoginWindowGuidance, X_LOGIN_URL } from './auth.js';
import { loginContextOptions } from './stealth.js';

/**
 * Launch Chrome for manual login (no automation pipes). Blocks until the user closes the browser.
 * Cookies are written to `profilePath` when the browser process exits.
 */
export async function runManualLoginWindow(
  profilePath: string,
  log: ScrapeLogger,
  reason: ManualLoginReason,
  expectedOwner: string,
): Promise<void> {
  const guidance = manualLoginWindowGuidance(reason, expectedOwner);
  const action = reason === 'owner-mismatch' ? 'change user' : 'sign in with email/password';

  log.warn(
    {
      profilePath,
      reason,
      expectedOwner,
      guidance,
      loginUrl: X_LOGIN_URL,
    },
    'opening manual login window — %s for owner %s at %s, then quit Chrome when done',
    action,
    expectedOwner,
    X_LOGIN_URL,
  );

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profilePath, loginContextOptions());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/process_singleton|singleton|user data dir|profile/i.test(message)) {
      if (message.includes('browser has been closed')) {
        log.info({ profilePath }, 'login browser closed; profile saved to disk');
        return;
      }

      log.error(
        { profilePath, err: error },
        'cannot open login window — profile locked at %s. Close other Chrome windows using this profile. Error: %s',
        profilePath,
        error,
      );
      throw new Error(
        `Cannot open login window — profile locked at ${profilePath}. Close other Chrome windows using this profile.`,
      );
    }
    throw error;
  }

  await context.close();
  throw new Error(
    'Unexpected: launching a browser window without remote debugging pipes should fail',
  );
}
