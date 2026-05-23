import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import type { ResolvedLink } from '../types/post.js';

const MAX_REDIRECTS = 10;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 512_000;

const DESCRIPTION_META_KEYS = ['twitter:description', 'og:description', 'description'] as const;

/**
 * Follow redirects, fetch HTML, and extract title plus description meta tags.
 */
export async function resolveLink(
  url: string,
  options?: { maxRedirects?: number; signal?: AbortSignal },
): Promise<ResolvedLink> {
  const finalUrl = await resolveFinalUrl(url, options);
  try {
    const fetched = await fetchHtmlIfHtml(finalUrl, options?.signal);
    if (!fetched) {
      return { url: finalUrl };
    }
    const { title, description } = extractPageMetadata(fetched);

    return {
      url: finalUrl,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    };
  } catch {
    return { url: finalUrl };
  }
}

export async function resolveLinks(
  urls: string[],
  cache?: Map<string, ResolvedLink>,
): Promise<ResolvedLink[]> {
  const unique = [...new Set(urls)];
  const results: ResolvedLink[] = [];

  for (const url of unique) {
    const cached = cache?.get(url);
    if (cached) {
      results.push(cached);
      continue;
    }
    const resolved = await resolveLink(url);
    cache?.set(url, resolved);
    results.push(resolved);
  }

  return results;
}

/** @internal Redirect resolution only (no HTML). */
export async function resolveFinalUrl(
  url: string,
  options?: { maxRedirects?: number; signal?: AbortSignal },
): Promise<string> {
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS;
  let current = new URL(url);

  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeExternalHttpUrl(current);
    const head = await fetchWithTimeout(current.toString(), {
      method: 'HEAD',
      redirect: 'manual',
      ...signalInit(options?.signal),
    });
    const headNext = redirectTarget(current, head);
    if (headNext) {
      await assertSafeExternalHttpUrl(headNext);
      current = headNext;
      continue;
    }

    if (head.status === 405 || head.status === 501) {
      const get = await fetchWithTimeout(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        ...signalInit(options?.signal),
      });
      const getNext = redirectTarget(current, get);
      if (getNext) {
        await assertSafeExternalHttpUrl(getNext);
        current = getNext;
        continue;
      }
    }

    return current.toString();
  }

  throw new Error(`Too many redirects resolving ${url}`);
}

export function extractPageMetadata(html: string): { title?: string; description?: string } {
  const title = extractTitle(html);
  const description = extractDescription(html);
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = match?.[1]?.trim();
  return title || undefined;
}

function extractDescription(html: string): string | undefined {
  const metas = parseMetaTags(html);
  for (const key of DESCRIPTION_META_KEYS) {
    const value = metas.get(key);
    if (value) {
      return value;
    }
  }
  for (const [name, value] of metas) {
    if (name.endsWith(':description') || name === 'description') {
      return value;
    }
  }
  return undefined;
}

function parseMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const tagPattern = /<meta\s+[^>]*>/gi;

  for (const tag of html.matchAll(tagPattern)) {
    const attrs = parseAttributes(tag[0] ?? '');
    const name = attrs.name ?? attrs.property;
    const content = attrs.content;
    if (name && content) {
      map.set(name.toLowerCase(), decodeHtmlEntities(content));
    }
  }

  return map;
}

type MetaAttributes = {
  name?: string;
  property?: string;
  content?: string;
};

function parseAttributes(tag: string): MetaAttributes {
  const attrs: MetaAttributes = {};
  const attrPattern = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g;
  for (const match of tag.matchAll(attrPattern)) {
    const key = match[1]?.toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (key === 'name' || key === 'property' || key === 'content') {
      attrs[key] = value;
    }
  }
  return attrs;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'text/html' || base === 'application/xhtml+xml';
}

async function fetchHtmlIfHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  let current = new URL(url);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertSafeExternalHttpUrl(current);
    const response = await fetchWithTimeout(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      ...signalInit(signal),
    });

    const next = redirectTarget(current, response);
    if (next) {
      await assertSafeExternalHttpUrl(next);
      current = next;
      continue;
    }

    return await readHtmlResponse(current.toString(), response);
  }

  throw new Error(`Too many redirects fetching HTML for ${url}`);
}

async function readHtmlResponse(url: string, response: Response): Promise<string | null> {
  if (!response.ok) {
    throw new Error(`Failed to fetch HTML for ${url}: HTTP ${response.status}`);
  }

  if (!isHtmlContentType(response.headers.get('content-type'))) {
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.length;
      if (total > MAX_HTML_BYTES) {
        break;
      }
      chunks.push(value);
    }
  }

  return new TextDecoder().decode(concatChunks(chunks));
}

/** @internal Exported for tests. */
export { isHtmlContentType };

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function redirectTarget(base: URL, response: Response): URL | null {
  if (!isRedirect(response.status)) {
    return null;
  }
  const location = response.headers.get('location');
  if (!location) {
    return base;
  }
  return new URL(location, base);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function assertSafeExternalHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsafe URL protocol: ${url.protocol}`);
  }

  const host = normalizeUrlHostname(url.hostname);
  if (isLocalHostname(host)) {
    throw new Error(`Unsafe local URL host: ${url.hostname}`);
  }

  if (isUnsafeIpAddress(host)) {
    throw new Error(`Unsafe private URL host: ${url.hostname}`);
  }

  if (isIP(host)) {
    return;
  }

  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error(`Could not resolve URL host: ${url.hostname}`);
  }

  for (const { address } of addresses) {
    if (isUnsafeIpAddress(address)) {
      throw new Error(`Unsafe private URL host: ${url.hostname}`);
    }
  }
}

function isLocalHostname(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

function normalizeUrlHostname(hostname: string): string {
  const withoutTrailingDot = hostname.replace(/\.$/, '').toLowerCase();
  return withoutTrailingDot.startsWith('[') && withoutTrailingDot.endsWith(']')
    ? withoutTrailingDot.slice(1, -1)
    : withoutTrailingDot;
}

function isUnsafeIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isUnsafeIpv4Address(address);
  }
  if (family === 6) {
    return isUnsafeIpv6Address(address);
  }
  return false;
}

function isUnsafeIpv4Address(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isUnsafeIpv6Address(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isUnsafeIpv4Address(mapped);
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff')
  );
}

function signalInit(signal?: AbortSignal): Pick<RequestInit, 'signal'> {
  return signal ? { signal } : {};
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timeout);
  }
}
