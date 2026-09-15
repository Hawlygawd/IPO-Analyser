import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allotmentOdds,
  dateLine,
  dataAge,
  gmpSignal,
  insights,
  milestones,
  nextMilestone,
  phaseOf,
  sentiment,
  subscriptionRows,
} from '../analysis';
import { parseISO } from '../format';
import { IPO } from '../types';

function makeIpo(overrides: Partial<IPO> = {}): IPO {
  return {
    id: 'sample',
    name: 'Sample Industries',
    segment: 'Mainboard',
    platform: 'NSE',
    openDate: '2026-09-16',
    closeDate: '2026-09-18',
    allotmentDate: '2026-09-21',
    listingDate: '2026-09-23',
    tentativeDates: [],
    priceBandLow: 100,
    priceBandHigh: 120,
    lotSize: 100,
    issueSizeCr: 500,
    issueType: 'Book built',
    exchanges: ['NSE', 'BSE'],
    gmp: 30,
    about: 'A sample issue long enough to satisfy the copy requirements of the screen.',
    sourceName: 'test',
    sourceUrl: 'https://example.com',
    ...overrides,
  };
}

const phaseP = (date: string) => parseISO(date);

test('phaseOf covers the whole lifecycle, including the close-day boundary', () => {
  const ipo = makeIpo();
  assert.equal(phaseOf(ipo, phaseP('2026-09-15')).key, 'upcoming');
  assert.equal(phaseOf(ipo, phaseP('2026-09-16')).key, 'open');
  assert.equal(phaseOf(ipo, phaseP('2026-09-17')).key, 'open');
  // the day bidding closes the issue is still open
  assert.equal(phaseOf(ipo, phaseP('2026-09-18')).key, 'open');
  assert.equal(phaseOf(ipo, phaseP('2026-09-19')).key, 'allotment');
  assert.equal(phaseOf(ipo, phaseP('2026-09-21')).key, 'allotment');
  assert.equal(phaseOf(ipo, phaseP('2026-09-23')).key, 'listed');
  assert.equal(phaseOf(ipo, phaseP('2027-01-01')).key, 'listed');
});

test('an issue past its allotment date is labelled as awaiting listing', () => {
  const ipo = makeIpo();
  assert.equal(phaseOf(ipo, phaseP('2026-09-21')).label, 'Awaiting listing');
  assert.equal(phaseOf(ipo, phaseP('2026-09-22')).key, 'allotment');
  assert.equal(phaseOf(ipo, phaseP('2026-09-19')).label, 'Awaiting allotment');
});

test('phaseOf flags an issue whose allotment date trails its own listing date order', () => {
  // allotment==close (SME same-day edge case) must not fall through to "upcoming"
  const ipo = makeIpo({ openDate: '2026-09-10', closeDate: '2026-09-12', allotmentDate: '2026-09-12', listingDate: '2026-09-16' });
  assert.equal(phaseOf(ipo, phaseP('2026-09-12')).key, 'open');
  assert.equal(phaseOf(ipo, phaseP('2026-09-13')).key, 'allotment');
});

test('milestones mark done, next and tentative correctly', () => {
  const ipo = makeIpo({ tentativeDates: ['listing'] });
  const steps = milestones(ipo, phaseP('2026-09-19'));
  assert.equal(steps.length, 4);
  assert.deepEqual(
    steps.map((s) => s.done),
    [true, true, false, false]
  );
  assert.equal(steps.find((s) => s.isNext)?.key, 'allotment');
  assert.equal(steps.find((s) => s.tentative)?.key, 'listing');
  assert.equal(nextMilestone(ipo, phaseP('2026-09-19'))?.key, 'allotment');
  assert.equal(nextMilestone(ipo, phaseP('2027-01-01')), undefined);
});

test('gmpSignal scales with the premium and never claims a trend it cannot see', () => {
  assert.equal(gmpSignal(makeIpo({ gmp: undefined })).label, 'No quote');
  assert.equal(gmpSignal(makeIpo({ gmp: 40 })).label, 'Strong');
  assert.equal(gmpSignal(makeIpo({ gmp: 15 })).dir, 'up');
  assert.equal(gmpSignal(makeIpo({ gmp: 3 })).tone, 'warn');
  assert.equal(gmpSignal(makeIpo({ gmp: 0 })).label, 'Flat');
  assert.equal(gmpSignal(makeIpo({ gmp: -12 })).dir, 'down');
  // a band-less issue can only be described in rupees
  const noBand = gmpSignal(makeIpo({ priceBandLow: undefined, priceBandHigh: undefined, gmp: 25 }));
  assert.equal(noBand.pct, null);
  assert.match(noBand.detail, /price band has not been announced/i);
});

test('sentiment stays inside its bounds and reacts to demand', () => {
  const weak = sentiment(makeIpo({ gmp: -20, subscription: { total: 0.4, retail: 0.2 } }));
  const strong = sentiment(makeIpo({ gmp: 90, subscription: { total: 120, retail: 60 } }));
  assert.ok(weak.score < strong.score, 'weak demand should score below strong demand');
  assert.ok(weak.score >= 5 && weak.score <= 97);
  assert.ok(strong.score >= 5 && strong.score <= 97);
  assert.equal(strong.label, 'Very strong');
  assert.ok(weak.reasons.length > 0 && strong.reasons.length > 0);

  for (const ipo of [
    makeIpo(),
    makeIpo({ gmp: undefined, subscription: undefined }),
    makeIpo({ gmp: 0, subscription: { total: 1 } }),
  ]) {
    const s = sentiment(ipo);
    assert.ok(Number.isInteger(s.score));
    assert.ok(s.score >= 5 && s.score <= 97, `score out of range: ${s.score}`);
  }
});

test('subscriptionRows only includes categories that were published', () => {
  assert.deepEqual(subscriptionRows(makeIpo({ subscription: undefined })), []);
  const rows = subscriptionRows(makeIpo({ subscription: { qib: 2.5, total: 4 } }));
  assert.deepEqual(
    rows.map((r) => r.key),
    ['qib', 'total']
  );
  assert.equal(rows[0].display, '2.50x');
  const retail = subscriptionRows(makeIpo({ subscription: { retail: 1.1 } }));
  assert.equal(retail[0].label, 'Retail');
});

test('allotmentOdds describes every band without gaps', () => {
  assert.equal(allotmentOdds(makeIpo({ subscription: undefined })), null);
  assert.match(allotmentOdds(makeIpo({ subscription: { retail: 0.5 } }))!, /allotted in full/i);
  assert.match(allotmentOdds(makeIpo({ subscription: { retail: 2 } }))!, /comfortable/i);
  assert.match(allotmentOdds(makeIpo({ subscription: { retail: 6 } }))!, /moderate/i);
  assert.match(allotmentOdds(makeIpo({ subscription: { retail: 25 } }))!, /lottery/i);
  assert.match(allotmentOdds(makeIpo({ subscription: { retail: 300 } }))!, /very low/i);
});

test('insights never exceed four bullets and mention the source shortfall', () => {
  const full = insights(
    makeIpo({
      subscription: { total: 90, retail: 30, qib: 40 },
      tentativeDates: ['allotment', 'listing'],
    })
  );
  assert.ok(full.length <= 4 && full.length >= 3);
  const bare = insights(
    makeIpo({
      gmp: undefined,
      subscription: undefined,
      priceBandLow: undefined,
      priceBandHigh: undefined,
      lotSize: undefined,
      issueSizeCr: undefined,
    })
  );
  assert.ok(bare.length <= 4);
  assert.ok(bare.some((line) => /no grey market quote/i.test(line)));
});

test('the card date line always points at the next event', () => {
  const ipo = makeIpo();
  assert.match(dateLine(ipo, phaseP('2026-09-15')), /Bids open 16 Sept/);
  assert.match(dateLine(ipo, phaseP('2026-09-17')), /Closes 18 Sept/);
  assert.match(dateLine(ipo, phaseP('2026-09-19')), /Allotment 21 Sept/);
  // past allotment the listing is the only thing left
  assert.match(dateLine(ipo, phaseP('2026-09-22')), /Lists 23 Sept/);
  assert.match(dateLine(ipo, phaseP('2026-09-25')), /Listed 23 Sept/);
});

test('dataAge flags a stale snapshot', () => {
  const fresh = dataAge(new Date('2026-09-14T20:00:00+05:30'));
  assert.equal(fresh.days, 0);
  assert.equal(fresh.stale, false);
  const old = dataAge(new Date('2026-09-19T20:00:00+05:30'));
  assert.ok(old.days >= 5);
  assert.equal(old.stale, true);
});
