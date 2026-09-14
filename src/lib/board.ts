import { IPO } from './types';
import { gmpPercent, daysUntil, startOfToday } from './format';
import { phaseOf } from './analysis';

export type BoardTab = 'open' | 'soon' | 'closed';

export type SortKey = 'closing' | 'premium' | 'size' | 'name' | 'listing';

export const SORT_OPTIONS: { key: SortKey; label: string; icon: string }[] = [
  { key: 'closing', label: 'Closing next', icon: 'time-outline' },
  { key: 'premium', label: 'Top premium', icon: 'trending-up' },
  { key: 'size', label: 'Issue size', icon: 'layers-outline' },
  { key: 'listing', label: 'Listing day', icon: 'calendar-outline' },
  { key: 'name', label: 'A–Z', icon: 'text-outline' },
];

export interface Board {
  open: IPO[];
  soon: IPO[];
  closed: IPO[];
}

/** Splits the board into the three tabs the home screen shows. */
export function bucketBoard(ipos: IPO[], today = startOfToday()): Board {
  const open: IPO[] = [];
  const soon: IPO[] = [];
  const closed: IPO[] = [];
  for (const ipo of ipos) {
    const phase = phaseOf(ipo, today);
    if (phase.key === 'open') open.push(ipo);
    else if (phase.key === 'upcoming') soon.push(ipo);
    else closed.push(ipo);
  }
  return {
    open: sortIpos(open, 'closing'),
    soon: sortIpos(soon, 'closing'),
    closed: sortIpos(closed, 'listing'),
  };
}

/** The date a given sort key is ordered on. */
function sortDate(ipo: IPO, key: SortKey): string {
  const phase = phaseOf(ipo);
  if (key === 'listing') return ipo.listingDate;
  if (key === 'closing') return phase.key === 'upcoming' ? ipo.openDate : ipo.closeDate;
  return ipo.closeDate;
}

export function sortIpos(ipos: IPO[], key: SortKey): IPO[] {
  const list = [...ipos];
  switch (key) {
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'premium':
      return list.sort((a, b) => (gmpPercent(b) ?? -999) - (gmpPercent(a) ?? -999));
    case 'size':
      return list.sort((a, b) => (b.issueSizeCr ?? -1) - (a.issueSizeCr ?? -1));
    case 'listing':
      // soonest listing first, but already-listed issues sink to the bottom
      return list.sort((a, b) => {
        const aPast = daysUntil(a.listingDate) < 0 ? 1 : 0;
        const bPast = daysUntil(b.listingDate) < 0 ? 1 : 0;
        if (aPast !== bPast) return aPast - bPast;
        return aPast === 0 ? a.listingDate.localeCompare(b.listingDate) : b.listingDate.localeCompare(a.listingDate);
      });
    case 'closing':
    default:
      return list.sort((a, b) => sortDate(a, key).localeCompare(sortDate(b, key)));
  }
}

/** Premium (over the upper band) that counts as a healthy grey market signal. */
export const HEALTHY_PREMIUM_PCT = 12;

export interface BoardStats {
  live: number;
  openingSoon: number;
  /** live or about-to-open issues quoting at least HEALTHY_PREMIUM_PCT over the band */
  healthyPremium: number;
  nextToOpen?: IPO;
  closingToday?: IPO;
}

export function boardStats(ipos: IPO[], today = startOfToday()): BoardStats {
  const open = ipos.filter((i) => phaseOf(i, today).key === 'open');
  const soon = ipos.filter((i) => phaseOf(i, today).key === 'upcoming');
  const active = [...open, ...soon];

  return {
    live: open.length,
    openingSoon: soon.length,
    healthyPremium: active.filter((i) => {
      const pct = gmpPercent(i);
      return pct != null && pct >= HEALTHY_PREMIUM_PCT;
    }).length,
    nextToOpen: soon.sort((a, b) => a.openDate.localeCompare(b.openDate))[0],
    closingToday: open.filter((i) => daysUntil(i.closeDate) === 0).sort((a, b) => a.closeDate.localeCompare(b.closeDate))[0],
  };
}

export function matchesQuery(ipo: IPO, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    ipo.name.toLowerCase().includes(q) ||
    (ipo.sector?.toLowerCase().includes(q) ?? false) ||
    ipo.segment.toLowerCase().includes(q) ||
    ipo.platform.toLowerCase().includes(q) ||
    ipo.exchanges.join(' ').toLowerCase().includes(q)
  );
}

export type SegmentFilter = 'all' | 'mainboard' | 'sme';

export function matchesSegment(ipo: IPO, filter: SegmentFilter): boolean {
  if (filter === 'mainboard') return ipo.segment === 'Mainboard';
  if (filter === 'sme') return ipo.segment === 'SME';
  return true;
}

export interface GmpToggles {
  quotedOnly: boolean;
  strongOnly: boolean;
  /** minimum premium % used by strongOnly (defaults to HEALTHY_PREMIUM_PCT) */
  strongThreshold?: number;
}

export function matchesToggles(ipo: IPO, toggles: GmpToggles): boolean {
  if (toggles.quotedOnly && ipo.gmp == null) return false;
  if (toggles.strongOnly) {
    const pct = gmpPercent(ipo);
    if (pct == null || pct < (toggles.strongThreshold ?? HEALTHY_PREMIUM_PCT)) return false;
  }
  return true;
}

/** Aggregate market context for the GMP board header. */
export function gmpBoardStats(ipos: IPO[]) {
  const quoted = ipos.filter((i) => gmpPercent(i) != null);
  const avg =
    quoted.length === 0
      ? null
      : quoted.reduce((sum, i) => sum + (gmpPercent(i) ?? 0), 0) / quoted.length;
  const best = [...quoted].sort((a, b) => (gmpPercent(b) ?? 0) - (gmpPercent(a) ?? 0))[0];
  const discounted = ipos.filter((i) => (i.gmp ?? 0) < 0).length;
  const flat = ipos.filter((i) => i.gmp === 0).length;
  return { quoted: quoted.length, total: ipos.length, avg, best, discounted, flat };
}

/** Days until the next milestone, used for countdown copy. */
export function daysToNextMilestone(ipo: IPO): number | null {
  const dates = [ipo.openDate, ipo.closeDate, ipo.allotmentDate, ipo.listingDate];
  for (const d of dates) {
    const days = daysUntil(d);
    if (days >= 0) return days;
  }
  return null;
}
