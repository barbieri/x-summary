import { resolve } from 'node:path';
import type { AppConfig } from '../types/config.js';

export const DEFAULT_BROWSER_PROFILE_PATH = './tmp/browser-profile';

/** Absolute path to the on-disk Chrome user-data directory (cookies, localStorage, etc.). */
export function resolveBrowserProfilePath(
  config: Pick<AppConfig, 'browserProfilePath'>,
  cwd: string = process.cwd(),
): string {
  const relative = config.browserProfilePath ?? DEFAULT_BROWSER_PROFILE_PATH;
  return resolve(cwd, relative);
}
