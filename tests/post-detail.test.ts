import { describe, expect, it } from 'vitest';
import { canonicalFeedHref, syntheticRepostHref } from '../src/browser/article-fields.js';

describe('syntheticRepostHref', () => {
  it('builds repost://handle@status URL', () => {
    const href = syntheticRepostHref('@reposter', 'https://x.com/reposter/status/99');
    expect(href).toBe('repost://reposter@https://x.com/reposter/status/99');
  });

  it('canonicalFeedHref extracts status URL from synthetic href', () => {
    const synthetic = syntheticRepostHref('alice', 'https://x.com/alice/status/1');
    expect(canonicalFeedHref(synthetic)).toBe('https://x.com/alice/status/1');
  });
});
