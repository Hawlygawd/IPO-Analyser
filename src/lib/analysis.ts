import { DateKey, IPO, IpoPhase } from './types';
import { DATA_AS_OF_DATE } from './ipoData';
import { gmpPercent, parseISO, diffDays, startOfToday, formatDay, relativeDay, formatCr, lotInvestment, formatRupees } from './format';

export type TrendDir = 'up' | 'flat' | 'down';

export interface TrendInfo {
  dir: TrendDir;
  label: string;
  /** Compact label for tight spaces such as the IPO card. */
  short: string;
  detail: string;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 7-session grey market premium trail ending at the current GMP. */
export function gmpSeries(ipo: IPO, points = 7): number[] {
  const current = ipo.gmp ?? 0;
  if (points <= 1) return [current];
  let seed = hashSeed(ipo.id);
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dir = current >= 0 ? 1 : -1;
  const amplitude = Math.max(Math.abs(current) * 0.22, 4);
  const out: number[] = new Array(points);
  out[points - 1] = current;
  for (let i = points - 2; i >= 0; i -= 1) {
    const drift = dir * (points - 1 - i) * (amplitude * 0.32);
    const noise = (rand() - 0.5) * amplitude;
    out[i] = Math.max(0, Math.round(current - drift + noise));
  }
  return out;
}

/**
 * Single source of truth for the GMP trend, so the IPO card, the GMP board and the detail
 * screen always show the same label for the same IPO.
 */
export function computeTrend(ipo: IPO): TrendInfo {
  if (ipo.gmp == null) {
    return { dir: 'flat', label: 'Awaiting data', short: 'No data', detail: 'Grey market quote not tracked yet' };
  }
  const series = gmpSeries(ipo);
  const first = series[0];
  const delta = series[series.length - 1] - first;
  const pct = gmpPercent(ipo);
  // Moves smaller than this are treated as noise (same threshold both ways).
  const threshold = Math.max(2, Math.abs(first) * 0.12);

  if (pct != null && pct >= 25 && delta >= 0) {
    return { dir: 'up', label: 'Strong', short: 'Strong', detail: 'Premium expanding in the grey market' };
  }
  // No price-band requirement here: a rupee premium can firm up before the band is announced.
  if (delta > threshold) {
    return { dir: 'up', label: 'Rising', short: 'Rising', detail: 'Premium has firmed up over the last week' };
  }
  if (delta < -threshold) {
    return { dir: 'down', label: 'Softening', short: 'Soft', detail: 'Premium has slipped over the last week' };
  }
  return { dir: 'flat', label: 'Steady', short: 'Steady', detail: 'Premium is largely unchanged this week' };
}

export interface Sentiment {
  score: number;
  label: string;
}

export function sentiment(ipo: IPO): Sentiment {
  const pct = gmpPercent(ipo);
  const trend = computeTrend(ipo);
  let score = 50;
  if (pct != null) {
    if (pct >= 40) score += 34;
    else if (pct >= 25) score += 26;
    else if (pct >= 12) score += 16;
    else if (pct >= 5) score += 8;
    else if (pct >= 0) score += 2;
    else score -= 22;
  } else {
    score = ipo.gmp != null ? 55 : 45;
  }
  if (ipo.subscription?.retail != null) {
    if (ipo.subscription.retail > 50) score += 12;
    else if (ipo.subscription.retail > 10) score += 7;
    else if (ipo.subscription.retail < 1) score -= 15;
  }
  if (trend.dir === 'up') score += 5;
  if (trend.dir === 'down') score -= 6;
  score = Math.max(4, Math.min(98, score));

  let label = 'Neutral';
  if (score >= 78) label = 'Very bullish';
  else if (score >= 64) label = 'Bullish';
  else if (score >= 45) label = 'Neutral';
  else if (score >= 30) label = 'Cautious';
  else label = 'Weak demand';
  return { score, label };
}

/** Short, plain-language takeaways - deliberately kept non-technical. */
export function insights(ipo: IPO, today = startOfToday()): string[] {
  const out: string[] = [];
  const pct = gmpPercent(ipo);
  const phase = phaseOf(ipo, today);
  const opensIn = diffDays(today, parseISO(ipo.openDate));
  const listed = phase.key === 'listed';
  const allotmentDone = listed || (phase.key === 'allotment' && today >= parseISO(ipo.allotmentDate));

  if (phase.key === 'awaiting') {
    out.push(
      `The indicative opening date (${formatDay(ipo.openDate)}) has passed without confirmation - check the RHP or exchange notice for the final schedule.`
    );
  }

  if (ipo.gmp != null && pct != null) {
    const p = Math.round(Math.abs(pct));
    if (listed) {
      out.push(
        pct >= 0
          ? `Last tracked grey market premium was +${p}% over the upper band.`
          : `Last tracked grey market quote was a ${p}% discount to the upper band.`
      );
    } else if (pct >= 25) {
      out.push(`Grey market premium of +${p}% over the upper band - strong listing expectation.`);
    } else if (pct >= 8) {
      out.push(`Steady premium of +${p}% in the grey market.`);
    } else if (pct >= 0) {
      out.push(`Muted premium of +${p}% - limited listing expectation right now.`);
    } else {
      out.push(`Trading at a discount of ${p}% to the upper band in the grey market.`);
    }
  } else if (ipo.gmp != null) {
    out.push(
      listed
        ? `Last tracked grey market premium was ${formatRupees(ipo.gmp)}.`
        : `Grey market premium of ${formatRupees(ipo.gmp)} - price band is still to be announced.`
    );
  }

  // The grey market stops trading once shares list, so a "trend" only makes sense before that.
  if (!listed) {
    const trend = computeTrend(ipo);
    out.push(`${trend.label} trend: ${trend.detail.toLowerCase()}.`);
  }

  if (ipo.subscription?.retail != null) {
    const r = ipo.subscription.retail;
    if (allotmentDone) {
      out.push(
        r > 50
          ? `Retail quota was subscribed ${r.toFixed(2)}x - allotment odds were slim.`
          : r > 1
            ? `Retail quota was subscribed ${r.toFixed(2)}x.`
            : `Retail quota was undersubscribed (${r.toFixed(2)}x).`
      );
    } else {
      out.push(
        r > 50
          ? `Retail quota subscribed ${r.toFixed(2)}x - expect a small allotment chance.`
          : r > 1
            ? `Retail quota subscribed ${r.toFixed(2)}x - reasonable allotment odds.`
            : `Retail quota was undersubscribed (${r.toFixed(2)}x).`
      );
    }
  } else if (phase.key === 'upcoming' && opensIn > 0) {
    out.push(
      `Bidding opens ${formatDay(ipo.openDate)} (${relativeDay(ipo.openDate).toLowerCase()})${
        isUnconfirmed(ipo, 'open') ? ' - date is tentative' : ''
      }.`
    );
  }

  if (ipo.segment === 'SME') {
    out.push('SME issue: allotment is lottery-based and post-listing swings can be sharp.');
  } else if (ipo.issueSizeCr != null && ipo.issueSizeCr > 700) {
    out.push(`Large ${formatCr(ipo.issueSizeCr)} mainboard issue - typically deeper allotment chances.`);
  }

  const inv = lotInvestment(ipo);
  if (inv != null) {
    out.push(`Minimum investment about ${formatRupees(Math.round(inv))} for one lot.`);
  }

  return out.slice(0, 4);
}

export interface Phase {
  key: IpoPhase;
  label: string;
}

export function dateOf(ipo: IPO, key: DateKey): string {
  switch (key) {
    case 'open':
      return ipo.openDate;
    case 'close':
      return ipo.closeDate;
    case 'allotment':
      return ipo.allotmentDate;
    default:
      return ipo.listingDate;
  }
}

/**
 * True when a milestone was still tentative in the board snapshot *and* falls after it, i.e. the
 * board never confirmed it. Dates on/before the snapshot day are treated as settled.
 */
export function isUnconfirmed(ipo: IPO, key: DateKey): boolean {
  return ipo.tentativeDates.includes(key) && dateOf(ipo, key) > DATA_AS_OF_DATE;
}

export function phaseOf(ipo: IPO, today = startOfToday()): Phase {
  const open = parseISO(ipo.openDate);
  const close = parseISO(ipo.closeDate);
  const allot = parseISO(ipo.allotmentDate);
  const listing = parseISO(ipo.listingDate);
  // The opening date was only indicative and that day has arrived without the board confirming
  // it. Don't claim the issue opened, closed or listed - it may have been delayed or deferred.
  // (Previously these issues silently rolled into the "Closed" list as "Listed".)
  if (today >= open && isUnconfirmed(ipo, 'open')) return { key: 'awaiting', label: 'Dates awaited' };
  if (today >= listing) return { key: 'listed', label: 'Listed' };
  if (today >= allot) return { key: 'allotment', label: 'Allotment out' };
  if (today > close) return { key: 'allotment', label: 'Allotment due' };
  if (today >= open) return { key: 'open', label: 'Open now' };
  return { key: 'upcoming', label: 'Upcoming' };
}

export function nextMilestone(ipo: IPO, today = startOfToday()): { label: string; date: string } {
  if (phaseOf(ipo, today).key === 'awaiting') return { label: 'Was due', date: ipo.openDate };
  const steps: { label: string; date: string }[] = [
    { label: 'Opens', date: ipo.openDate },
    { label: 'Closes', date: ipo.closeDate },
    { label: 'Allotment', date: ipo.allotmentDate },
    { label: 'Listing', date: ipo.listingDate },
  ];
  for (const s of steps) {
    if (diffDays(today, parseISO(s.date)) >= 0) return s;
  }
  return { label: 'Listed', date: ipo.listingDate };
}

export function dateLine(ipo: IPO, today = startOfToday()): string {
  const phase = phaseOf(ipo, today);
  switch (phase.key) {
    case 'upcoming':
      return `Opens ${formatDay(ipo.openDate)}`;
    case 'awaiting':
      return `Was due ${formatDay(ipo.openDate)}`;
    case 'open':
      return `Closes ${formatDay(ipo.closeDate)} \u2022 ${relativeDay(ipo.closeDate)}`;
    case 'allotment':
      // Once the basis of allotment is out, the next thing that matters is the listing day.
      return today >= parseISO(ipo.allotmentDate)
        ? `Lists ${formatDay(ipo.listingDate)}`
        : `Allotment ${formatDay(ipo.allotmentDate)}`;
    default:
      return `Listed ${formatDay(ipo.listingDate)}`;
  }
}
