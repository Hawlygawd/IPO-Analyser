import { IPO, MilestoneKey, NotifPrefs } from './types';
import { formatDay, formatRupees, parseISO, startOfToday } from './format';

/**
 * Pure reminder planning.
 *
 * This module deliberately has no React Native or expo-notifications imports so the
 * schedule can be unit tested - and so the web preview can show the exact plan that the
 * native build would fire.
 */

export interface Reminder {
  /** stable identifier so a reschedule replaces the previous one */
  id: string;
  ipoId: string;
  milestone: MilestoneKey;
  title: string;
  body: string;
  date: Date;
  /** human label used for the in-app reminder log */
  when: string;
}

function atHour(iso: string, hour: number, minute = 30): Date {
  const d = parseISO(iso);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** A reminder is only worth queueing while it is still comfortably in the future. */
function isFuture(date: Date): boolean {
  return date.getTime() > Date.now() + 5 * 60 * 1000;
}

export function reminderBandLabel(ipo: IPO): string {
  if (ipo.priceBandLow != null && ipo.priceBandHigh != null) {
    return `${formatRupees(ipo.priceBandLow)}–${formatRupees(ipo.priceBandHigh)}`;
  }
  return 'price band to be announced';
}

/** Builds the reminder set for a watched IPO based on the user's preferences. */
export function buildReminders(ipo: IPO, prefs: NotifPrefs): Reminder[] {
  const plans: Reminder[] = [];
  const band = reminderBandLabel(ipo);

  if (prefs.openDay) {
    const morning = atHour(ipo.openDate, 9, 0);
    if (isFuture(morning)) {
      plans.push({
        id: `${ipo.id}-open`,
        ipoId: ipo.id,
        milestone: 'open',
        title: `${ipo.name} opens for bidding today`,
        body: `${band} • closes ${formatDay(ipo.closeDate)}.`,
        date: morning,
        when: `${formatDay(ipo.openDate)}, 9:00 AM`,
      });
    }
    const eve = atHour(ipo.openDate, 18, 0);
    eve.setDate(eve.getDate() - 1);
    if (isFuture(eve) && eve.getTime() > startOfToday().getTime()) {
      plans.push({
        id: `${ipo.id}-open-eve`,
        ipoId: ipo.id,
        milestone: 'open',
        title: `${ipo.name} opens tomorrow`,
        body: 'Keep your UPI mandate and bank details ready.',
        date: eve,
        when: `${formatDay(ipo.openDate)}, evening before`,
      });
    }
  }

  if (prefs.lastDay) {
    const last = atHour(ipo.closeDate, 11, 0);
    if (isFuture(last)) {
      plans.push({
        id: `${ipo.id}-close`,
        ipoId: ipo.id,
        milestone: 'close',
        title: `Last day to apply for ${ipo.name}`,
        body: `Bidding closes at 5 PM on ${formatDay(ipo.closeDate)}.`,
        date: last,
        when: `${formatDay(ipo.closeDate)}, 11:00 AM`,
      });
    }
  }

  if (prefs.allotment) {
    const allot = atHour(ipo.allotmentDate, 11, 0);
    if (isFuture(allot)) {
      plans.push({
        id: `${ipo.id}-allot`,
        ipoId: ipo.id,
        milestone: 'allotment',
        title: `${ipo.name}: allotment day`,
        body: 'The basis of allotment is expected today - check your ASBA bank or the registrar.',
        date: allot,
        when: `${formatDay(ipo.allotmentDate)}, 11:00 AM`,
      });
    }
  }

  if (prefs.listing) {
    const list = atHour(ipo.listingDate, 9, 15);
    if (isFuture(list)) {
      plans.push({
        id: `${ipo.id}-list`,
        ipoId: ipo.id,
        milestone: 'listing',
        title: `${ipo.name} lists today`,
        body: `Shares are expected to debut on ${ipo.exchanges.join(' & ')}.`,
        date: list,
        when: `${formatDay(ipo.listingDate)}, 9:15 AM`,
      });
    }
  }

  return plans.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 6);
}

/** Preview of the reminder plan - used wherever real notifications are unavailable. */
export function reminderPlanFor(ipo: IPO, prefs: NotifPrefs): { count: number; next?: Reminder } {
  const plans = buildReminders(ipo, prefs);
  return { count: plans.length, next: plans[0] };
}

/** Flattens and orders the reminders for a whole watchlist. */
export function watchlistPlan(ipos: IPO[], prefs: NotifPrefs): (Reminder & { ipoName: string })[] {
  return ipos
    .flatMap((ipo) => buildReminders(ipo, prefs).map((plan) => ({ ...plan, ipoName: ipo.name })))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
