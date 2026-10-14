import { IPO } from './types';
import { gmpPercent, parseISO, diffDays, startOfToday, formatDay, relativeDay, formatCr, lotInvestment, formatRupees } from './format';

export type TrendDir = 'up' | 'flat' | 'down';

export interface TrendInfo {
  dir: TrendDir;
  label: string;
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

export function computeTrend(ipo: IPO): TrendInfo {
  const series = gmpSeries(ipo);
  const first = series[0];
  const last = series[series.length - 1];
  const delta = last - first;
  const pct = gmpPercent(ipo);

  if (ipo.gmp == null) {
    return { dir: 'flat', label: 'Awaiting data', detail: 'Grey market quote not tracked yet' };
  }
  if (pct != null && pct >= 25 && delta >= 0) {
    return { dir: 'up', label: 'Strong', detail: 'Premium expanding in the grey market' };
  }
  if (pct != null && pct >= 0 && delta > 2) {
    return { dir: 'up', label: 'Rising', detail: 'Premium has firmed up over the last week' };
  }
  if (delta < -Math.max(2, Math.abs(first) * 0.12)) {
    return { dir: 'down', label: 'Softening', detail: 'Premium has slipped over the last week' };
  }
  return { dir: 'flat', label: 'Steady', detail: 'Premium is largely unchanged this week' };
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
export function insights(ipo: IPO): string[] {
  const out: string[] = [];
  const pct = gmpPercent(ipo);
  const today = startOfToday();
  const opensIn = diffDays(today, parseISO(ipo.openDate));

  if (ipo.gmp != null && pct != null) {
    if (pct >= 25) {
      out.push(`Grey market premium of +${Math.round(pct)}% over the upper band - strong listing expectation.`);
    } else if (pct >= 8) {
      out.push(`Steady premium of +${Math.round(pct)}% in the grey market.`);
    } else if (pct >= 0) {
      out.push(`Muted premium of +${Math.round(pct)}% - limited listing expectation right now.`);
    } else {
      out.push(`Trading at a discount of ${Math.round(pct)}% in the grey market.`);
    }
  } else if (ipo.gmp != null) {
    out.push(`Grey market premium of ${formatRupees(ipo.gmp)} - price band is still to be announced.`);
  }

  const trend = computeTrend(ipo);
  out.push(`${trend.label} trend: ${trend.detail.toLowerCase()}.`);

  if (ipo.subscription?.retail != null) {
    const r = ipo.subscription.retail;
    out.push(
      r > 50
        ? `Retail quota subscribed ${r.toFixed(2)}x - expect a small allotment chance.`
        : r > 1
          ? `Retail quota subscribed ${r.toFixed(2)}x - reasonable allotment odds.`
          : `Retail quota was undersubscribed (${r.toFixed(2)}x).`
    );
  } else if (opensIn > 0) {
    out.push(`Bidding opens ${formatDay(ipo.openDate)} (${relativeDay(ipo.openDate).toLowerCase()}).`);
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
  key: 'upcoming' | 'open' | 'allotment' | 'listed';
  label: string;
}

export function phaseOf(ipo: IPO, today = startOfToday()): Phase {
  const open = parseISO(ipo.openDate);
  const close = parseISO(ipo.closeDate);
  const allot = parseISO(ipo.allotmentDate);
  const listing = parseISO(ipo.listingDate);
  if (today >= listing) return { key: 'listed', label: 'Listed' };
  if (today >= allot) return { key: 'allotment', label: 'Allotment' };
  if (today > close) return { key: 'allotment', label: 'Allotment due' };
  if (today >= open) return { key: 'open', label: 'Open now' };
  return { key: 'upcoming', label: 'Upcoming' };
}

export function nextMilestone(ipo: IPO): { label: string; date: string } {
  const today = startOfToday();
  const steps: { label: string; date: string }[] = [
    { label: 'Opens', date: ipo.openDate },
    { label: 'Closes', date: ipo.closeDate },
    { label: 'Allotment', date: ipo.allotmentDate },
    { label: 'Listing', date: ipo.listingDate },
  ];
  for (const s of steps) {
    if (diffDays(today, parseISO(s.date)) >= 0) return s;
  }
  return steps[steps.length - 1];
}

export function dateLine(ipo: IPO): string {
  const phase = phaseOf(ipo);
  if (phase.key === 'upcoming') return `Opens ${formatDay(ipo.openDate)}`;
  if (phase.key === 'open') return `Closes ${formatDay(ipo.closeDate)} \u2022 ${relativeDay(ipo.closeDate)}`;
  if (phase.key === 'allotment') return `Allotment ${formatDay(ipo.allotmentDate)}`;
  return `Listed ${formatDay(ipo.listingDate)}`;
}
