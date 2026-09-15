import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardStats,
  bucketBoard,
  daysToNextMilestone,
  gmpBoardStats,
  matchesQuery,
  matchesToggles,
  sortIpos,
} from '../board';
import { parseISO, startOfToday } from '../format';
import { IPOT, DATA_AS_OF } from '../ipoData';
import { IPO } from '../types';

const asOf = parseISO(DATA_AS_OF.slice(0, 10));

test('bucketBoard puts every issue in exactly one tab', () => {
  const board = bucketBoard(IPOT, asOf);
  const all = [...board.open, ...board.soon, ...board.closed];
  assert.equal(all.length, IPOT.length);
  assert.equal(new Set(all.map((i) => i.id)).size, IPOT.length);
  assert.ok(board.open.length > 0);
  assert.ok(board.soon.length > 0);
  assert.ok(board.closed.length > 0);
});

test('the open tab sorts by the soonest close', () => {
  const { open } = bucketBoard(IPOT, asOf);
  const closes = open.map((i) => i.closeDate);
  assert.deepEqual(closes, [...closes].sort());
});

test('the soon tab sorts by the soonest opening', () => {
  const { soon } = bucketBoard(IPOT, asOf);
  const opens = soon.map((i) => i.openDate);
  assert.deepEqual(opens, [...opens].sort());
});

test('sortIpos never mutates the input array', () => {
  const sample = IPOT.slice(0, 5);
  const before = sample.map((i) => i.id);
  sortIpos(sample, 'premium');
  sortIpos(sample, 'name');
  sortIpos(sample, 'size');
  assert.deepEqual(sample.map((i) => i.id), before);
});

test('sortIpos applies each key coherently', () => {
  const byName = sortIpos(IPOT, 'name').map((i) => i.name);
  assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b)));

  const bySize = sortIpos(IPOT, 'size').map((i) => i.issueSizeCr ?? -1);
  assert.deepEqual(bySize, [...bySize].sort((a, b) => b - a));

  const byPremium = sortIpos(IPOT, 'premium');
  const pcts = byPremium.map((i) => (i.priceBandHigh && i.gmp != null ? i.gmp / i.priceBandHigh : null));
  const known = pcts.filter((p): p is number => p != null);
  assert.deepEqual(known, [...known].sort((a, b) => b - a));
});

test('boardStats counts live issues and finds the next opening', () => {
  const stats = boardStats(IPOT, asOf);
  assert.equal(stats.live, IPOT.filter((i) => i.openDate <= DATA_AS_OF.slice(0, 10) && i.closeDate >= DATA_AS_OF.slice(0, 10)).length);
  assert.ok(stats.openingSoon > 0);
  assert.ok(stats.healthyPremium >= 0);
  assert.ok(stats.nextToOpen != null && stats.nextToOpen.openDate > DATA_AS_OF.slice(0, 10));
});

test('search matches name, sector, platform and exchange', () => {
  const sample = IPOT.find((i) => i.id === 'kanohar-electricals')!;
  assert.equal(matchesQuery(sample, ''), true);
  assert.equal(matchesQuery(sample, 'kanohar'), true);
  assert.equal(matchesQuery(sample, 'POWER'), true);
  assert.equal(matchesQuery(sample, 'nse'), true);
  assert.equal(matchesQuery(sample, 'zzzzz'), false);
});

test('every issue on the board is mainboard', () => {
  // SME rows were removed from the app; the bundle and the live merge must not carry one back
  assert.ok(IPOT.every((ipo) => ipo.segment === 'Mainboard'));
  assert.equal(IPOT.some((ipo) => /SME/i.test(ipo.platform)), false, 'an SME platform label survived');
});

test('the quoted and premium toggles filter exactly as labelled', () => {
  const quoted = IPOT.filter((i) => matchesToggles(i, { quotedOnly: true, strongOnly: false }));
  assert.ok(quoted.every((i) => i.gmp != null));
  assert.ok(quoted.length < IPOT.length, 'some issues should have no quote at all');

  for (const ipo of IPOT.filter((i) => matchesToggles(i, { quotedOnly: false, strongOnly: true }))) {
    const pct = ipo.priceBandHigh ? ((ipo.gmp ?? 0) / ipo.priceBandHigh) * 100 : null;
    assert.ok(pct != null && pct >= 12, `${ipo.id} should not pass the >=12% toggle`);
  }

  const both = IPOT.filter((i) => matchesToggles(i, { quotedOnly: true, strongOnly: true }));
  assert.ok(both.every((i) => i.gmp != null));
  assert.ok(both.length <= quoted.length);

  // a custom threshold is honoured
  const threshold = IPOT.filter((i) => matchesToggles(i, { quotedOnly: false, strongOnly: true, strongThreshold: 30 }));
  assert.ok(threshold.every((i) => (i.gmp ?? 0) / (i.priceBandHigh ?? 1) * 100 >= 30));
});

test('gmpBoardStats averages only the quoted rows', () => {
  const stats = gmpBoardStats(IPOT);
  const quoted = IPOT.filter((i) => i.gmp != null && i.priceBandHigh != null);
  assert.equal(stats.quoted, quoted.length);
  assert.equal(stats.total, IPOT.length);
  assert.ok(stats.avg != null);
  const expected = quoted.reduce((sum, i) => sum + (i.gmp! / i.priceBandHigh!) * 100, 0) / quoted.length;
  assert.ok(Math.abs((stats.avg ?? 0) - expected) < 1e-9);
  assert.ok(stats.best != null);
});

test('daysToNextMilestone is never negative while a date remains', () => {
  const ipo: IPO = IPOT.find((i) => i.id === 'a-one-steels')!;
  const days = daysToNextMilestone(ipo);
  assert.ok(days == null || days >= 0);
});

test('a fully past issue reports no upcoming milestone', () => {
  const past: IPO = { ...IPOT[0], listingDate: '2020-01-01', allotmentDate: '2020-01-01', closeDate: '2020-01-01', openDate: '2020-01-01' };
  assert.equal(daysToNextMilestone(past), null);
});

test('bucketBoard with the live clock still classifies every issue', () => {
  const board = bucketBoard(IPOT, startOfToday());
  assert.equal(board.open.length + board.soon.length + board.closed.length, IPOT.length);
});
