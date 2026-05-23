import { promises as dns } from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractPageMetadata,
  isHtmlContentType,
  resolveFinalUrl,
  resolveLink,
} from '../src/links/resolve.js';

describe('resolveFinalUrl', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
    vi.restoreAllMocks();
  });

  it('follows redirect chain to final URL', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/next' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const finalUrl = await resolveFinalUrl('https://example.com/start');
    expect(finalUrl).toBe('https://example.com/next');
  });

  it('rejects redirects to private network addresses before fetching them', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      }),
    );

    await expect(resolveFinalUrl('https://example.com/start')).rejects.toThrow(/unsafe/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects IPv6 loopback literals before fetching them', async () => {
    await expect(resolveFinalUrl('http://[::1]/admin')).rejects.toThrow(/unsafe/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private network addresses', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
    ] as never);

    await expect(resolveFinalUrl('https://metadata.example/latest')).rejects.toThrow(/unsafe/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('resolveLink', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
    vi.restoreAllMocks();
  });

  it('omits title and description when response is not HTML', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(
      new Response('not html', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const link = await resolveLink('https://example.com/data.json');
    expect(link.url).toBe('https://example.com/data.json');
    expect(link.title).toBeUndefined();
    expect(link.description).toBeUndefined();
  });

  it('returns url, title, and description from meta tags', async () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Page Title</title>
      <meta property="og:description" content="OG desc" />
      <meta name="twitter:description" content="Twitter desc" />
    </head><body></body></html>`;

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );

    const link = await resolveLink('https://example.com/article');
    expect(link.url).toBe('https://example.com/article');
    expect(link.title).toBe('Page Title');
    expect(link.description).toBe('Twitter desc');
  });

  it('rejects HTML fetch redirects to private network addresses before fetching them', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      }),
    );

    const link = await resolveLink('https://example.com/article');
    expect(link).toEqual({ url: 'https://example.com/article' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects non-http URLs before fetching', async () => {
    await expect(resolveLink('file:///etc/passwd')).rejects.toThrow(/unsafe/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('isHtmlContentType', () => {
  it('accepts text/html with charset', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
  });

  it('rejects application/json', () => {
    expect(isHtmlContentType('application/json')).toBe(false);
  });
});

describe('extractPageMetadata', () => {
  it('prefers twitter:description over og:description', () => {
    const html = `<meta property="og:description" content="OG" />
      <meta name="twitter:description" content="Twitter" />`;
    expect(extractPageMetadata(html).description).toBe('Twitter');
  });

  it('falls back to og:description', () => {
    const html = `<meta property="og:description" content="OG only" />`;
    expect(extractPageMetadata(html).description).toBe('OG only');
  });
});
