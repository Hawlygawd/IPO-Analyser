import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countdownLabel,
  daysUntil,
  diffDays,
  formatCr,
  formatPct,
  formatRupees,
  gmpPercent,
  indicativeListing,
  lotInvestment,
  parseISO,
  priceBandLabel,
  startOfToday,
} from '../format';
import { IPO } from '../types';

const base: IPO = {
  id: 'x',
  name: 'Test Ltd',
  segment: 'Mainboard',
  platform: 'NSE',
  openDate: '2026-09-16',
  closeDate: '2026-09-18',
  allotmentDate: '2026-09-21',
  listingDate: '2026-09-23',
  tentativeDates: [],
  priceBandLow: 100,
  priceBandHigh: 120,
  gmp: 30,
  exchanges: ['NSE'],
  about: 'A test issue used only by the unit tests in this folder.',
  sourceName: 'test',
  sourceUrl: 'https://example.com',
};

test('parseISO builds a local date without UTC drift', () => {
  const d = parseISO('2026-09-16');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 16);
  assert.equal(d.getHours(), 0);
});

test('diffDays is exact across month and year boundaries', () => {
  assert.equal(diffDays(parseISO('2026-09-14'), parseISO('2026-09-15')), 1);
  assert.equal(diffDays(parseISO('2026-09-14'), parseISO('2026-09-14')), 0);
  assert.equal(diffDays(parseISO('2026-09-14'), parseISO('2026-09-13')), -1);
  assert.equal(diffDays(parseISO('2026-08-31'), parseISO('2026-09-01')), 1);
  assert.equal(diffDays(parseISO('2026-12-31'), parseISO('2027-01-01')), 1);
  assert.equal(diffDays(parseISO('2026-01-01'), parseISO('2027-01-01')), 365);
});

test('diffDays survives a DST transition', () => {
  // Dates that straddle a DST change (US/EU) must still be whole days apart.
  assert.equal(diffDays(parseISO('2026-03-27'), parseISO('2026-03-30')), 3);
  assert.equal(diffDays(parseISO('2026-10-23'), parseISO('2026-10-26')), 3);
});

test('daysUntil counts from today', () => {
  const today = startOfToday();
  assert.equal(daysUntil(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`), 0);
});

test('countdown labels read naturally', () => {
  const today = startOfToday();
  const iso = (offset: number) => {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  assert.equal(countdownLabel(iso(0)), 'today');
  assert.equal(countdownLabel(iso(1)), 'tomorrow');
  assert.equal(countdownLabel(iso(3)), 'in 3 days');
  assert.equal(countdownLabel(iso(-1)), 'yesterday');
  assert.equal(countdownLabel(iso(-4)), '4 days ago');
});

test('money formatting is Indian-format and sign-aware', () => {
  assert.equal(formatRupees(14868), '₹14,868');
  assert.equal(formatRupees(2256157), '₹22,56,157');
  assert.equal(formatCr(1055.74), '₹1,055.74 Cr');
  assert.equal(formatCr(undefined), 'TBA');
  assert.equal(formatPct(38.2), '+38.2%');
  assert.equal(formatPct(-4), '−4.0%');
  assert.equal(formatPct(0), '0.0%');
});

test('GMP maths follow the tracker definitions', () => {
  assert.equal(gmpPercent(base), 25);
  assert.equal(indicativeListing(base), 150);
  assert.equal(lotInvestment({ ...base, lotSize: 10 }), 1200);
  assert.equal(lotInvestment({ ...base, lotSize: 10 }, 3), 3600);
  assert.equal(priceBandLabel(base), '₹100–₹120');
  assert.equal(priceBandLabel({ ...base, priceBandLow: 94, priceBandHigh: 94 }), '₹94');
});

test('a missing price band disables every derived number', () => {
  const tba: IPO = { ...base, priceBandLow: undefined, priceBandHigh: undefined, lotSize: undefined };
  assert.equal(gmpPercent(tba), null);
  assert.equal(indicativeListing(tba), null);
  assert.equal(lotInvestment(tba), null);
  assert.equal(priceBandLabel(tba), 'Band TBA');
});

test('a missing quote disables the premium maths', () => {
  const noQuote: IPO = { ...base, gmp: undefined };
  assert.equal(gmpPercent(noQuote), null);
  assert.equal(indicativeListing(noQuote), null);
});
