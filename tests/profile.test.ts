import { describe, expect, it } from 'vitest';
import { DEFAULT_BROWSER_PROFILE_PATH, resolveBrowserProfilePath } from '../src/browser/profile.js';

describe('resolveBrowserProfilePath', () => {
  it('uses default profile directory', () => {
    const path = resolveBrowserProfilePath({}, '/app');
    expect(path).toBe('/app/tmp/browser-profile');
  });

  it('resolves configured profile path', () => {
    const path = resolveBrowserProfilePath({ browserProfilePath: './custom-profile' }, '/app');
    expect(path).toBe('/app/custom-profile');
  });

  it('exports stable default constant', () => {
    expect(DEFAULT_BROWSER_PROFILE_PATH).toBe('./tmp/browser-profile');
  });
});
