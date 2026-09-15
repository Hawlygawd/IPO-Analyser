import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReminders, reminderPlanFor, watchlistPlan } from '../reminders';
import { NotifPrefs } from '../types';
import { IPOT } from '../ipoData';

const ALL_ON: NotifPrefs = { openDay: true, lastDay: true, allotment: true, listing: true };
const ALL_OFF: NotifPrefs = { openDay: false, lastDay: false, allotment: false, listing: false };

/** An issue far enough in the future that every reminder is still ahead of the clock. */
const future = { ...IPOT[0], id: 'future-ipo', openDate: '2030-03-04', closeDate: '2030-03-06', allotmentDate: '2030-03-08', listingDate: '2030-03-11' };

test('every enabled milestone produces a reminder', () => {
  const plans = buildReminders(future, ALL_ON);
  const milestones = new Set(plans.map((p) => p.milestone));
  assert.ok(milestones.has('open'));
  assert.ok(milestones.has('close'));
  assert.ok(milestones.has('allotment'));
  assert.ok(milestones.has('listing'));
  assert.ok(plans.length >= 4);
});

test('disabled preferences suppress their reminders', () => {
  const onlyListing = buildReminders(future, { ...ALL_OFF, listing: true });
  assert.deepEqual([...new Set(onlyListing.map((p) => p.milestone))], ['listing']);
  assert.deepEqual(buildReminders(future, ALL_OFF), []);
});

test('reminder identifiers are unique and namespaced per IPO', () => {
  const plans = buildReminders(future, ALL_ON);
  const ids = plans.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith(`${future.id}-`)));
});

test('reminders are ordered, future-dated and capped', () => {
  const plans = buildReminders(future, ALL_ON);
  const times = plans.map((p) => p.date.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  for (const plan of plans) {
    assert.ok(plan.date.getTime() > Date.now(), `${plan.id} is not in the future`);
    assert.ok(!Number.isNaN(plan.date.getTime()));
    assert.ok(plan.title.length > 0 && plan.body.length > 0);
  }
  assert.ok(plans.length <= 6);
});

test('an issue whose dates have passed schedules nothing', () => {
  const past = { ...future, openDate: '2020-01-06', closeDate: '2020-01-08', allotmentDate: '2020-01-10', listingDate: '2020-01-13' };
  assert.deepEqual(buildReminders(past, ALL_ON), []);
});

test('the reminder plan is derivable without the notification module being available', () => {
  const plan = reminderPlanFor(future, ALL_ON);
  assert.ok(plan.count > 0);
  assert.equal(plan.next?.date.getTime(), buildReminders(future, ALL_ON)[0].date.getTime());
});

test('the watchlist plan is a single ordered timeline across issues', () => {
  const a = { ...future, id: 'a', name: 'Alpha Ltd' };
  const b = { ...future, id: 'b', name: 'Beta Ltd', openDate: '2030-03-18', closeDate: '2030-03-20', allotmentDate: '2030-03-22', listingDate: '2030-03-25' };
  const plan = watchlistPlan([a, b], ALL_ON);
  const times = plan.map((p) => p.date.getTime());
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
  assert.ok(plan.some((p) => p.ipoName === 'Alpha Ltd'));
  assert.ok(plan.some((p) => p.ipoName === 'Beta Ltd'));
  assert.ok(plan.every((p) => p.ipoName.length > 0));
});
