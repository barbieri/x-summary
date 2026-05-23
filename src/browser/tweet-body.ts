import type { Locator } from 'playwright';

type TweetAnchor = {
  text: string;
  href: string;
};

/** Reposter/author text only — excludes quoted-tweet preview inside role=link cards. */
export async function readOwnTweetBodyMarkdown(article: Locator): Promise<string | undefined> {
  const tweetTexts = article.locator('[data-testid="tweetText"]');
  const count = await tweetTexts.count();

  for (let i = 0; i < count; i++) {
    const tweetText = tweetTexts.nth(i);
    const inQuoteCard = await tweetText.evaluate((el) => !!el.closest('div[role="link"]'));
    if (inQuoteCard) {
      continue;
    }

    const plain = (await tweetText.innerText()).trim();
    if (!plain) {
      continue;
    }

    const anchors = await tweetText.evaluate((el) => {
      const out: { text: string; href: string }[] = [];
      for (const anchor of el.querySelectorAll('a[href]')) {
        out.push({
          text: (anchor.textContent ?? '').trim(),
          href: anchor.getAttribute('href') ?? '',
        });
      }
      return out;
    });

    return plainTextToMarkdown(plain, anchors);
  }

  return undefined;
}

export function plainTextToMarkdown(plain: string, anchors: TweetAnchor[]): string {
  let markdown = plain;
  for (const { text, href } of anchors) {
    const absolute = toAbsoluteAnchorHref(href);
    if (!text || markdown.includes(`](${absolute})`)) {
      continue;
    }
    markdown = markdown.replace(text, `[${text}](${absolute})`);
  }
  return markdown;
}

function toAbsoluteAnchorHref(href: string): string {
  if (href.startsWith('http')) {
    return href;
  }
  if (href.startsWith('/')) {
    return `https://x.com${href}`;
  }
  return href;
}
