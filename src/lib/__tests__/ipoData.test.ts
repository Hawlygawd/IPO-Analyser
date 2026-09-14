import assert from 'node:assert/strict';
import test from 'node:test';
import { IPOT, IPO_BY_ID, getIpo, DATA_AS_OF } from '../ipoData';
import { parseISO } from '../format';
import { phaseOf } from '../analysis';
import { Platform, MilestoneKey } from '../types';

const VALID_PLATFORMS: Platform[] = ['NSE', 'BSE', 'NSE SME', 'BSE SME'];
const VALID_MILESTONES: MilestoneKey[] = ['open', 'close', 'allotment', 'listing'];

test('the board is not empty and every id is unique', () => {
  assert.ok(IPOT.length >= 20, `expected a populated board, got ${IPOT.length}`);
  const ids = new Set(IPOT.map((i) => i.id));
  assert.equal(ids.size, IPOT.length, 'duplicate IPO ids on the board');
  assert.equal(Object.keys(IPO_BY_ID).length, IPOT.length);
});

test('every row has well-formed, correctly ordered dates', () => {
  for (const ipo of IPOT) {
    const dates = [ipo.openDate, ipo.closeDate, ipo.allotmentDate, ipo.listingDate];
    for (const date of dates) {
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `${ipo.id}: bad date ${date}`);
      assert.ok(!Number.isNaN(parseISO(date).getTime()), `${ipo.id}: unparseable date ${date}`);
    }
    assert.ok(ipo.openDate <= ipo.closeDate, `${ipo.id}: opens after it closes`);
    assert.ok(ipo.closeDate <= ipo.allotmentDate, `${ipo.id}: allotment before close`);
    assert.ok(ipo.allotmentDate <= ipo.listingDate, `${ipo.id}: listing before allotment`);
  }
});

test('prices, lots and issue sizes are sane', () => {
  for (const ipo of IPOT) {
    if (ipo.priceBandLow != null && ipo.priceBandHigh != null) {
      assert.ok(ipo.priceBandLow > 0, `${ipo.id}: non-positive price band`);
      assert.ok(ipo.priceBandLow <= ipo.priceBandHigh, `${ipo.id}: band low above band high`);
    }
    if (ipo.lotSize != null) assert.ok(ipo.lotSize > 0, `${ipo.id}: non-positive lot size`);
    if (ipo.issueSizeCr != null) assert.ok(ipo.issueSizeCr > 0, `${ipo.id}: non-positive issue size`);
    if (ipo.gmp != null) assert.ok(Number.isFinite(ipo.gmp), `${ipo.id}: bad GMP`);
    if (ipo.subscription) {
      for (const [key, value] of Object.entries(ipo.subscription)) {
        if (key === 'asOf') continue;
        assert.ok(Number.isFinite(value), `${ipo.id}: subscription.${key} is not a number`);
        assert.ok((value as number) >= 0, `${ipo.id}: negative subscription multiple`);
      }
    }
  }
});

test('platform, segment and exchange metadata stay consistent', () => {
  for (const ipo of IPOT) {
    assert.ok(VALID_PLATFORMS.includes(ipo.platform), `${ipo.id}: unknown platform ${ipo.platform}`);
    assert.ok(ipo.exchanges.length > 0, `${ipo.id}: no exchanges`);
    if (ipo.platform === 'NSE SME') {
      assert.equal(ipo.segment, 'SME');
      assert.ok(ipo.exchanges.includes('NSE'));
    }
    if (ipo.platform === 'BSE SME') {
      assert.equal(ipo.segment, 'SME');
      assert.ok(ipo.exchanges.includes('BSE'));
    }
    if (ipo.segment === 'SME') assert.ok(ipo.platform.endsWith('SME'), `${ipo.id}: SME issue not on an SME platform`);
  }
});

test('sources and tentative flags are valid', () => {
  for (const ipo of IPOT) {
    assert.match(ipo.sourceUrl, /^https:\/\//, `${ipo.id}: source url must be https`);
    assert.ok(ipo.sourceName.length > 0, `${ipo.id}: missing source name`);
    assert.ok(ipo.about.length > 20, `${ipo.id}: about text too short`);
    for (const key of ipo.tentativeDates) {
      assert.ok(VALID_MILESTONES.includes(key), `${ipo.id}: unknown tentative key ${key}`);
    }
    if (ipo.gmpUpdated) assert.ok(!Number.isNaN(new Date(ipo.gmpUpdated).getTime()), `${ipo.id}: bad gmpUpdated`);
  }
});

test('every row resolves to a phase and at least one issue is bidding today', () => {
  const asOf = parseISO(DATA_AS_OF.slice(0, 10));
  const phases = IPOT.map((ipo) => phaseOf(ipo, asOf).key);
  assert.ok(phases.includes('open'), 'no issue is open on the snapshot date');
  assert.ok(phases.includes('upcoming'), 'no upcoming issue on the board');
  assert.ok(phases.includes('allotment') || phases.includes('listed'), 'no closed issue on the board');
  for (const phase of phases) {
    assert.ok(['open', 'upcoming', 'allotment', 'listed'].includes(phase));
  }
});

test('lookups return the right rows', () => {
  assert.equal(getIpo('kanohar-electricals')?.name, 'Kanohar Electricals');
  assert.equal(getIpo('does-not-exist'), undefined);
});
