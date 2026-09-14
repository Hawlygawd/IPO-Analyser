/**
 * The four public pages the app reads on every refresh.
 *
 * No API, no JSON: the site server-renders these tables, so the app downloads the
 * HTML and parse.ts turns it into rows. Keep the request shape identical to the
 * probe workflow that verified these URLs from CI (mobile Chrome user agent, plain
 * GET, redirects allowed) - the server varies its markup on user agent.
 *
 * No react-native import lives here on purpose: this module must also run in plain
 * node (the live-parse CI job and the node test runner both use it).
 */

import type { LivePages } from './parse';

export const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

export const LIVE_URLS = {
  gmp: 'https://www.ipoji.com/ipo-gmp',
  /**
   * The second GMP source. IPO Ji publishes one evening quote; this one refreshes every 30
   * minutes and stamps every row, so the board can carry the newest number anyone published.
   */
  gmpAlt: 'https://ipomarket.in/gmp/',
  subscription: 'https://www.ipoji.com/ipo-subscription-status-live-bidding-data-bse-nse',
  current: 'https://www.ipoji.com/ipo/current-ipo',
  upcoming: 'https://www.ipoji.com/ipo/upcoming-ipo',
  calendar: 'https://www.ipoji.com/ipo-event-calendar',
} as const;

export type LiveUrlKey = keyof typeof LIVE_URLS;

export interface FetchedPages {
  pages: LivePages;
  /** per-URL outcome, so the UI can say which board is stale */
  errors: Partial<Record<LiveUrlKey, string>>;
  fetchedAt: number;
}

export interface FetchOptions {
  /**
   * Web builds cannot call ipoji.com directly (the browser blocks the cross-origin
   * read), so they go through the `/api/ipoji` proxy route on the same origin.
   */
  useProxy?: boolean;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  urls?: Partial<Record<LiveUrlKey, string>>;
  /**
   * Defaults to MOBILE_UA. The server varies its markup on this header, so a client that
   * cannot set one (or a proxy) can be checked with `--alternate-agent` in
   * scripts/live-report.ts before assuming it will see the same tables.
   */
  userAgent?: string;
}

function proxied(url: string, useProxy: boolean): string {
  return useProxy ? `/api/ipoji?u=${encodeURIComponent(url)}` : url;
}

async function download(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
  userAgent = MOBILE_UA
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
      signal: controller?.signal,
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const text = await response.text();
    if (text.length < 500) return { ok: false, error: 'empty response' };
    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /abort/i.test(message) ? 'timed out' : message };
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads every source page in parallel; per-page failures never reject. */
export async function fetchLivePages(options: FetchOptions = {}): Promise<FetchedPages> {
  const { useProxy = false, timeoutMs = 15000, fetcher = fetch, userAgent } = options;
  const urls = { ...LIVE_URLS, ...options.urls };
  const keys = Object.keys(urls) as LiveUrlKey[];

  const results = await Promise.all(
    keys.map(
      async (key) =>
        [key, await download(fetcher, proxied(urls[key], useProxy), timeoutMs, userAgent)] as const
    )
  );

  const pages: LivePages = {};
  const errors: Partial<Record<LiveUrlKey, string>> = {};
  for (const [key, result] of results) {
    if (result.ok) pages[key] = result.text;
    else errors[key] = result.error;
  }
  return { pages, errors, fetchedAt: Date.now() };
}
