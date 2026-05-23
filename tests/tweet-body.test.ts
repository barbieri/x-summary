import { describe, expect, it } from 'vitest';
import { plainTextToMarkdown } from '../src/browser/tweet-body.js';

describe('plainTextToMarkdown', () => {
  it('wraps anchor text with markdown links', () => {
    const markdown = plainTextToMarkdown('See spacex.com/launches/stars', [
      { text: 'spacex.com/launches/stars', href: 'https://t.co/abc123' },
    ]);
    expect(markdown).toBe('See [spacex.com/launches/stars](https://t.co/abc123)');
  });
});
