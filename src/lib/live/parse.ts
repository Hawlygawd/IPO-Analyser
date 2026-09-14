/**
 * Parsers for the upstream IPO Ji pages.
 *
 * The site server-renders every table we need, so the parser works on markup rather
 * than on an API (no JSON endpoint exists - verified by the source probe workflow):
 *
 *   /ipo-gmp                     -> table.gmp-table, one <tr class="gmp-row"> per IPO,
 *                                   every value also mirrored into data-* attributes
 *   /ipo-subscription-status-... -> first table.subs-overview-table, one <tr> per IPO
 *   /ipo/current-ipo, /ipo/upcoming-ipo
 *                                -> article.ipo-card with the band and expected premium
 *   /ipo-event-calendar          -> an inline `eventListData = [...]` JSON array that
 *                                   drives the calendar (this one is not markup at all)
 *
 * Everything here is pure: give it HTML, get typed rows back. Network lives in
 * sources.ts, merging lives in merge.ts.
 */

export type LiveSegment = 'Mainboard' | 'SME';

export interface LiveGmpRow {
  /** upstream slug without the trailing "-ipo" (matches the bundled IPO ids) */
  id: string;
  name: string;
  segment: LiveSegment;
  /** exchange platform as printed on the page, when it is one we know */
  platform?: string;
  statusLabel?: string;
  open?: boolean;
  gmp?: number;
  gmpPct?: number;
  indicative?: number;
  bandLow?: number;
  bandHigh?: number;
  openDate?: string;
  closeDate?: string;
  /** ISO instant of the last quote recorded for this row */
  updatedAt?: string;
  url?: string;
}

export interface LiveSubscriptionRow {
  id: string;
  name: string;
  platform?: string;
  closeDate?: string;
  qib?: number;
  nii?: number;
  retail?: number;
  total?: number;
  applications?: number;
  /** ISO instant the exchange/broker snapshot behind the row was taken */
  updatedAt?: string;
  url?: string;
}

export interface LiveCard {
  id: string;
  name: string;
  segment: LiveSegment;
  status?: string;
  /** "Exp. Premium": the expected premium over the upper band */
  premiumLow?: number;
  premiumHigh?: number;
  premiumPct?: number;
  /** "Offer Price" - the price band */
  bandLow?: number;
  bandHigh?: number;
  lotSize?: number;
  issueSizeCr?: number;
  subscriptionTotal?: number;
  /** exchanges named on the card's market badge, when it names any at all */
  exchanges: string[];
  openDate?: string;
  closeDate?: string;
  url?: string;
}

/**
 * One row produced by the AI assist (`src/lib/ai/*`): the same kind of figure the pages
 * publish, found by asking a model with web search instead of by parsing markup.
 *
 * Kept separate from the parsed page rows on purpose: the merge gives published-page rows
 * precedence over these, and the UI labels anything that came through here.
 */
export interface LiveAiRow {
  /** upstream slug, when the model knew it - matching falls back to the name */
  id?: string;
  name: string;
  /** grey market premium in ₹ over the upper band */
  gmp?: number;
  gmpUpdated?: string;
  bandLow?: number;
  bandHigh?: number;
  subscriptionTotal?: number;
  subscriptionAsOf?: string;
  openDate?: string;
  closeDate?: string;
  /** when the model says those figures were published */
  asOf?: string;
  sourceUrl?: string;
}

export interface LiveAiParse {
  rows: LiveAiRow[];
  asOf?: string;
  /** rows the model returned that could not be believed */
  rejected?: number;
}

export interface LiveCalendarEvent {
  date: string;
  name: string;
  /** OPEN | CLOSE | CLOSING | ALLOTMENT | LISTING | HOLIDAY ... */
  status: string;
  statusLabel: string;
  board?: string;
  slug?: string;
  url?: string;
}

export interface LiveCalendarDay {
  date: string;
  events: LiveCalendarEvent[];
}

export interface LiveGmpParse {
  rows: LiveGmpRow[];
  /** newest quote timestamp seen on the page */
  asOf?: string;
  /** rows that carry a quote, out of every tracked row */
  quoted: number;
  tracked: number;
}

/* ------------------------------------------------------------------ helpers */

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lt: '<',
  gt: '>',
  '₹': '₹',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#?[a-zA-Z0-9]+);/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(ENTITIES, name)) return ENTITIES[name];
    if (/^#\d+$/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
    if (/^#x[0-9a-f]+$/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
    return match;
  });
}

/** Visible text of a markup fragment: tags dropped, entities decoded, whitespace folded. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? decodeEntities(match[1]).trim() : undefined;
}

function num(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  const match = /^[-+]?\d+(?:\.\d+)?/.exec(cleaned.replace(/^[+]/, ''));
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

/** "Sep 10, 2026" -> "2026-09-10" */
export function toIsoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const iso = /(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pretty = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(raw);
  if (!pretty) return undefined;
  const month = MONTHS[pretty[1].toLowerCase()];
  if (!month) return undefined;
  return `${pretty[3]}-${month}-${pretty[2].padStart(2, '0')}`;
}

/** upstream slugs carry a trailing "-ipo"; the bundled ids do not */
export function slugToId(slug: string | undefined, name?: string): string {
  const base = slug?.trim() || name?.trim() || '';
  const trimmed = base.replace(/\/+$/, '').split('/').pop() ?? '';
  return trimmed
    .toLowerCase()
    .replace(/-ipo$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const PLATFORMS = ['NSE SME', 'BSE SME', 'NSE', 'BSE'];

/** Upstream pads an unknown date with this sentinel and prints "TBA" over it. */
export const SENTINEL_YEAR = 2040;

export function within(value: number | undefined, min: number, max: number): number | undefined {
  return value !== undefined && value >= min && value <= max ? value : undefined;
}

/** "₹210 Cr", "₹2800 Crores Approx", "₹3,500–4,500 Cr Approx" -> crore figure. */
export function issueSizeCr(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const range = /([\d,.]+)\s*[-–]\s*([\d,.]+)/.exec(raw);
  // a range is priced off the upper band, so the upper number is the one to quote
  return within(num(range ? range[2] : raw), 0.1, 200000);
}

/** "BSE, NSE" / "NSE SME" / "Mainboard" -> the exchange list, when one is named. */
export function badgeExchanges(raw: string | undefined): string[] {
  if (!raw) return [];
  const found = raw.toUpperCase().match(/\b(NSE|BSE)\b/g) ?? [];
  return [...new Set(found)];
}

/** The `index`-th <time> on a card, ignoring upstream's TBA sentinel. */
function cardDate(body: string, index: number): string | undefined {
  const times = [...body.matchAll(/<time\b[^>]*\bdatetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/g)];
  const entry = times[index];
  if (!entry) return undefined;
  const iso = toIsoDate(entry[2]) ?? toIsoDate(entry[1]);
  if (!iso) return undefined;
  return Number(iso.slice(0, 4)) >= SENTINEL_YEAR ? undefined : iso;
}

function platformOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  if (upper === 'MAINBOARD' || upper === 'SME') return undefined;
  return PLATFORMS.find((p) => p === upper);
}

function openingTags(html: string, pattern: RegExp): { tag: string; start: number }[] {
  const out: { tag: string; start: number }[] = [];
  const regex = new RegExp(pattern.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) out.push({ tag: match[0], start: match.index });
  return out;
}

/* --------------------------------------------------------------- GMP board */

/**
 * One `tr.gmp-row` per tracked IPO. The row tag itself carries data-name / data-gmp /
 * data-pct / data-indicative / data-type / data-status, so the attributes are the
 * primary source and the cells are the fallback (the "no quote" variant only differs
 * by an extra class and empty attributes).
 */
export function parseGmpPage(html: string): LiveGmpParse {
  const rows: LiveGmpRow[] = [];
  const tags = openingTags(html, /<tr\b[^>]*\bclass="[^"]*\bgmp-row\b[^"]*"[^>]*>/);
  const stamps: string[] = [];

  tags.forEach(({ tag, start }) => {
    const end = html.indexOf('</tr>', start);
    const body = html.slice(start, end === -1 ? html.length : end + 5);
    // the GMP rows link to /ipo-gmp/<slug>, the name cell to /ipo/<slug>
    const rowUrl = attr(tag, 'data-rowurl') ?? /class="gmp-ipo-link"[^>]*href="([^"]+)"/.exec(html.slice(start, start + 1200))?.[1];
    const slug = rowUrl?.match(/\/(?:ipo|ipo-gmp)\/([^"'?#]+)/)?.[1];
    const name = attr(tag, 'data-name') || textOf(body.match(/class="gmp-ipo-link"[^>]*>([^<]*)</)?.[1] ?? '');
    if (!name) return;

    const type = (attr(tag, 'data-type') ?? '').toLowerCase();
    const band = /data-label="Price Band"[^>]*>([\s\S]*?)<\/td>/.exec(body)?.[1] ?? '';
    const bandMatch = num(band) !== undefined ? /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/.exec(textOf(band)) : null;
    const dates = /class="gmp-dates"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1];
    const dateRange = dates
      ? /([A-Za-z]{3}[a-z]*\.?\s+\d{1,2},?\s+\d{4})\s*[–-]\s*([A-Za-z]{3}[a-z]*\.?\s+\d{1,2},?\s+\d{4})/.exec(
          textOf(dates)
        )
      : null;
    const updatedAt = /<time\b[^>]*class="gmp-updated-time"[^>]*\bdatetime="([^"]+)"/.exec(body)?.[1];
    if (updatedAt) stamps.push(updatedAt);

    const gmp = num(attr(tag, 'data-gmp')) ?? undefined;
    const pct = num(attr(tag, 'data-pct')) ?? undefined;
    const indicative = num(attr(tag, 'data-indicative')) ?? undefined;

    rows.push({
      id: slugToId(slug, name),
      name: textOf(name),
      segment: type === 'sme' ? 'SME' : 'Mainboard',
      platform: platformOf(
        textOf(/class="gmp-type-badge[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1] ?? '')
      ),
      statusLabel: textOf(/class="gmp-status[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1] ?? '') || undefined,
      open: attr(tag, 'data-status') ? attr(tag, 'data-status') === 'open' : undefined,
      gmp,
      gmpPct: pct,
      indicative,
      bandLow: bandMatch ? Number(bandMatch[1]) : undefined,
      bandHigh: bandMatch ? Number(bandMatch[2]) : undefined,
      openDate: toIsoDate(dateRange?.[1]),
      closeDate: toIsoDate(dateRange?.[2]),
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : undefined,
      url: slug ? `https://www.ipoji.com/ipo/${slug}` : undefined,
    });
  });

  const asOf = stamps.length
    ? new Date(Math.max(...stamps.map((s) => new Date(s).getTime()))).toISOString()
    : extractGmpAsOf(html);

  return {
    rows,
    asOf,
    quoted: rows.filter((row) => row.gmp !== undefined).length,
    tracked: rows.length,
  };
}

/** The page also prints "As of 14 Sep 2026, 5:30 PM IST, 19 of 35 tracked ... IPOs". */
export function extractGmpAsOf(html: string): string | undefined {
  const match = /As of (\d{1,2} [A-Za-z]{3} \d{4}, \d{1,2}:\d{2} [AP]M) IST/.exec(textOf(html));
  if (!match) return undefined;
  const parsed = new Date(`${match[1]} GMT+0530`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/* ------------------------------------------------------------ subscriptions */

/**
 * The live subscription report. Cells are plain, except for the name cell (link +
 * title span + status badge) and the last column, which carries the snapshot time
 * as `<time datetime="...+05:30">`.
 */
export function parseSubscriptionPage(html: string): { rows: LiveSubscriptionRow[]; asOf?: string } {
  const table = /<table\b[^>]*class="[^"]*\bsubs-overview-table\b[^"]*"[^>]*>/.exec(html);
  const scope = table ? html.slice(table.index, html.indexOf('</table>', table.index) + 8) : html;
  const rows: LiveSubscriptionRow[] = [];
  const stamps: string[] = [];

  for (const match of scope.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)) {
    const body = match[0];
    if (!/subs-overview-name/.test(body)) continue;

    const name = textOf(/class="subs-overview-ipo-title"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1] ?? '');
    if (!name) continue;
    const slug = /href="\/ipo-subscription\/([^"']+)"/.exec(body)?.[1];
    const mults = [...body.matchAll(/class="[^"]*\bsubs-overview-mult\b[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      num(textOf(m[1]))
    );
    const totalText = /class="subs-overview-total-val"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1];
    const appsCell = /class="subs-overview-apps"[^>]*>([\s\S]*?)<\/td>/.exec(body);
    const updatedAt = /<time\b[^>]*\bdatetime="([^"]+)"/.exec(body)?.[1];
    if (updatedAt) stamps.push(updatedAt);

    rows.push({
      id: slugToId(slug, name),
      name,
      platform: platformOf(attr(/<span\b[^>]*class="[^"]*badge_span[^"]*"[^>]*>/.exec(body)?.[0] ?? '', 'data-ipotype')),
      closeDate: toIsoDate(textOf(/class="subs-overview-date"[^>]*>([\s\S]*?)<\/td>/.exec(body)?.[1] ?? '')),
      qib: mults[0],
      nii: mults[1],
      retail: mults[2],
      total: num(textOf(totalText ?? '')) ?? mults[3],
      applications: num(textOf(appsCell?.[1] ?? '') || attr(appsCell?.[0] ?? '', 'title')),
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : undefined,
      url: slug ? `https://www.ipoji.com/ipo/${slug}` : undefined,
    });
  }

  const asOf = stamps.length
    ? new Date(Math.max(...stamps.map((s) => new Date(s).getTime()))).toISOString()
    : undefined;
  return { rows, asOf };
}

/* ---------------------------------------------------------------- ipo cards */

/**
 * `article.ipo-card` blocks on the current / upcoming pages. Each card carries a
 * `ipo-card-body-stat` block per fact (offer price, lot size, subscription, issue size)
 * plus the expected premium, all labelled by `ipo-card-secondary-label`.
 */
export function parseIpoCards(html: string): LiveCard[] {
  const cards: LiveCard[] = [];
  const opens = openingTags(html, /<article\b[^>]*\bclass="[^"]*\bipo-card\b[^"]*"[^>]*>/);

  opens.forEach(({ tag, start }) => {
    const end = html.indexOf('</article>', start);
    const body = html.slice(start, end === -1 ? html.length : end + 10);
    const href = attr(tag, 'data-agent-href') ?? /href="\/ipo\/([^"']+)"/.exec(body)?.[1];
    const name = textOf(/class="ipo-card-name"[^>]*>([\s\S]*?)<\/(?:h3|h2|div)>/.exec(body)?.[1] ?? '');
    if (!name) return;

    const stats = new Map<string, string>();
    for (const match of body.matchAll(
      /class="ipo-card-secondary-label"[^>]*>([\s\S]*?)<\/span>[\s\S]{0,240}?class="ipo-card-body-value[^"]*"[^>]*>([\s\S]*?)<\/span>/g
    )) {
      stats.set(textOf(match[1]).toLowerCase(), textOf(match[2]));
    }

    const badge = textOf(/class="ipo-card-market-badge"[^>]*>([\s\S]*?)<\/span>/.exec(body)?.[1] ?? '');
    const premiumText = stats.get('exp. premium') ?? '';
    const premiumRange = /([\d,.]+)\s*[-–]\s*([\d,.]+)/.exec(premiumText);
    const offer = stats.get('offer price') ?? stats.get('price band') ?? '';
    const offerRange = /([\d,.]+)\s*[-–]\s*([\d,.]+)/.exec(offer);

    cards.push({
      id: slugToId(href, name),
      name,
      segment: (attr(tag, 'data-ipo-board') ?? '').toUpperCase().includes('SME') ? 'SME' : 'Mainboard',
      status: attr(tag, 'data-ipo-status'),
      premiumLow: premiumRange ? num(premiumRange[1]) : num(premiumText),
      premiumHigh: premiumRange ? num(premiumRange[2]) : undefined,
      premiumPct: num(/\((\d+(?:\.\d+)?)%\)/.exec(premiumText)?.[1]),
      bandLow: within(offerRange ? num(offerRange[1]) : num(offer), 0.5, 100000),
      bandHigh: within(offerRange ? num(offerRange[2]) : undefined, 0.5, 100000),
      lotSize: within(num(stats.get('lot size')), 1, 100000),
      issueSizeCr: issueSizeCr(stats.get('issue size')),
      subscriptionTotal: within(num(stats.get('subscription')), 0, 100000),
      exchanges: badgeExchanges(badge),
      openDate: cardDate(body, 0),
      closeDate: cardDate(body, 1),
      url: href ? `https://www.ipoji.com${href.startsWith('/') ? '' : '/'}${href}` : undefined,
    });
  });

  return cards;
}

/* ------------------------------------------------------------ event calendar */

/** The calendar is driven by an inline `eventListData = [ ... ]` JSON array. */
export function parseEventCalendar(html: string): LiveCalendarDay[] {
  const raw = extractInlineArray(html, 'eventListData');
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((day) => day as { date?: string; events?: unknown[] })
    .filter((day) => typeof day.date === 'string' && Array.isArray(day.events))
    .map((day) => ({
      date: toIsoDate(day.date) ?? day.date!,
      events: (day.events as Record<string, unknown>[]).map((event) => ({
        date: toIsoDate(day.date) ?? day.date!,
        name: String(event.name ?? '').trim(),
        status: String(event.status ?? '').toUpperCase(),
        statusLabel: String(event.statusLabel ?? event.status ?? '').toUpperCase(),
        board: event.board ? String(event.board) : undefined,
        slug: event.slug ? String(event.slug) : undefined,
        url: event.url ? String(event.url) : undefined,
      })),
    }))
    .filter((day) => day.events.every((event) => event.name));
}

/** Reads `name = [ ... ]` out of a script tag by bracket-matching (nested arrays/objects). */
export function extractInlineArray(html: string, name: string): string | undefined {
  const anchor = new RegExp(`\\b${name}\\s*=\\s*\\[`).exec(html);
  if (!anchor) return undefined;
  const start = html.indexOf('[', anchor.index);
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------- bundle */

export interface LivePages {
  gmp?: string;
  /** the second GMP source (ipomarket.in), which stamps every row and refreshes every 30 min */
  gmpAlt?: string;
  subscription?: string;
  calendar?: string;
  current?: string;
  upcoming?: string;
}

export interface ParsedLive {
  gmp: LiveGmpParse;
  gmpAlt: LiveAltGmpParse;
  subscription: { rows: LiveSubscriptionRow[]; asOf?: string };
  cards: LiveCard[];
  calendar: LiveCalendarDay[];
  /** figures found by the AI assist, merged under everything the pages published */
  ai: LiveAiParse;
}

/** An all-empty parse, so a caller can hand just one source (the AI assist) to the merge. */
export function emptyParsedLive(ai: Partial<LiveAiParse> = {}): ParsedLive {
  return {
    gmp: { rows: [], quoted: 0, tracked: 0 },
    gmpAlt: { rows: [] },
    subscription: { rows: [] },
    cards: [],
    calendar: [],
    ai: { rows: [], ...ai },
  };
}

/** Parses every page we managed to download. Missing pages simply yield nothing. */
export function parseLivePages(pages: LivePages): ParsedLive {
  return {
    gmp: pages.gmp ? parseGmpPage(pages.gmp) : { rows: [], quoted: 0, tracked: 0 },
    gmpAlt: pages.gmpAlt ? parseAltGmp(pages.gmpAlt) : { rows: [] },
    subscription: pages.subscription ? parseSubscriptionPage(pages.subscription) : { rows: [] },
    cards: [pages.current, pages.upcoming]
      .filter((html): html is string => Boolean(html))
      .flatMap((html) => parseIpoCards(html)),
    calendar: pages.calendar ? parseEventCalendar(pages.calendar) : [],
    ai: { rows: [] },
  };
}

/* ------------------------------------------------------------------ second GMP source */

/**
 * The second GMP source: ipomarket.in/gmp/.
 *
 * IPO Ji publishes one grey-market quote per evening (its GMP page said "As of 5:30 PM" at
 * 8:46 PM), which reads as stale on a phone even though the app fetched it a second earlier.
 * ipomarket.in refreshes every 30 minutes and stamps every row with a machine-readable
 * `<time dateTime="...Z">`, so this parser is what lets the board carry the newest quote
 * published by anyone, with the source named next to it.
 *
 * The table it reads (server-rendered, no JavaScript needed):
 *
 *   | Company | Open Date | Price Band | GMP (₹) | GMP % | Est. Listing | Trend | Status |
 *     Close Date | Updated <time dateTime="2026-09-14T15:15:00.298Z"> | Score | Apply |
 *
 * Only the fields the merge actually trusts are returned: the quote, its stamp, the band
 * (used when nothing else carries one) and the dates as reported. No react-native imports -
 * this runs in plain node for the tests and the live-report script.
 */


export interface LiveAltGmpRow {
  name: string;
  /** the site's own slug, when the row links to an issue page */
  slug?: string;
  gmp?: number;
  gmpPercent?: number;
  bandLow?: number;
  bandHigh?: number;
  /** the row's own stamp, ISO - the whole reason this source exists */
  updatedAt?: string;
  status?: string;
  /** the bidding window as the source reports it; never used to overwrite published dates */
  openDate?: string;
  closeDate?: string;
  /** page-level stamp, used for rows whose cell was empty */
  pageUpdatedAt?: string;
}

export interface LiveAltGmpParse {
  rows: LiveAltGmpRow[];
  /** newest stamp on the page */
  asOf?: string;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function number(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /[-+]?\d+(?:\.\d+)?/.exec(raw.replace(/[₹,\s]/g, ''));
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * "₹40 – ₹43" -> [40, 43]. A dash-less band means one number, which is still a band.
 */
function parseBand(raw: string | undefined): { low?: number; high?: number } {
  if (!raw) return {};
  const parts = raw.split(/[–—-]/).map((part) => number(part));
  const clean = parts.filter((value): value is number => value !== undefined);
  if (clean.length === 0) return {};
  if (clean.length === 1) return { low: clean[0], high: clean[0] };
  return { low: clean[0], high: clean[clean.length - 1] };
}

/**
 * "11 Sept" (no year) and "16 Sep 2026" both appear on the page. The year-less form is the
 * current year, unless that would put the date more than a month in the future - which is how
 * a December page read in January still makes sense.
 */
export function altDateToIso(raw: string | undefined, now: Date): string | undefined {
  if (!raw) return undefined;
  const match = /(\d{1,2})\s*([A-Za-z]{3,4})\.?\s*(?:(\d{4}))?/.exec(raw.replace(/\s+/g, ' ').trim());
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = MONTH_INDEX[match[2].toLowerCase()];
  if (month === undefined || day < 1 || day > 31) return undefined;
  let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
  if (!match[3]) {
    const guess = Date.UTC(year, month, day);
    // a date more than 31 days ahead is last year's, e.g. "31 Dec" read on 2 Jan
    if (guess - now.getTime() > 31 * 24 * 60 * 60 * 1000) year -= 1;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "14 Sept, 20:45" -> an IST instant. The page also ships `<time dateTime>` with a real
 * UTC instant, which is preferred; this is the fallback for the day it does not.
 */
export function altStampToIso(raw: string | undefined, now: Date): string | undefined {
  if (!raw) return undefined;
  const date = altDateToIso(raw, now);
  const clock = /(\d{1,2}):(\d{2})/.exec(raw);
  if (!date || !clock) return undefined;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return undefined;
  // 20:45 IST is 15:15Z
  const utc = new Date(`${date}T00:00:00.000Z`);
  utc.setUTCMinutes(utc.getUTCMinutes() + hour * 60 + minute - 330);
  return utc.toISOString();
}

/** The page's own stamp, the one the reader compares against the clock. */
export function pageStamp(html: string, now = new Date()): string | undefined {
  const times = [...html.matchAll(/<time\b[^>]*\bdateTime\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  const parsed = times
    .map((value) => ({ value, ms: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.ms))
    .sort((a, b) => b.ms - a.ms);
  if (parsed.length > 0) return parsed[0].value;
  const text = textOf(html.slice(0, 20000));
  const written = /(?:last updated|updated)\D{0,20}(\d{1,2}\s+\w{3,4},?\s*\d{1,2}:\d{2})/i.exec(text);
  return written ? altStampToIso(written[1], now) : undefined;
}

/**
 * Reads every row of the GMP tables. The site repeats its tables (open / upcoming / closed
 * segments), so rows are de-duplicated by name and the newest stamp wins.
 */
export function parseAltGmp(html: string, now = new Date()): LiveAltGmpParse {
  const fallbackStamp = pageStamp(html, now);
  const rows = new Map<string, LiveAltGmpRow>();

  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const markup = table[0];
    const header = /<thead[\s\S]*?<\/thead>/i.exec(markup)?.[0] ?? '';
    const columns = [...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => textOf(m[1]).toLowerCase());
    if (columns.length === 0) continue;
    const at = (label: string): number => columns.findIndex((column) => column.startsWith(label));
    const index = {
      name: at('company'),
      open: at('open date'),
      band: at('price band'),
      gmp: at('gmp (') >= 0 ? at('gmp (') : at('gmp'),
      percent: at('gmp %'),
      status: at('status'),
      close: at('close date'),
      updated: at('updated'),
    };
    if (index.name < 0 || index.gmp < 0) continue;

    const body = /<tbody[\s\S]*?<\/tbody>/i.exec(markup)?.[0] ?? markup;
    for (const tr of body.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...tr[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length <= index.name) continue;
      // the name cell's own link carries the site's slug for the issue
      const slug = /href\s*=\s*"\/ipo\/([^"?#]+)"/i.exec(cells[index.name])?.[1];
      const name = textOf(cells[index.name]);
      if (!name) continue;

      const stampAttr = index.updated >= 0 ? cells[index.updated] : undefined;
      const machine = stampAttr ? /\bdateTime\s*=\s*"([^"]+)"/i.exec(stampAttr)?.[1] : undefined;
      const written = stampAttr ? /(\d{1,2}\s+\w{3,4},?\s*\d{1,2}:\d{2})/.exec(textOf(stampAttr))?.[1] : undefined;
      const updatedAt = machine && Number.isFinite(new Date(machine).getTime()) ? machine : altStampToIso(written, now);

      const band = parseBand(index.band >= 0 ? textOf(cells[index.band]) : undefined);
      const row: LiveAltGmpRow = {
        name,
        slug,
        gmp: index.gmp >= 0 ? number(textOf(cells[index.gmp]).replace(/[—–-]+/g, '')) : undefined,
        gmpPercent: index.percent >= 0 ? number(textOf(cells[index.percent])) : undefined,
        bandLow: band.low,
        bandHigh: band.high,
        updatedAt: updatedAt ?? fallbackStamp,
        pageUpdatedAt: fallbackStamp,
        status: index.status >= 0 ? textOf(cells[index.status]) : undefined,
        openDate: index.open >= 0 ? altDateToIso(textOf(cells[index.open]), now) : undefined,
        closeDate: index.close >= 0 ? altDateToIso(textOf(cells[index.close]), now) : undefined,
      };

      const key = name.toLowerCase();
      const existing = rows.get(key);
      if (!existing) rows.set(key, row);
      else {
        const a = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
        const b = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
        if (b >= a) rows.set(key, row);
      }
    }
  }

  const list = [...rows.values()];
  const stamps = list
    .map((row) => row.updatedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return {
    rows: list,
    asOf: stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : fallbackStamp,
  };
}
