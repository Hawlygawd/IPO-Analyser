/**
 * Merges a freshly parsed live page set over the bundled snapshot.
 *
 * Rules that keep the app honest:
 *  - the bundled snapshot is the base; live rows only ever overwrite the fields the
 *    upstream page actually published (a live page never invents a lot size, sector
 *    or issue size it did not carry);
 *  - a live row that says "no quote recorded" clears a stale bundled GMP instead of
 *    leaving an old number on screen;
 *  - brand new issues that only exist live are appended, but only when upstream
 *    published enough to render them (a price band plus the bidding window);
 *  - nothing is dropped: an IPO that disappeared upstream stays in the board.
 */

import { IPO, Platform, Segment, MilestoneKey } from '../types';
import { addDays, parseISO } from '../format';
import type {
  LiveAiRow,
  LiveCalendarDay,
  LiveCalendarEvent,
  LiveCard,
  LiveGmpParse,
  LiveSubscriptionRow,
  ParsedLive,
} from './parse';

export type LiveSourceKey = 'gmp' | 'subscription' | 'calendar' | 'cards' | 'ai';

export interface LiveSourceStatus {
  key: LiveSourceKey;
  label: string;
  ok: boolean;
  asOf?: string;
  rows?: number;
  error?: string;
  /** who answered (the AI assist names the provider and model here) */
  note?: string;
}

export interface LiveBoard {
  ipos: IPO[];
  /** newest upstream stamp we could prove (quote time, else fetched time) */
  asOf: string;
  fetchedAt: number;
  sources: LiveSourceStatus[];
  /** IPOs whose figures changed on this pull */
  updated: number;
  /** issues this pull discovered that the bundled snapshot did not carry */
  added: number;
  /** issues whose figures came from the AI assist rather than from the boards */
  aiApplied: number;
}

export const SOURCE_LABELS: Record<LiveSourceKey, string> = {
  gmp: 'GMP board',
  subscription: 'Live subscription report',
  calendar: 'Event calendar',
  cards: 'Current & upcoming issues',
  ai: 'AI web search',
};

/* --------------------------------------------------------------- matching */

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(ltd|limited|pvt|private|ipo)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** every key an upstream row could be filed under for this bundled IPO */
function keysOf(ipo: IPO): string[] {
  const slug = /\/ipo\/([^/?#]+)/.exec(ipo.sourceUrl)?.[1] ?? '';
  const keys = [slug, ipo.id, normalise(ipo.name)].filter(Boolean);
  return [...new Set(keys.map((key) => key.toLowerCase()))];
}

function makeMatcher(ipos: IPO[]) {
  const index = new Map<string, IPO>();
  for (const ipo of ipos) for (const key of keysOf(ipo)) if (!index.has(key)) index.set(key, ipo);

  return (id: string, name: string): IPO | undefined => {
    const direct = index.get(id.toLowerCase()) ?? index.get(normalise(name).toLowerCase());
    if (direct) return direct;

    // last resort: one name contains the other ("Manipal Payment & Identity" vs
    // "... Identity Solutions"). Only between 6+ character names, and never for a
    // name that already matched something else.
    const target = normalise(name);
    if (target.length < 6) return undefined;
    let best: IPO | undefined;
    let bestRatio = 0;
    for (const ipo of ipos) {
      const candidate = normalise(ipo.name);
      if (candidate.length < 6) continue;
      if (!candidate.includes(target) && !target.includes(candidate)) continue;
      const ratio = Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = ipo;
      }
    }
    return bestRatio >= 0.6 ? best : undefined;
  };
}

/* ------------------------------------------------------------- date helpers */

function workingDay(iso: string, offset: number): string {
  let date = parseISO(iso);
  let remaining = offset;
  while (remaining > 0) {
    date = addDays(date, 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const MILESTONE_BY_STATUS: Record<string, MilestoneKey> = {
  OPEN: 'open',
  OPENING: 'open',
  CLOSE: 'close',
  CLOSING: 'close',
  ALLOTMENT: 'allotment',
  ALLOTMENT_FINAL: 'allotment',
  LISTING: 'listing',
  LISTED: 'listing',
};

interface LiveRow {
  gmp?: LiveGmpParse['rows'][number];
  sub?: LiveSubscriptionRow;
  card?: LiveCard;
  /** figures the AI assist found; the lowest-precedence source by design */
  ai?: LiveAiRow;
  events: LiveCalendarEvent[];
}

/* ------------------------------------------------------------------- merge */

export function mergeBoard(
  bundled: IPO[],
  live: ParsedLive,
  meta: { fetchedAt: number; sources: LiveSourceStatus[] }
): LiveBoard {
  const match = makeMatcher(bundled);
  const rows = new Map<string, LiveRow>();
  const rowFor = (ipo: IPO): LiveRow => {
    const existing = rows.get(ipo.id);
    if (existing) return existing;
    const created: LiveRow = { events: [] };
    rows.set(ipo.id, created);
    return created;
  };

  for (const row of live.gmp.rows) {
    const ipo = match(row.id, row.name);
    if (ipo) rowFor(ipo).gmp = row;
  }

  for (const row of live.subscription.rows) {
    const ipo = match(row.id, row.name);
    if (ipo) rowFor(ipo).sub = row;
  }

  for (const card of live.cards) {
    const ipo = match(card.id, card.name);
    if (ipo) rowFor(ipo).card = card;
  }

  // The AI assist only ever fills gaps on issues the board already carries: a name match
  // against the bundled ids. Rows it cannot match are ignored rather than guessed at,
  // because a model can be wrong about which issue a figure belongs to.
  for (const row of live.ai.rows) {
    const ipo = match(row.id ?? '', row.name);
    if (ipo) rowFor(ipo).ai = row;
  }

  for (const day of live.calendar) {
    for (const event of day.events) {
      if (event.status === 'HOLIDAY') continue; // market holidays are not IPO milestones
      const ipo = match(event.slug ?? '', event.name);
      if (ipo) rowFor(ipo).events.push(event);
    }
  }

  let updated = 0;
  let added = 0;
  let aiApplied = 0;
  const board = bundled.map((ipo) => {
    const row = rows.get(ipo.id);
    if (!row) return ipo;
    const next = applyLive(ipo, row);
    if (next.aiFilled && !ipo.aiFilled) aiApplied += 1;
    if (!sameIpo(ipo, next)) updated += 1;
    return next;
  });

  const known = new Set(bundled.map((ipo) => ipo.id));
  const discovered: IPO[] = [];
  const candidates = new Map<string, LiveRow>();
  for (const row of live.gmp.rows) {
    const ipo = match(row.id, row.name);
    if (ipo || known.has(row.id)) continue;
    candidates.set(row.id, { gmp: row, events: [] });
  }
  for (const card of live.cards) {
    const existing = candidates.get(card.id);
    if (existing) existing.card = card;
    else if (!known.has(card.id) && !match(card.id, card.name)) candidates.set(card.id, { card, events: [] });
  }
  for (const day of live.calendar) {
    for (const event of day.events) {
      if (event.status === 'HOLIDAY' || !event.slug) continue;
      const id = event.slug.replace(/-ipo$/, '');
      const row = candidates.get(id);
      if (row) row.events.push(event);
      else if (!known.has(id) && !match(event.slug, event.name)) candidates.set(id, { events: [event] });
    }
  }

  for (const [id, row] of candidates) {
    const built = buildIpo(id, row, new Date(meta.fetchedAt));
    if (built) {
      discovered.push(built);
      added += 1;
    }
  }
  discovered.sort((a, b) => a.openDate.localeCompare(b.openDate));

  const stamps = [
    live.gmp.asOf,
    live.subscription.asOf,
    live.ai.asOf,
    ...board.map((ipo) => ipo.gmpUpdated),
  ].filter((value): value is string => Boolean(value));
  const asOf = stamps.length
    ? new Date(Math.max(...stamps.map((value) => new Date(value).getTime()))).toISOString()
    : new Date(meta.fetchedAt).toISOString();

  return {
    ipos: [...board, ...discovered],
    asOf,
    fetchedAt: meta.fetchedAt,
    sources: meta.sources,
    updated,
    added,
    aiApplied,
  };
}

function applyLive(ipo: IPO, row: LiveRow): IPO {
  const next: IPO = { ...ipo, subscription: ipo.subscription ? { ...ipo.subscription } : undefined };
  // which figures the AI assist actually changed; anything a published row overwrites below
  // is dropped again, so `aiFilled` never claims credit for board data
  const byAi = new Set<'gmp' | 'band' | 'subscription' | 'dates'>();

  if (row.ai) {
    const ai = row.ai;
    if (ai.gmp !== undefined) {
      if (ai.gmp !== ipo.gmp) byAi.add('gmp');
      next.gmp = ai.gmp;
    }
    if (ai.gmpUpdated) next.gmpUpdated = ai.gmpUpdated;
    if (ai.bandLow !== undefined) {
      if (ai.bandLow !== ipo.priceBandLow) byAi.add('band');
      next.priceBandLow = ai.bandLow;
    }
    if (ai.bandHigh !== undefined) {
      if (ai.bandHigh !== ipo.priceBandHigh) byAi.add('band');
      next.priceBandHigh = ai.bandHigh;
    }
    if (ai.openDate) {
      if (ai.openDate !== ipo.openDate) byAi.add('dates');
      next.openDate = ai.openDate;
    }
    if (ai.closeDate) {
      if (ai.closeDate !== ipo.closeDate) byAi.add('dates');
      next.closeDate = ai.closeDate;
    }
    if (ai.subscriptionTotal !== undefined) {
      if (ai.subscriptionTotal !== ipo.subscription?.total) byAi.add('subscription');
      next.subscription = {
        ...next.subscription,
        total: ai.subscriptionTotal,
        asOf: next.subscription?.asOf ?? (ai.subscriptionAsOf ? istLabel(ai.subscriptionAsOf) : undefined),
      };
    }
    if (ai.sourceUrl) next.aiSourceUrl = ai.sourceUrl;
    next.aiFilled = byAi.size > 0;
  }

  // Everything below is published board data, so it wins over the AI assist on every field
  // it carries - including a row that says "no quote recorded", which clears a stale value.
  if (row.gmp) {
    const gmp = row.gmp;
    next.gmp = gmp.gmp;
    next.gmpUpdated = gmp.gmp !== undefined ? gmp.updatedAt ?? ipo.gmpUpdated : undefined;
    byAi.delete('gmp');
    if (gmp.bandLow !== undefined) {
      next.priceBandLow = gmp.bandLow;
      byAi.delete('band');
    }
    if (gmp.bandHigh !== undefined) {
      next.priceBandHigh = gmp.bandHigh;
      byAi.delete('band');
    }
    if (gmp.openDate) {
      next.openDate = gmp.openDate;
      byAi.delete('dates');
    }
    if (gmp.closeDate) {
      next.closeDate = gmp.closeDate;
      byAi.delete('dates');
    }
    if (gmp.platform) next.platform = gmp.platform as Platform;
    if (gmp.segment) next.segment = gmp.segment as Segment;
  }

  if (row.card && !row.gmp) {
    if (row.card.openDate) next.openDate = row.card.openDate;
    if (row.card.closeDate) next.closeDate = row.card.closeDate;
  }

  if (row.sub) {
    next.subscription = {
      ...next.subscription,
      qib: row.sub.qib ?? next.subscription?.qib,
      nii: row.sub.nii ?? next.subscription?.nii,
      retail: row.sub.retail ?? next.subscription?.retail,
      total: row.sub.total ?? next.subscription?.total,
      asOf: row.sub.updatedAt ? istLabel(row.sub.updatedAt) : next.subscription?.asOf,
    };
    if (row.sub.total !== undefined) byAi.delete('subscription');
    if (row.sub.platform) next.platform = row.sub.platform as Platform;
  }

  const tentative = new Set<MilestoneKey>(ipo.tentativeDates);
  for (const event of row.events) {
    const key = MILESTONE_BY_STATUS[event.status] ?? MILESTONE_BY_STATUS[event.statusLabel];
    if (!key) continue;
    const date = event.date;
    if (key === 'open') next.openDate = date;
    if (key === 'close') next.closeDate = date;
    if (key === 'allotment') next.allotmentDate = date;
    if (key === 'listing') next.listingDate = date;
    tentative.delete(key);
    byAi.delete('dates');
  }
  next.tentativeDates = [...tentative];

  if (byAi.size === 0) {
    next.aiFilled = undefined;
    next.aiSourceUrl = undefined;
  }

  return next;
}

function buildIpo(id: string, row: LiveRow, now: Date): IPO | null {
  const name = row.gmp?.name ?? row.card?.name ?? row.events[0]?.name;
  const openDate = row.gmp?.openDate ?? row.card?.openDate ?? row.events.find((e) => MILESTONE_BY_STATUS[e.status] === 'open')?.date;
  const closeDate = row.gmp?.closeDate ?? row.card?.closeDate ?? row.events.find((e) => MILESTONE_BY_STATUS[e.status] === 'close')?.date;
  if (!name || !openDate || !closeDate) return null;

  const segment: Segment = row.gmp?.segment ?? row.card?.segment ?? (row.events[0]?.board?.toUpperCase().includes('SME') ? 'SME' : 'Mainboard');
  // Upstream publishes the exchange only for SME issues (BSE SME / NSE SME). For a mainboard
  // issue it just says "Mainboard", so the platform below is a display default and `exchanges`
  // stays empty rather than claiming a listing we cannot back up.
  const publishedPlatform = [row.gmp?.platform, row.sub?.platform, row.card ? undefined : row.events[0]?.board]
    .find((value): value is string => Boolean(value && /^(nse|bse)( sme)?$/i.test(value))) as Platform | undefined;
  // a card badge sometimes names the exchanges ("BSE, NSE"), which is the only place upstream
  // says anything about a mainboard issue's listing venue
  const namedExchanges = row.card?.exchanges ?? [];
  const tentative: MilestoneKey[] = [];

  const eventDate = (status: MilestoneKey) =>
    row.events.find((event) => MILESTONE_BY_STATUS[event.status] === status)?.date;

  const allotmentDate = eventDate('allotment') ?? workingDay(closeDate, 1);
  if (!eventDate('allotment')) tentative.push('allotment');
  const listingDate = eventDate('listing') ?? workingDay(closeDate, 3);
  if (!eventDate('listing')) tentative.push('listing');

  return {
    id,
    name,
    segment,
    platform:
      publishedPlatform ??
      (segment === 'SME' ? 'BSE SME' : ((namedExchanges[0] as Platform) || 'NSE')),
    openDate,
    closeDate,
    allotmentDate,
    listingDate,
    tentativeDates: tentative,
    priceBandLow: row.gmp?.bandLow ?? row.card?.bandLow,
    priceBandHigh: row.gmp?.bandHigh ?? row.card?.bandHigh ?? row.card?.bandLow,
    lotSize: row.card?.lotSize,
    issueSizeCr: row.card?.issueSizeCr,
    exchanges: publishedPlatform ? [publishedPlatform] : namedExchanges,
    gmp: row.gmp?.gmp ?? row.card?.premiumHigh ?? row.card?.premiumLow,
    gmpUpdated: row.gmp?.updatedAt,
    subscription:
      row.sub || row.card?.subscriptionTotal !== undefined
        ? {
            qib: row.sub?.qib,
            nii: row.sub?.nii,
            retail: row.sub?.retail,
            total: row.sub?.total ?? row.card?.subscriptionTotal,
            asOf: row.sub?.updatedAt ? istLabel(row.sub.updatedAt) : undefined,
          }
        : undefined,
    about: `Picked up live from the IPO Ji boards on ${istLabel(now.toISOString())}. Open the source page for the full issue details before you bid.`,
    sourceName: 'IPO Ji (live)',
    sourceUrl: row.gmp?.url ?? row.card?.url ?? `https://www.ipoji.com/ipo/${id}-ipo`,
  };
}

/** "14 Sep 2026, 5:30 PM IST" - the style both the site and the app use. */
export function istLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // built by hand rather than with a locale: Hermes and node disagree on
  // "Sep" vs "Sept" and on the day period casing.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const month = MONTH_LABELS[Number(get('month')) - 1] ?? get('month');
  const hour = String(Number(get('hour')));
  return `${get('day')} ${month} ${get('year')}, ${hour}:${get('minute')} ${get('dayPeriod').toUpperCase()} IST`;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sameIpo(a: IPO, b: IPO): boolean {
  const fields: (keyof IPO)[] = [
    'gmp',
    'gmpUpdated',
    'priceBandLow',
    'priceBandHigh',
    'openDate',
    'closeDate',
    'allotmentDate',
    'listingDate',
    'platform',
    'segment',
    'aiFilled',
  ];
  if (fields.some((field) => a[field] !== b[field])) return true;
  const sa = a.subscription ?? {};
  const sb = b.subscription ?? {};
  return (
    sa.qib !== sb.qib ||
    sa.nii !== sb.nii ||
    sa.retail !== sb.retail ||
    sa.total !== sb.total ||
    sa.asOf !== sb.asOf
  );
}
