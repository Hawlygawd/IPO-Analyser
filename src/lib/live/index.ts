/**
 * The live data path: download -> parse -> merge over the bundled snapshot.
 *
 * Entry point for the app (`pullLiveBoard`) and for the CI job that proves the
 * parsers still work against today's upstream markup (scripts/live-report.ts).
 */

import type { IPO } from '../types';
import { emptyParsedLive, parseLivePages, type ParsedLive } from './parse';
import {
  mergeBoard,
  SOURCE_LABELS,
  type LiveBoard,
  type LiveSourceKey,
  type LiveSourceStatus,
} from './merge';
import { fetchLivePages, type FetchOptions, type FetchedPages, type LiveUrlKey } from './sources';

export * from './parse';
export * from './merge';
export * from './sources';

/** True when a pull produced something usable, i.e. the board can be refreshed. */
export function hasLiveData(parsed: ParsedLive): boolean {
  return (
    parsed.gmp.rows.length > 0 ||
    parsed.gmpAlt.rows.length > 0 ||
    parsed.subscription.rows.length > 0 ||
    parsed.cards.length > 0 ||
    parsed.calendar.length > 0 ||
    parsed.ai.rows.length > 0
  );
}

/**
 * Every board marked unavailable, for the case where the pull did not even get far enough
 * to name a per-page error (offline phone, DNS failure). Settings lists sources one by one,
 * so it must not show a four-source pull as "nothing happened".
 */
export function failedSourceStatuses(error: string): LiveSourceStatus[] {
  return (['gmp', 'gmpAlt', 'subscription', 'cards', 'calendar'] as LiveSourceKey[]).map((key) => ({
    key,
    label: SOURCE_LABELS[key],
    ok: false,
    rows: 0,
    error,
  }));
}

export function sourceStatuses(
  parsed: ParsedLive,
  errors: Partial<Record<LiveUrlKey, string>> = {},
  fetchedAt = Date.now()
): LiveSourceStatus[] {
  const status = (key: LiveSourceKey, rows: number, asOf?: string, failed?: string): LiveSourceStatus => ({
    key,
    label: SOURCE_LABELS[key],
    ok: !failed,
    rows,
    asOf,
    error: failed,
  });

  return [
    status('gmp', parsed.gmp.rows.length, parsed.gmp.asOf, errors.gmp),
    status('gmpAlt', parsed.gmpAlt.rows.length, parsed.gmpAlt.asOf, errors.gmpAlt),
    status('subscription', parsed.subscription.rows.length, parsed.subscription.asOf, errors.subscription),
    status(
      'cards',
      parsed.cards.length,
      undefined,
      errors.current && errors.upcoming ? errors.current : undefined
    ),
    status(
      'calendar',
      parsed.calendar.reduce((sum, day) => sum + day.events.length, 0),
      parsed.calendar.length ? new Date(fetchedAt).toISOString() : undefined,
      errors.calendar
    ),
  ];
}

/**
 * Merges AI-assist rows over a base board through exactly the same rules the parsed pages
 * go through - published rows win, so this is safe to run *before* a page merge and to
 * layer underneath one.
 */
export function mergeAiResult(
  bundled: IPO[],
  result: { rows: ParsedLive['ai']['rows']; asOf?: string; rejected?: number },
  meta: { fetchedAt: number; sources: LiveSourceStatus[] }
): LiveBoard {
  return mergeBoard(
    bundled,
    emptyParsedLive({ rows: result.rows, asOf: result.asOf, rejected: result.rejected }),
    meta
  );
}

export interface PullResult {
  board: LiveBoard;
  parsed: ParsedLive;
  fetched: FetchedPages;
}

/** One full round trip. Throws only when every source failed. */
export async function pullLiveBoard(bundled: IPO[], options: FetchOptions = {}): Promise<PullResult> {
  const fetched = await fetchLivePages(options);
  const parsed = parseLivePages(fetched.pages);
  const sources = sourceStatuses(parsed, fetched.errors, fetched.fetchedAt);

  if (!hasLiveData(parsed)) {
    const detail = Object.entries(fetched.errors)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    throw new Error(detail || 'no data in the upstream pages');
  }

  return {
    board: mergeBoard(bundled, parsed, { fetchedAt: fetched.fetchedAt, sources }),
    parsed,
    fetched,
  };
}
