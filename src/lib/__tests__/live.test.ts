/**
 * Live-data path: parsing the upstream markup, and merging it over the snapshot.
 *
 * The fixtures below are trimmed copies of the real pages captured by the
 * probe-source workflow (see .github/workflows/probe-source.yml) - same classes,
 * same data-* attributes, same timestamps - so a change in what the parsers expect
 * shows up here rather than on a phone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  extractGmpAsOf,
  extractInlineArray,
  parseEventCalendar,
  parseGmpPage,
  parseIpoCards,
  parseLivePages,
  parseSubscriptionPage,
  slugToId,
  textOf,
  toIsoDate,
} from '../live/parse';
import { istLabel, mergeBoard } from '../live/merge';
import { hasLiveData, pullLiveBoard, sourceStatuses } from '../live';
import { IPOT } from '../ipoData';
import { altDateToIso, altStampToIso, parseAltGmp } from '../live/parse';
import {
  ALT_GMP_HTML,
  CALENDAR_HTML,
  CALENDAR_JSON,
  CARDS_HTML,
  GMP_HTML,
  SUBSCRIPTION_HTML,
  livePageFixtures as pages,
} from './liveFixtures';

/* ------------------------------------------------------------------- helpers */

test('text helpers fold markup the way the site renders it', () => {
  assert.equal(decodeEntities('Mainboard &amp; SME &#8211; live'), 'Mainboard & SME – live');
  assert.equal(textOf('<td class="x">\n  ₹130-140\n</td>'), '₹130-140');
  assert.equal(toIsoDate('Sep 10, 2026'), '2026-09-10');
  assert.equal(toIsoDate('2026-09-14T12:00:00.000Z'), '2026-09-14');
  assert.equal(toIsoDate('not a date'), undefined);
  assert.equal(slugToId('veegaland-developers-ipo'), 'veegaland-developers');
  assert.equal(slugToId(undefined, 'Test Discoveries'), 'test-discoveries');
});

test('inline JSON arrays are read out by bracket matching', () => {
  const raw = extractInlineArray(CALENDAR_HTML, 'eventListData');
  assert.ok(raw);
  assert.deepEqual(JSON.parse(raw!), JSON.parse(CALENDAR_JSON.replace('eventListData = ', '').replace(/;$/, '')));
  assert.equal(extractInlineArray(CALENDAR_HTML, 'missing'), undefined);
});

/* ----------------------------------------------------------------------- GMP */

test('the GMP board parses every row, quoted or not', () => {
  const parsed = parseGmpPage(GMP_HTML);
  assert.equal(parsed.tracked, 3);
  assert.equal(parsed.quoted, 1);
  assert.equal(parsed.asOf, '2026-09-14T12:00:00.000Z');

  const [veegaland, noQuote] = parsed.rows;
  assert.equal(veegaland.id, 'veegaland-developers');
  assert.equal(veegaland.name, 'Veegaland Developers');
  assert.equal(veegaland.segment, 'Mainboard');
  assert.equal(veegaland.platform, undefined); // the page prints "Mainboard", not an exchange
  assert.equal(veegaland.gmp, 22);
  assert.equal(veegaland.gmpPct, 16);
  assert.equal(veegaland.indicative, 162);
  assert.equal(veegaland.bandLow, 130);
  assert.equal(veegaland.bandHigh, 140);
  assert.equal(veegaland.openDate, '2026-09-10');
  assert.equal(veegaland.closeDate, '2026-09-15');
  assert.equal(veegaland.updatedAt, '2026-09-14T12:00:00.000Z');
  assert.equal(veegaland.url, 'https://www.ipoji.com/ipo/veegaland-developers-ipo');

  // the "no quote" variant: empty data-* attributes must not become 0
  assert.equal(noQuote.id, 'jindal-supreme');
  assert.equal(noQuote.gmp, undefined);
  assert.equal(noQuote.gmpPct, undefined);
  assert.equal(noQuote.indicative, undefined);
  assert.equal(noQuote.bandLow, 88);
  assert.equal(noQuote.updatedAt, undefined);
  assert.equal(noQuote.platform, undefined); // this row prints "Mainboard", not an exchange

  // the SME row is still parsed - the merge is what drops it from the board
  assert.equal(parsed.rows[2].platform, 'NSE SME');
  assert.equal(parsed.rows[2].segment, 'SME');
  assert.equal(parsed.rows[2].open, false);
});

test('the "As of" stamp is read when no row carries one', () => {
  assert.equal(extractGmpAsOf(GMP_HTML), '2026-09-14T12:00:00.000Z');
  assert.equal(extractGmpAsOf('<p>nothing to see</p>'), undefined);
});

/* -------------------------------------------------------------- subscription */

test('subscription rows carry every leg, the total and the snapshot stamp', () => {
  const parsed = parseSubscriptionPage(SUBSCRIPTION_HTML);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.asOf, '2026-09-14T06:15:00.000Z');

  const [veegaland, manipal] = parsed.rows;
  assert.equal(veegaland.id, 'veegaland-developers');
  assert.equal(veegaland.name, 'Veegaland Developers');
  assert.equal(veegaland.platform, undefined); // "Mainboard" is a board, not an exchange
  assert.equal(veegaland.closeDate, '2026-09-15');
  assert.deepEqual(
    [veegaland.qib, veegaland.nii, veegaland.retail, veegaland.total],
    [0.61, 1.44, 2.02, 2.41]
  );
  assert.equal(veegaland.applications, 92318);

  assert.equal(manipal.name, 'Manipal Payment & Identity');
  assert.equal(manipal.platform, 'NSE');
  assert.equal(manipal.total, 1.54);
  assert.equal(manipal.applications, 410552);
});

/* --------------------------------------------------------------------- cards */

test('ipo cards give the band, the expected premium, lot, size and the bidding window', () => {
  const cards = parseIpoCards(CARDS_HTML);
  assert.equal(cards.length, 3);
  const [hero, veritas, jio] = cards;
  assert.equal(hero.id, 'hero-motors');
  assert.equal(hero.segment, 'Mainboard');
  assert.equal(hero.status, 'current');
  assert.equal(hero.premiumLow, 24);
  assert.equal(hero.premiumHigh, undefined); // the card prints a single expected premium
  assert.equal(hero.premiumPct, 16);
  assert.equal(hero.bandLow, 145);
  assert.equal(hero.bandHigh, 153);
  assert.equal(hero.lotSize, 98);
  assert.equal(hero.issueSizeCr, 1250);
  assert.equal(hero.subscriptionTotal, 2.35);
  assert.equal(hero.openDate, '2026-09-16');
  assert.equal(hero.closeDate, '2026-09-18');
  assert.equal(hero.url, 'https://www.ipoji.com/ipo/hero-motors-ipo');

  assert.equal(jio.id, 'jio-platforms');
  assert.equal(jio.status, 'upcoming');
  assert.equal(jio.bandLow, 1180);
  assert.equal(jio.bandHigh, 1240);
  assert.equal(jio.lotSize, 12);
  assert.equal(jio.issueSizeCr, 12000);
  assert.equal(jio.premiumLow, undefined); // this card publishes no expected premium

  // an unannounced issue: upstream prints TBA over the 2050-01-01 sentinel and "₹N/A"
  // placeholders, so none of that may leak into the app
  assert.equal(veritas.id, 'veritas-finance');
  assert.equal(veritas.openDate, undefined);
  assert.equal(veritas.closeDate, undefined);
  assert.equal(veritas.bandLow, undefined);
  assert.equal(veritas.lotSize, undefined);
  assert.equal(veritas.issueSizeCr, 4500); // "₹3,500–4,500 Cr Approx" -> the upper bound
  assert.deepEqual(veritas.exchanges, ['BSE', 'NSE']);
  assert.equal(veritas.segment, 'SME');
});

test('an issue with no announced dates is not added to the board', () => {
  const parsed = parseLivePages(pages);
  const board = mergeBoard(IPOT, parsed, { fetchedAt: Date.parse('2026-09-14T12:31:00Z'), sources: [] });
  assert.ok(
    !board.ipos.some((ipo) => ipo.id === 'veritas-finance'),
    'a TBA card must not become a board row with a placeholder date'
  );
});

/* ------------------------------------------------------------------ calendar */

test('the calendar JSON keeps dates, statuses and holidays apart', () => {
  const days = parseEventCalendar(CALENDAR_HTML);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-09-14');
  assert.equal(days[0].events[0].status, 'HOLIDAY');

  const [allotment, listing] = days[1].events;
  assert.equal(allotment.name, 'Veegaland Developers');
  assert.equal(allotment.status, 'ALLOTMENT');
  assert.equal(allotment.slug, 'veegaland-developers-ipo');
  assert.equal(allotment.date, '2026-09-17');
  assert.equal(listing.status, 'LISTING');
  assert.equal(listing.board, 'NSE SME');
});

test('parseLivePages tolerates missing pages', () => {
  const parsed = parseLivePages({ gmp: GMP_HTML });
  assert.equal(parsed.gmp.rows.length, 3);
  assert.equal(parsed.subscription.rows.length, 0);
  assert.equal(parsed.cards.length, 0);
  assert.equal(hasLiveData(parsed), true);
  assert.equal(hasLiveData(parseLivePages({})), false);
});

test('source statuses report per-board health', () => {
  const parsed = parseLivePages(pages);
  const statuses = sourceStatuses(parsed, { calendar: 'timed out' }, Date.parse('2026-09-14T12:30:00Z'));
  const byKey = Object.fromEntries(statuses.map((s) => [s.key, s]));
  assert.equal(byKey.gmp.ok, true);
  assert.equal(byKey.gmp.rows, 3);
  assert.equal(byKey.subscription.rows, 2);
  assert.equal(byKey.cards.rows, 3);
  assert.equal(byKey.calendar.ok, false);
  assert.equal(byKey.calendar.error, 'timed out');
});

/* --------------------------------------------------------------------- merge */

test('a live pull overwrites only the fields upstream actually published', () => {
  const parsed = parseLivePages(pages);
  const board = mergeBoard(IPOT, parsed, {
    fetchedAt: Date.parse('2026-09-14T12:31:00Z'),
    sources: sourceStatuses(parsed, {}, Date.parse('2026-09-14T12:31:00Z')),
  });

  const veegaland = board.ipos.find((ipo) => ipo.id === 'veegaland-developers')!;
  assert.equal(veegaland.gmp, 22); // was 15 in the snapshot
  assert.equal(veegaland.gmpUpdated, '2026-09-14T12:00:00.000Z'); // was 2026-09-14T07:45:00.000Z
  assert.equal(veegaland.subscription?.total, 2.41); // was 1.24
  assert.equal(veegaland.subscription?.qib, 0.61);
  assert.equal(veegaland.subscription?.asOf, '14 Sep 2026, 11:45 AM IST');
  assert.equal(veegaland.allotmentDate, '2026-09-17'); // the calendar moved it from 09-16
  assert.equal(veegaland.lotSize, 107); // untouched: no live source carries lot size
  assert.equal(veegaland.sector, 'Real Estate');
  assert.equal(veegaland.about.length > 0, true);

  // "no quote recorded" upstream clears a stale quote instead of keeping it
  const noQuote = board.ipos.find((ipo) => ipo.id === 'jindal-supreme')!;
  assert.equal(noQuote.gmp, undefined);
  assert.equal(noQuote.gmpUpdated, undefined);
  assert.equal(noQuote.priceBandLow, 88);

  // upstream files Manipal under a longer slug than our id - it must still match
  const manipal = board.ipos.find((ipo) => ipo.id === 'manipal-payment')!;
  assert.equal(manipal.subscription?.total, 1.54);
  assert.equal(manipal.subscription?.nii, 1.31);

  // the second GMP source is newer than the board's evening quote, so it wins - and it says
  // so: the value, the stamp and the publisher all change together
  const kanohar = board.ipos.find((ipo) => ipo.id === 'kanohar-electricals')!;
  assert.equal(kanohar.gmp, 240);
  assert.equal(kanohar.gmpUpdated, '2026-09-14T15:15:00.298Z');
  assert.equal(kanohar.gmpSource, 'IPO Market');

  // ... and where it is *older* it must not touch the board's quote
  assert.equal(veegaland.gmp, 22);
  assert.equal(veegaland.gmpUpdated, '2026-09-14T12:00:00.000Z');
  assert.equal(veegaland.gmpSource, 'IPO Ji');

  // a name the bundled board does not carry is ignored, not guessed at
  assert.equal(board.ipos.some((ipo) => /kwick/i.test(ipo.name)), false);

  // an issue with no live row at all is left exactly as the snapshot had it
  const untouched = board.ipos.find((ipo) => ipo.id === 'rentomojo')!;
  const snapshotUntouched = IPOT.find((ipo) => ipo.id === 'rentomojo')!;
  assert.deepEqual(untouched, snapshotUntouched);

  // the board's stamp is the newest quote anyone published, not the moment we fetched
  assert.equal(board.asOf, '2026-09-14T15:15:00.298Z');
  assert.equal(board.fetchedAt, Date.parse('2026-09-14T12:31:00Z'));
  assert.equal(istLabel(board.asOf), '14 Sep 2026, 8:45 PM IST');
  // exactly the issues whose figures moved: Veegaland (quote, band dates, subscription),
  // Manipal (subscription split), Kanohar (the newer quote from the second source) and
  // Jindal Supreme (upstream withdrew the quote it used to carry)
  assert.equal(board.updated, 4);
});

test('live-only issues are appended, with derived milestone dates marked tentative', () => {
  const parsed = parseLivePages(pages);
  const board = mergeBoard(IPOT, parsed, { fetchedAt: Date.parse('2026-09-14T12:31:00Z'), sources: [] });
  const added = board.ipos.filter((ipo) => !IPOT.some((existing) => existing.id === ipo.id));

  // only the mainboard discovery is appended: the SME one (Legacy Wires) is dropped, because
  // this app carries mainboard issues only
  assert.deepEqual(
    added.map((ipo) => ipo.id),
    ['jio-platforms']
  );
  assert.ok(!board.ipos.some((ipo) => /legacy wires/i.test(ipo.name)), 'an SME discovery reached the board');
  const [jio] = added;
  // every issue on the board is mainboard, including the ones upstream only carries live
  assert.ok(board.ipos.every((ipo) => ipo.segment === 'Mainboard'));
  assert.equal(board.added, 1);
  assert.equal(board.ipos.length, IPOT.length + 1);

  // a card is also enough to render an issue: band, lot, size and subscription come with it
  assert.equal(jio.priceBandLow, 1180);
  assert.equal(jio.priceBandHigh, 1240);
  assert.equal(jio.lotSize, 12);
  assert.equal(jio.issueSizeCr, 12000);
  assert.equal(jio.openDate, '2026-09-24');
  assert.equal(jio.closeDate, '2026-09-28');
  assert.deepEqual(jio.tentativeDates, ['allotment', 'listing']);
  assert.deepEqual(jio.exchanges, []); // the exchange is not published for mainboard issues
  assert.equal(jio.sourceUrl, 'https://www.ipoji.com/ipo/jio-platforms-ipo');
});

test('a pull that carries nothing leaves the snapshot alone', () => {
  const empty = parseLivePages({});
  const board = mergeBoard(IPOT, empty, { fetchedAt: Date.parse('2026-09-14T12:31:00Z'), sources: [] });
  assert.equal(board.ipos.length, IPOT.length);
  assert.equal(board.updated, 0);
  assert.equal(board.added, 0);
  // with nothing live to prove, the newest stamp we have is the snapshot's own
  const newestBundled = Math.max(
    ...IPOT.map((ipo) => ipo.gmpUpdated)
      .filter((stamp): stamp is string => Boolean(stamp))
      .map((stamp) => Date.parse(stamp))
  );
  assert.equal(Date.parse(board.asOf), newestBundled);
  assert.ok(Date.parse(board.asOf) <= Date.parse('2026-09-14T12:31:00Z'));
  assert.deepEqual(board.ipos, IPOT);
});

/* --------------------------------------------------------------------- pull */

test('pullLiveBoard wires download, parse and merge together', async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(String(url));
    const key = Object.entries({
      'ipo-gmp': GMP_HTML,
      'subscription-status': SUBSCRIPTION_HTML,
      'current-ipo': CARDS_HTML,
      'event-calendar': CALENDAR_HTML,
      'upcoming-ipo': '<html></html>',
    } as Record<string, string>).find(([needle]) => String(url).includes(needle))?.[1];
    if (!key) return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    return { ok: true, status: 200, text: async () => key } as unknown as Response;
  }) as unknown as typeof fetch;

  const { board } = await pullLiveBoard(IPOT, { fetcher });
  // five IPO Ji pages plus the second GMP source
  assert.equal(calls.length, 6);
  assert.ok(calls.every((url) => url.startsWith('https://www.ipoji.com/') || url.startsWith('https://ipomarket.in/')));
  assert.equal(calls.filter((url) => url.includes('ipomarket.in')).length, 1);
  assert.equal(board.ipos.find((ipo) => ipo.id === 'veegaland-developers')!.gmp, 22);
  assert.equal(board.sources.find((source) => source.key === 'gmp')!.ok, true);

  await assert.rejects(
    () => pullLiveBoard(IPOT, { fetcher: (async () => ({ ok: false, status: 503, text: async () => '' })) as unknown as typeof fetch }),
    /gmp: HTTP 503/
  );
});

test('web builds reach the pages through the same-origin proxy', async () => {
  const seen: string[] = [];
  const fetcher = (async (url: string) => {
    seen.push(String(url));
    return { ok: true, status: 200, text: async () => GMP_HTML } as unknown as Response;
  }) as unknown as typeof fetch;

  await pullLiveBoard(IPOT, { fetcher, useProxy: true });
  assert.ok(seen.every((url) => url.startsWith('/api/ipoji?u=http')));
  assert.ok(seen[0].includes(encodeURIComponent('https://www.ipoji.com/ipo-gmp')));
});

/* --------------------------------------------------- second GMP source (ipomarket) */

test('the 30-minute source parses each row, its stamp and its slug', () => {
  const parsed = parseAltGmp(ALT_GMP_HTML, new Date('2026-09-14T15:20:00Z'));
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.asOf, '2026-09-14T15:15:00.298Z');

  const kanohar = parsed.rows.find((row) => row.name === 'Kanohar Electricals')!;
  assert.equal(kanohar.slug, 'kanohar-electricals');
  assert.equal(kanohar.gmp, 240);
  assert.equal(kanohar.gmpPercent, 39.34);
  assert.equal(kanohar.bandLow, 585);
  assert.equal(kanohar.bandHigh, 620);
  assert.equal(kanohar.updatedAt, '2026-09-14T15:15:00.298Z');
  assert.equal(kanohar.status, 'OPEN');

  // an older row keeps its own older stamp - the parser must not stamp everything "now"
  const veegaland = parsed.rows.find((row) => row.name === 'Veegaland Developers')!;
  assert.equal(veegaland.updatedAt, '2026-09-14T02:00:00.000Z');
});

test('year-less dates on that page resolve to the nearest sensible year', () => {
  const now = new Date('2026-09-14T15:20:00Z');
  assert.equal(altDateToIso('11 Sept', now), '2026-09-11');
  assert.equal(altDateToIso('16 Sep 2026', now), '2026-09-16');
  assert.equal(altDateToIso('nonsense', now), undefined);
  assert.equal(altStampToIso('14 Sept, 20:45', now), '2026-09-14T15:15:00.000Z');
  assert.equal(altStampToIso('14 Sept', now), undefined);
});
