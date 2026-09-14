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

/* ------------------------------------------------------------------ fixtures */

const GMP_HTML = `
<div class="gmp-summary">As of 14 Sep 2026, 5:30 PM IST, 19 of 35 tracked Mainboard &amp; SME IPOs have a recorded premium.</div>
<table class="gmp-table" id="gmpTable">
  <tbody>
    <tr class="gmp-row" data-type="mainboard" data-status="open" data-hasgmp="true"
        data-gmp="22" data-pct="16"
        data-indicative="162" data-name="Veegaland Developers"
        data-rowurl="/ipo-gmp/veegaland-developers-ipo">
      <td class="gmp-col-name" data-label="IPO">
        <a class="gmp-ipo-link" href="/ipo/veegaland-developers-ipo">Veegaland Developers IPO</a>
        <span class="gmp-mobile-meta">
          <span class="gmp-type-badge gmp-type-mainboard">Mainboard</span>
          <span class="gmp-status gmp-status-open">Open</span>
        </span>
      </td>
      <td data-label="Type"><span class="gmp-type-badge gmp-type-mainboard">Mainboard</span></td>
      <td class="gmp-num" data-label="Price Band">₹130-140</td>
      <td class="gmp-num gmp-pos" data-label="GMP" title="Veegaland Developers IPO GMP: ₹22"><a class="gmp-value-link" href="/ipo-gmp/veegaland-developers-ipo">+₹22<span class="gmp-mobile-pct"> (+16%)</span></a></td>
      <td class="gmp-num gmp-pos" data-label="GMP %">+16%</td>
      <td class="gmp-num" data-label="Indicative Listing">₹162</td>
      <td class="gmp-secondary" data-label="Open – Close"><span class="gmp-dates">Sep 10, 2026 – Sep 15, 2026</span></td>
      <td data-label="Status"><span class="gmp-status gmp-status-open">Open</span></td>
      <td class="gmp-secondary" data-label="Last Updated"><time class="gmp-updated-time" datetime="2026-09-14T12:00:00.000Z">14 Sep 2026, 5:30 PM IST</time></td>
    </tr>
    <tr class="gmp-row gmp-row-nogmp" data-type="sme" data-status="open" data-hasgmp="false"
        data-gmp="" data-pct=""
        data-indicative="" data-name="Om Galaxy"
        data-rowurl="/ipo/om-galaxy-ipo">
      <td class="gmp-col-name" data-label="IPO">
        <a class="gmp-ipo-link" href="/ipo/om-galaxy-ipo">Om Galaxy IPO</a>
        <span class="gmp-mobile-meta">
          <span class="gmp-type-badge gmp-type-bse-sme">BSE SME</span>
          <span class="gmp-status gmp-status-open">Open</span>
        </span>
      </td>
      <td data-label="Type"><span class="gmp-type-badge gmp-type-bse-sme">BSE SME</span></td>
      <td class="gmp-num" data-label="Price Band">₹85-90</td>
      <td class="gmp-num gmp-na" data-label="GMP"><span class="gmp-na" title="GMP not available yet">—</span></td>
      <td class="gmp-num gmp-na" data-label="GMP %"><span class="gmp-na">—</span></td>
      <td class="gmp-num" data-label="Indicative Listing"><span class="gmp-na">—</span></td>
      <td class="gmp-secondary" data-label="Open – Close"><span class="gmp-dates">Sep 10, 2026 – Sep 15, 2026</span></td>
      <td data-label="Status"><span class="gmp-status gmp-status-open">Open</span></td>
      <td class="gmp-secondary" data-label="Last Updated"><span class="gmp-na">—</span></td>
    </tr>
    <tr class="gmp-row gmp-row-nogmp" data-type="sme" data-status="closed" data-hasgmp="false"
        data-gmp="" data-pct="" data-indicative="" data-name="Legacy Wires"
        data-rowurl="/ipo/legacy-wires-ipo">
      <td class="gmp-col-name" data-label="IPO"><a class="gmp-ipo-link" href="/ipo/legacy-wires-ipo">Legacy Wires IPO</a></td>
      <td data-label="Type"><span class="gmp-type-badge gmp-type-nse-sme">NSE SME</span></td>
      <td class="gmp-num" data-label="Price Band">₹100-105</td>
      <td class="gmp-num gmp-na" data-label="GMP"><span class="gmp-na">—</span></td>
      <td class="gmp-num gmp-na" data-label="GMP %"><span class="gmp-na">—</span></td>
      <td class="gmp-num" data-label="Indicative Listing"><span class="gmp-na">—</span></td>
      <td class="gmp-secondary" data-label="Open – Close"><span class="gmp-dates">Sep 01, 2026 – Sep 04, 2026</span></td>
      <td data-label="Status"><span class="gmp-status gmp-status-closed">Closed</span></td>
      <td class="gmp-secondary" data-label="Last Updated"><span class="gmp-na">—</span></td>
    </tr>
  </tbody>
</table>
`;

const SUBSCRIPTION_HTML = `
<table class="subs-overview-table subs-data-table" aria-labelledby="live-ipo-overview-heading">
  <thead><tr><th scope="col">IPO</th><th scope="col">Type</th><th scope="col">Close Date</th>
    <th scope="col" class="text-center">QIB</th><th scope="col" class="text-center">NII</th>
    <th scope="col" class="text-center">Retail / Individual</th><th scope="col" class="text-center">Total</th>
    <th scope="col" class="text-center">Applications (approx.)</th><th scope="col" class="subs-overview-updated-col">Updated</th></tr>
  </thead>
  <tbody>
    <tr>
      <td class="subs-overview-name">
        <div class="subs-overview-name-cell"><div class="subs-overview-name-top">
          <a href="/ipo-subscription/veegaland-developers-ipo" class="subs-overview-ipo-link">
            <span class="subs-overview-ipo-titlerow">
              <span class="subs-overview-ipo-title">Veegaland Developers</span>
              <span class="badge_span subs-status-badge subs-status-badge--sm" data-role="status" style="background-color:var(--badge-status-live-bg);color:var(--badge-status-live-text);">
                <i class="fa-solid fa-circle" aria-hidden="true"></i> Live
              </span>
            </span>
            <span class="subs-overview-ipo-suffix">IPO subscription status</span>
          </a>
        </div></div>
      </td>
      <td class="subs-overview-type"><span class="badge_span" data-role="type" data-ipotype="Mainboard">Mainboard</span></td>
      <td class="subs-overview-date">Sep 15, 2026</td>
      <td class="text-center subs-overview-mult">0.61x</td>
      <td class="text-center subs-overview-mult">1.44x</td>
      <td class="text-center subs-overview-mult">2.02x</td>
      <td class="text-center subs-overview-mult subs-overview-mult--total"><span class="subs-overview-total-val">2.41x</span></td>
      <td class="subs-overview-apps" title="Approx. 92,318 total applications received">92,318</td>
      <td class="subs-overview-updated"><time datetime="2026-09-14T11:45:00+05:30">14 Sep 2026, 11:45 AM</time></td>
    </tr>
    <tr>
      <td class="subs-overview-name">
        <div class="subs-overview-name-cell"><div class="subs-overview-name-top">
          <a href="/ipo-subscription/manipal-payment-and-identity-ipo" class="subs-overview-ipo-link">
            <span class="subs-overview-ipo-titlerow">
              <span class="subs-overview-ipo-title">Manipal Payment &amp; Identity</span>
            </span>
          </a>
        </div></div>
      </td>
      <td class="subs-overview-type"><span class="badge_span" data-role="type" data-ipotype="NSE">NSE</span></td>
      <td class="subs-overview-date">Sep 11, 2026</td>
      <td class="text-center subs-overview-mult">1.77x</td>
      <td class="text-center subs-overview-mult">1.31x</td>
      <td class="text-center subs-overview-mult">1.25x</td>
      <td class="text-center subs-overview-mult subs-overview-mult--total"><span class="subs-overview-total-val">1.54x</span></td>
      <td class="subs-overview-apps" title="Approx. 410,552 total applications received">410,552</td>
      <td class="subs-overview-updated"><time datetime="2026-09-12T10:15:00+05:30">12 Sep 2026, 10:15 AM</time></td>
    </tr>
  </tbody>
</table>
`;

const CARDS_HTML = `
<article class="card ipo-card ipo-card-new mb-0 "
  id="ipo-card-ipo-list-hero-motors-ipo"
  data-agent-href="/ipo/hero-motors-ipo"
  data-ipo-status="current"
  data-ipo-board="mainboard">
  <header class="ipo-card-header">
    <div class="ipo-card-header-middle">
      <h3 class="ipo-card-name" title="Hero Motors Limited IPO">Hero Motors</h3>
      <div class="ipo-card-date"><time datetime="2026-09-16">Sep 16, 2026</time> – <time datetime="2026-09-18">Sep 18, 2026</time></div>
    </div>
    <div class="ipo-card-header-right">
      <span class="ipo-card-market-badge" data-ipotype="Mainboard">Mainboard</span>
      <span class="ipo-card-status-badge">Live</span>
    </div>
  </header>
  <div class="card-body"><div class="ipo-card-body-top-row">
    <div class="ipo-card-price-band"><span class="ipo-card-secondary-label">Price Band</span><span class="ipo-card-body-value">₹145-153</span></div>
    <div class="ipo-card-premium"><span class="ipo-card-secondary-label">Exp. Premium</span><span class="ipo-card-body-value">₹24 <small>(16%)</small></span></div>
  </div></div>
</article>
`;

const CALENDAR_JSON = `eventListData = [{"date":"2026-09-14","events":[{"name":"Ganesh Chaturthi","board":"Monday","url":null,"status":"HOLIDAY","statusLabel":"HOLIDAY"}]},{"date":"2026-09-17","events":[{"name":"Veegaland Developers","board":"Mainboard","slug":"veegaland-developers-ipo","url":"https://www.ipoji.com/ipo/veegaland-developers-ipo","status":"ALLOTMENT","statusLabel":"ALLOTMENT"},{"name":"Legacy Wires","board":"NSE SME","slug":"legacy-wires-ipo","url":"https://www.ipoji.com/ipo/legacy-wires-ipo","status":"LISTING","statusLabel":"LISTING"}]}];`;

const CALENDAR_HTML = `<html><body><script>const other = 1;\n        ${CALENDAR_JSON}\n        window.eventListData = eventListData;</script></body></html>`;

const pages = { gmp: GMP_HTML, subscription: SUBSCRIPTION_HTML, current: CARDS_HTML, calendar: CALENDAR_HTML };

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

test('ipo cards give the band, the expected premium and the bidding window', () => {
  const cards = parseIpoCards(CARDS_HTML);
  assert.equal(cards.length, 1);
  const [hero] = cards;
  assert.equal(hero.id, 'hero-motors');
  assert.equal(hero.segment, 'Mainboard');
  assert.equal(hero.status, 'current');
  assert.equal(hero.premiumLow, 24);
  assert.equal(hero.premiumHigh, undefined); // the card prints a single expected premium
  assert.equal(hero.premiumPct, 16);
  assert.equal(hero.openDate, '2026-09-16');
  assert.equal(hero.closeDate, '2026-09-18');
  assert.equal(hero.url, 'https://www.ipoji.com/ipo/hero-motors-ipo');
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
  assert.equal(byKey.cards.rows, 1);
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
    ['legacy-wires']
  );
  const [legacy] = added;
  assert.equal(legacy.name, 'Legacy Wires');
  assert.equal(legacy.segment, 'SME');
  assert.equal(legacy.platform, 'NSE SME');
  assert.equal(legacy.openDate, '2026-09-01');
  assert.equal(legacy.closeDate, '2026-09-04');
  assert.equal(legacy.listingDate, '2026-09-17'); // from the calendar event
  assert.equal(legacy.allotmentDate, '2026-09-07'); // derived: one working day after close
  assert.deepEqual(legacy.tentativeDates, ['allotment']);
  assert.equal(board.added, 1);
  assert.equal(board.ipos.length, IPOT.length + 1);
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
