/**
 * Turns whatever an AI model says back into typed rows the app can merge.
 *
 * The prompt asks for a strict JSON array; the parser assumes nothing. Models wrap answers
 * in prose or code fences, print "₹59-61" where a number was requested, and happily
 * invent a date - so every field is coerced and range-checked here, and a row that cannot
 * be believed is dropped rather than shown. Nothing in this file touches the network.
 */

import type { IPO } from '../types';
import { SENTINEL_YEAR, toIsoDate, within, type LiveAiRow } from '../live/parse';

export interface ExtractResult {
  rows: LiveAiRow[];
  /** rows the model returned that could not be believed */
  rejected: number;
  /** one line per rejection, for the diagnostics panel */
  reasons: string[];
}

export interface PromptOptions {
  /** how many issues to ask about - each one costs tokens */
  limit?: number;
  now?: Date;
}

/** The prompt: strict JSON out, nothing invented, only the issues we handed over. */
export function boardPrompt(ipos: IPO[], options: PromptOptions = {}): { system: string; user: string } {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 12;
  const chosen = ipos.slice(0, limit);

  const system = [
    'You are a market-data extractor for Indian IPOs (NSE/BSE mainboard and SME).',
    'You use web search to find the LATEST published grey market premium (GMP) and subscription figures.',
    'You answer with raw JSON only: no prose, no markdown, no code fences.',
  ].join(' ');

  const lines = [
    'Find the latest figures for each IPO below and return ONE JSON array with one object per IPO.',
    '',
    'Object shape (use null for anything you cannot verify, never a guess):',
    '{',
    '  "name": "<name exactly as written below>",',
    '  "gmp": <grey market premium in rupees over the upper band, number or null>,',
    '  "gmpUpdated": "<ISO 8601 timestamp of that quote, or null>",',
    '  "priceBandLow": <rupees, number or null>,',
    '  "priceBandHigh": <rupees, number or null>,',
    '  "subscriptionTotal": <times subscribed, number or null>,',
    '  "openDate": "<YYYY-MM-DD or null>",',
    '  "closeDate": "<YYYY-MM-DD or null>",',
    '  "asOf": "<ISO 8601 timestamp for when these figures were published, or null>",',
    '  "sourceUrl": "<the page you took the figures from, or null>"',
    '}',
    '',
    'Rules:',
    '- GMP is the grey market premium, not the price band and not the listing price.',
    '- Quote the newest figure you can find, and put its timestamp in asOf.',
    '- If you cannot find an IPO at all, leave it out of the array - do not invent a row.',
    '- Never repeat a previous day\u2019s number as if it were current.',
    '',
    `Today is ${now.toISOString().slice(0, 10)}.`,
    '',
    'IPOs:',
  ];

  for (const ipo of chosen) {
    const band =
      ipo.priceBandLow !== undefined && ipo.priceBandHigh !== undefined
        ? `band \u20b9${ipo.priceBandLow}-${ipo.priceBandHigh}`
        : 'band not published';
    lines.push(
      `- ${ipo.name} (${ipo.segment}, ${band}, bidding ${ipo.openDate} to ${ipo.closeDate}, listed as ${ipo.platform})`
    );
  }

  return { system, user: lines.join('\n') };
}

/* ------------------------------------------------------------------ coercion */

/** "₹1,250", "+24", "2.41x", "1 250" -> 1250 / 24 / 2.41 */
export function toNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/[₹,\s]/g, '').replace(/x$/i, '');
  if (!cleaned || /^(n\/?a|tba|null|none|unknown|-)$/i.test(cleaned)) return undefined;
  const match = /^[-+]?\d+(?:\.\d+)?/.exec(cleaned);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** "14 Sep 2026" or "Sep 14, 2026" -> "2026-09-14" (the boards print the day first). */
function anyIsoDate(raw: string): string | undefined {
  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/.exec(raw);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    if (month) return `${dayFirst[3]}-${month}-${dayFirst[1].padStart(2, '0')}`;
  }
  return toIsoDate(raw);
}

/** Accepts an ISO instant, or the "14 Sep 2026, 5:30 PM IST" the boards print. */
export function toIsoInstant(raw: unknown, now = new Date()): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const text = raw.trim();
  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) {
    const iso = new Date(direct);
    if (iso.getUTCFullYear() >= SENTINEL_YEAR) return undefined;
    // a stamp more than a day ahead of the phone's clock is not a published figure
    if (iso.getTime() > now.getTime() + 86400000) return undefined;
    return iso.toISOString();
  }
  const day = anyIsoDate(text);
  if (!day) return undefined;
  if (Number(day.slice(0, 4)) >= SENTINEL_YEAR) return undefined;
  const clock = /(\d{1,2})[:.](\d{2})\s*(am|pm)?/i.exec(text);
  let hour = clock ? Number(clock[1]) % 12 : 12;
  if (clock && /pm/i.test(clock[3] ?? '')) hour += 12;
  const minute = clock ? Number(clock[2]) : 0;
  const iso = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);
  if (Number.isNaN(iso.getTime())) return undefined;
  if (iso.getTime() > now.getTime() + 86400000) return undefined;
  return iso.toISOString();
}

function asString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/** One model object -> one believable row (or a reason it is not). */
export function coerceRow(entry: unknown, now = new Date()): { row?: LiveAiRow; reason?: string } {
  if (!entry || typeof entry !== 'object') return { reason: 'not an object' };
  const record = entry as Record<string, unknown>;
  const name = asString(record.name ?? record.ipo ?? record.issue);
  if (!name) return { reason: 'no name' };

  const bandLow = within(toNumber(record.priceBandLow ?? record.bandLow), 1, 200000);
  const bandHigh = within(toNumber(record.priceBandHigh ?? record.bandHigh ?? record.priceBand), bandLow ?? 1, 200000);
  const gmp = within(toNumber(record.gmp ?? record.greyMarketPremium ?? record.premium), -5000, 5000);
  const subscriptionTotal = within(
    toNumber(record.subscriptionTotal ?? record.subscription ?? record.totalSubscription),
    0,
    50000
  );
  const openDate = toIsoDate(asString(record.openDate) ?? undefined);
  const closeDate = toIsoDate(asString(record.closeDate) ?? undefined);
  const safeDate = (value: string | undefined) =>
    value && Number(value.slice(0, 4)) < SENTINEL_YEAR ? value : undefined;
  const gmpUpdated = toIsoInstant(record.gmpUpdated ?? record.gmpAsOf ?? record.updatedAt, now);
  const asOf = toIsoInstant(record.asOf ?? record.updated ?? record.timestamp, now);
  const sourceUrl = /^https?:\/\//i.test(asString(record.sourceUrl) ?? '') ? asString(record.sourceUrl) : undefined;

  const row: LiveAiRow = {
    name,
    id: asString(record.id)?.toLowerCase(),
    gmp,
    gmpUpdated,
    bandLow,
    bandHigh,
    subscriptionTotal,
    subscriptionAsOf: asOf,
    openDate: safeDate(openDate),
    closeDate: safeDate(closeDate),
    asOf,
    sourceUrl,
  };

  const carriesSomething =
    row.gmp !== undefined ||
    row.bandLow !== undefined ||
    row.subscriptionTotal !== undefined ||
    row.openDate !== undefined ||
    row.closeDate !== undefined ||
    row.gmpUpdated !== undefined;
  if (!carriesSomething) return { reason: `${name}: no figure in the row` };
  return { row };
}

/* -------------------------------------------------------------------- parsing */

/** Pulls the first JSON array out of a reply, fenced or surrounded by prose. */
export function extractJsonArray(text: string): unknown[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, ' ').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  const slice = cleaned.slice(start, end + 1);
  const attempts = [slice, slice.replace(/,\s*([\]}])/g, '$1'), slice.replace(/'/g, '"')];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') {
        const inner = Object.values(parsed as Record<string, unknown>).find((value) => Array.isArray(value));
        if (Array.isArray(inner)) return inner;
      }
    } catch {
      // try the next repair
    }
  }
  return null;
}

/** Line-based fallback for a model that ignored the JSON instruction. */
function scanLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/^[-*•]\s*/, '');
    if (!trimmed) continue;
    const name = /^(?:\d+[.)]\s*)?([A-Za-z][A-Za-z0-9&.\s'()-]{2,40}?)\s*[:\-–]\s*(.+)$/.exec(trimmed);
    if (!name) continue;
    const rest = name[2];
    const gmp = /(?:gmp|premium)[^\d₹+-]*([₹+-]?\s?[\d,]+(?:\.\d+)?)/i.exec(rest);
    const subs = /([\d.,]+)\s*x\b/i.exec(rest);
    const band = /([\d,]{2,9})\s*[-–]\s*([\d,]{2,9})/.exec(rest);
    out.push({
      name: name[1].trim(),
      gmp: gmp ? gmp[1] : undefined,
      subscriptionTotal: subs ? subs[1] : undefined,
      priceBandLow: band ? band[1] : undefined,
      priceBandHigh: band ? band[2] : undefined,
      asOf: /(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}[^|]*)/.exec(rest)?.[1],
    });
  }
  return out;
}

/** Model reply -> believable rows. */
export function extractRows(text: string, options: { now?: Date; limit?: number } = {}): ExtractResult {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 40;
  const array = extractJsonArray(text);
  const entries = array ?? scanLines(text);
  const rows: LiveAiRow[] = [];
  const reasons: string[] = [];
  let rejected = 0;

  for (const entry of entries.slice(0, limit)) {
    const { row, reason } = coerceRow(entry, now);
    if (row) rows.push(row);
    else {
      rejected += 1;
      if (reasons.length < 4 && reason) reasons.push(reason);
    }
  }

  if (entries.length === 0) reasons.push('the reply carried no JSON array and no readable rows');
  return { rows, rejected, reasons };
}

/** The IPOs worth asking about: the ones whose figures can still move. */
export function picksForSearch(ipos: IPO[], now = new Date(), limit = 12): IPO[] {
  const today = now.toISOString().slice(0, 10);
  const rank = (ipo: IPO): number => {
    if (ipo.openDate <= today && ipo.closeDate >= today) return 0; // bidding now
    if (ipo.openDate > today) return 1; // opens in the future
    return 2; // recently listed - premium still moves
  };
  return [...ipos]
    .sort((a, b) => rank(a) - rank(b) || b.closeDate.localeCompare(a.closeDate) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
