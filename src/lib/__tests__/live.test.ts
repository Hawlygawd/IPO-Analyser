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
import {
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

  const [veegaland, omGalaxy] = parsed.rows;
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
  assert.equal(omGalaxy.id, 'om-galaxy');
  assert.equal(omGalaxy.gmp, undefined);
  assert.equal(omGalaxy.gmpPct, undefined);
  assert.equal(omGalaxy.indicative, undefined);
  assert.equal(omGalaxy.bandLow, 85);
  assert.equal(omGalaxy.updatedAt, undefined);
  assert.equal(omGalaxy.platform, 'BSE SME');

  assert.equal(parsed.rows[2].platform, 'NSE SME');
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
  assert.equal(cards.length, 2);
  const [hero, jio] = cards;
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
  assert.equal(byKey.cards.rows, 2);
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
  const omGalaxy = board.ipos.find((ipo) => ipo.id === 'om-galaxy')!;
  assert.equal(omGalaxy.gmp, undefined);
  assert.equal(omGalaxy.gmpUpdated, undefined);
  assert.equal(omGalaxy.priceBandLow, 85);

  // upstream files Manipal under a longer slug than our id - it must still match
  const manipal = board.ipos.find((ipo) => ipo.id === 'manipal-payment')!;
  assert.equal(manipal.subscription?.total, 1.54);
  assert.equal(manipal.subscription?.nii, 1.31);

  // an issue with no live row is left exactly as the snapshot had it
  const kanohar = board.ipos.find((ipo) => ipo.id === 'kanohar-electricals')!;
  const snapshotKanohar = IPOT.find((ipo) => ipo.id === 'kanohar-electricals')!;
  assert.deepEqual(kanohar, snapshotKanohar);

  assert.equal(board.asOf, '2026-09-14T12:00:00.000Z');
  assert.equal(board.fetchedAt, Date.parse('2026-09-14T12:31:00Z'));
  assert.ok(board.updated >= 2);
  assert.equal(istLabel(board.asOf), '14 Sep 2026, 5:30 PM IST');
});

test('live-only issues are appended, with derived milestone dates marked tentative', () => {
  const parsed = parseLivePages(pages);
  const board = mergeBoard(IPOT, parsed, { fetchedAt: Date.parse('2026-09-14T12:31:00Z'), sources: [] });
  const added = board.ipos.filter((ipo) => !IPOT.some((existing) => existing.id === ipo.id));

  assert.deepEqual(
    added.map((ipo) => ipo.id),
    ['legacy-wires', 'jio-platforms']
  );
  const [legacy, jio] = added;
  assert.equal(legacy.name, 'Legacy Wires');
  assert.equal(legacy.segment, 'SME');
  assert.equal(legacy.platform, 'NSE SME');
  assert.equal(legacy.openDate, '2026-09-01');
  assert.equal(legacy.closeDate, '2026-09-04');
  assert.equal(legacy.listingDate, '2026-09-17'); // from the calendar event
  assert.equal(legacy.allotmentDate, '2026-09-07'); // derived: one working day after close
  assert.deepEqual(legacy.tentativeDates, ['allotment']);
  assert.equal(board.added, 2);
  assert.equal(board.ipos.length, IPOT.length + 2);

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
  assert.equal(calls.length, 5);
  assert.ok(calls.every((url) => url.startsWith('https://www.ipoji.com/')));
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
