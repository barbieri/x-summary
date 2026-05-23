import type { BrowserContext } from 'playwright';

/** X session cookies set after a successful login (not present during FedCM/onboarding errors). */
export async function hasXAuthCookies(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies();
  const xCookies = cookies.filter((cookie) => /x\.com|twitter\.com/i.test(cookie.domain));

  const authToken = xCookies.find((c) => c.name === 'auth_token' && c.value.length > 0);
  const ct0 = xCookies.find((c) => c.name === 'ct0' && c.value.length > 0);

  return Boolean(authToken && ct0);
}

export const X_LOGIN_URL = 'https://x.com/i/flow/login';

export type ManualLoginReason = 'login' | 'owner-mismatch';

export function manualLoginWindowGuidance(
  reason: ManualLoginReason,
  expectedOwner: string,
): string {
  const base = [
    'A separate Chrome window opens (no Playwright remote debugging).',
    'Use X username/email and password — not Google Sign-In.',
  ];

  if (reason === 'owner-mismatch') {
    return [
      ...base,
      `Sign in as @${expectedOwner} (or switch to that account).`,
      'Quit Chrome completely when the correct account is active (close the browser, not just a tab).',
    ].join(' ');
  }

  return [
    ...base,
    'Complete onboarding until you reach the home timeline, then quit Chrome completely.',
  ].join(' ');
}
