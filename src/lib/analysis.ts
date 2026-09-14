import { IPO, IpoPhase, MilestoneKey, SubscriptionSplit } from './types';
import {
  countdownLabel,
  diffDays,
  formatCr,
  formatDay,
  formatIstTime,
  formatPct,
  formatRupees,
  gmpPercent,
  indicativeListing,
  lotInvestment,
  parseISO,
  startOfToday,
  clamp,
} from './format';
import { DATA_AS_OF } from './ipoData';

export type TrendDir = 'up' | 'flat' | 'down';

export interface TrendInfo {
  dir: TrendDir;
  /** Short label for cards: "Strong", "Muted", "No quote" ... */
  label: string;
  /** One-line explanation used on the detail screen. */
  detail: string;
}

/* ------------------------------------------------------------------- phase */

export interface Phase {
  key: IpoPhase;
  label: string;
  hint: string;
}

const PHASE_META: Record<IpoPhase, { label: string; hint: string }> = {
  upcoming: { label: 'Upcoming', hint: 'Bidding has not opened yet' },
  open: { label: 'Open now', hint: 'Bids are being accepted' },
  allotment: { label: 'Awaiting allotment', hint: 'Bidding closed - basis of allotment next' },
  listed: { label: 'Listed', hint: 'Trading on the exchange' },
};

export function phaseOf(ipo: IPO, today = startOfToday()): Phase {
  const open = parseISO(ipo.openDate);
  const close = parseISO(ipo.closeDate);
  const allot = parseISO(ipo.allotmentDate);
  const listing = parseISO(ipo.listingDate);

  let key: IpoPhase;
  if (today >= listing) key = 'listed';
  else if (today > close) key = 'allotment';
  else if (today >= open) key = 'open';
  else if (today >= allot) key = 'allotment';
  else key = 'upcoming';

  // once allotment has been finalised the only thing left is the listing
  if (key === 'allotment' && today >= allot) {
    return { key, label: 'Awaiting listing', hint: 'Allotment is done - listing is next' };
  }
  return { key, ...PHASE_META[key] };
}

export function phaseTone(phase: IpoPhase): 'up' | 'down' | 'warn' | 'info' | 'neutral' {
  if (phase === 'open') return 'up';
  if (phase === 'upcoming') return 'info';
  if (phase === 'allotment') return 'warn';
  return 'neutral';
}

export interface Milestone {
  key: MilestoneKey;
  label: string;
  date: string;
  tentative: boolean;
  done: boolean;
  isNext: boolean;
  daysAway: number;
}

export function milestones(ipo: IPO, today = startOfToday()): Milestone[] {
  const raw: { key: MilestoneKey; label: string }[] = [
    { key: 'open', label: 'Bidding opens' },
    { key: 'close', label: 'Bidding closes' },
    { key: 'allotment', label: 'Allotment finalised' },
    { key: 'listing', label: `Lists on ${ipo.exchanges.join(' & ')}` },
  ];
  const dates: Record<MilestoneKey, string> = {
    open: ipo.openDate,
    close: ipo.closeDate,
    allotment: ipo.allotmentDate,
    listing: ipo.listingDate,
  };
  const next = nextMilestone(ipo, today);
  return raw.map((step) => {
    const daysAway = diffDays(today, parseISO(dates[step.key]));
    return {
      key: step.key,
      label: step.label,
      date: dates[step.key],
      tentative: ipo.tentativeDates.includes(step.key),
      done: daysAway < 0,
      isNext: next?.key === step.key,
      daysAway,
    };
  });
}

export function nextMilestone(
  ipo: IPO,
  today = startOfToday()
): { key: MilestoneKey; label: string; date: string } | undefined {
  const steps: { key: MilestoneKey; label: string; date: string }[] = [
    { key: 'open', label: 'Bidding opens', date: ipo.openDate },
    { key: 'close', label: 'Bidding closes', date: ipo.closeDate },
    { key: 'allotment', label: 'Allotment', date: ipo.allotmentDate },
    { key: 'listing', label: 'Listing', date: ipo.listingDate },
  ];
  return steps.find((step) => diffDays(today, parseISO(step.date)) >= 0);
}

/** The context line shown on cards - what is happening with this issue right now. */
export function dateLine(ipo: IPO, today = startOfToday()): string {
  const phase = phaseOf(ipo, today);
  if (phase.key === 'upcoming') return `Bids open ${formatDay(ipo.openDate)} (${countdownLabel(ipo.openDate)})`;
  if (phase.key === 'open') return `Closes ${formatDay(ipo.closeDate)} (${countdownLabel(ipo.closeDate)})`;
  if (phase.key === 'allotment') {
    // past the allotment date the only event left is the listing
    if (diffDays(today, parseISO(ipo.allotmentDate)) < 0) {
      return `Lists ${formatDay(ipo.listingDate)} (${countdownLabel(ipo.listingDate)})`;
    }
    return `Allotment ${formatDay(ipo.allotmentDate)}`;
  }
  return `Listed ${formatDay(ipo.listingDate)}`;
}

/* -------------------------------------------------------------------- GMP */

export interface GmpSignal {
  dir: TrendDir;
  label: string;
  detail: string;
  pct: number | null;
  tone: 'up' | 'down' | 'warn' | 'neutral';
}

/**
 * Reads the current grey-market quote. There is no historical GMP feed available to
 * this app, so nothing here pretends to know whether the premium is rising: the signal
 * is derived only from the levels that were actually recorded by the source.
 */
export function gmpSignal(ipo: IPO): GmpSignal {
  if (ipo.gmp == null) {
    return {
      dir: 'flat',
      label: 'No quote',
      detail: 'No grey market quote has been recorded for this issue by the source tracker.',
      tone: 'neutral',
      pct: null,
    };
  }
  const pct = gmpPercent(ipo);

  // Band not announced yet - fall back to the rupee premium on its own.
  if (pct == null) {
    if (ipo.gmp > 0) {
      return {
        dir: 'up',
        label: `${formatRupees(ipo.gmp)} premium`,
        detail: `Quoted at ₹${ipo.gmp} over the issue price. The price band has not been announced yet, so a percentage cannot be calculated.`,
        tone: 'up',
        pct: null,
      };
    }
    return {
      dir: 'flat',
      label: 'Flat',
      detail: 'Trackers show no premium over the issue price while the price band is still awaited.',
      tone: 'neutral',
      pct: null,
    };
  }

  if (pct >= 25) {
    return {
      dir: 'up',
      label: 'Strong',
      detail: `Quoted ${formatPct(pct)} over the upper band - an indicative listing price near ${formatRupees(
        indicativeListing(ipo) ?? 0
      )}.`,
      tone: 'up',
      pct,
    };
  }
  if (pct >= 8) {
    return {
      dir: 'up',
      label: 'Positive',
      detail: `Quoted ${formatPct(pct)} over the upper band - an indicative listing price near ${formatRupees(
        indicativeListing(ipo) ?? 0
      )}.`,
      tone: 'up',
      pct,
    };
  }
  if (pct > 0) {
    return {
      dir: 'flat',
      label: 'Muted',
      detail: `Only ${formatPct(pct)} over the upper band, so the grey market is not pricing in much of a listing pop.`,
      tone: 'warn',
      pct,
    };
  }
  if (pct === 0) {
    return {
      dir: 'flat',
      label: 'Flat',
      detail: 'Shares are quoted at the issue price - the grey market sees no listing gain right now.',
      tone: 'neutral',
      pct,
    };
  }
  return {
    dir: 'down',
    label: 'Discount',
    detail: `Quoted ${formatPct(pct)} below the upper band - the grey market expects a weak debut.`,
    tone: 'down',
    pct,
  };
}

/* -------------------------------------------------------------- sentiment */

export interface Sentiment {
  score: number;
  label: string;
  reasons: string[];
}

/**
 * A derived 0-100 demand signal. Every input is a number a source actually published
 * (grey market premium, category-wise subscription) - the score is arithmetic on top of
 * that, not a prediction.
 */
export function sentiment(ipo: IPO): Sentiment {
  const s = ipo.subscription;
  const pct = gmpPercent(ipo);
  const reasons: string[] = [];
  let score = 50;

  if (ipo.gmp == null) {
    reasons.push('No grey market quote recorded yet');
  } else if (pct == null) {
    score += ipo.gmp > 0 ? 10 : 0;
    reasons.push(`Grey market premium of ${formatRupees(ipo.gmp)} (price band awaited)`);
  } else if (pct >= 40) {
    score += 30;
    reasons.push(`Grey market premium ${formatPct(pct)} - among the strongest on the board`);
  } else if (pct >= 25) {
    score += 24;
    reasons.push(`Grey market premium ${formatPct(pct)} of the upper band`);
  } else if (pct >= 12) {
    score += 16;
    reasons.push(`Grey market premium ${formatPct(pct)} of the upper band`);
  } else if (pct >= 5) {
    score += 8;
    reasons.push(`Modest grey market premium of ${formatPct(pct)}`);
  } else if (pct > 0) {
    score += 4;
    reasons.push(`Thin grey market premium of ${formatPct(pct)}`);
  } else if (pct === 0) {
    reasons.push('Grey market quote is flat at the issue price');
  } else {
    score -= 20;
    reasons.push(`Grey market discount of ${formatPct(pct)}`);
  }

  if (s?.total != null) {
    if (s.total >= 50) {
      score += 20;
      reasons.push(`Book subscribed ${s.total.toFixed(2)}x overall`);
    } else if (s.total >= 10) {
      score += 14;
      reasons.push(`Book subscribed ${s.total.toFixed(2)}x overall`);
    } else if (s.total >= 3) {
      score += 8;
      reasons.push(`Book subscribed ${s.total.toFixed(2)}x overall`);
    } else if (s.total >= 1) {
      score += 3;
      reasons.push(`Book covered ${s.total.toFixed(2)}x overall`);
    } else {
      score -= 12;
      reasons.push(`Book only ${s.total.toFixed(2)}x subscribed`);
    }
  }

  if (s?.retail != null) {
    if (s.retail >= 20) {
      score += 8;
      reasons.push(`Retail quota heavily oversubscribed at ${s.retail.toFixed(2)}x`);
    } else if (s.retail >= 5) {
      score += 4;
      reasons.push(`Retail quota ${s.retail.toFixed(2)}x subscribed`);
    } else if (s.retail < 0.5) {
      score -= 4;
      reasons.push(`Retail quota barely applied for (${s.retail.toFixed(2)}x)`);
    }
  }

  score = clamp(Math.round(score), 5, 97);

  let label = 'Balanced';
  if (score >= 78) label = 'Very strong';
  else if (score >= 64) label = 'Strong';
  else if (score >= 48) label = 'Balanced';
  else if (score >= 32) label = 'Soft';
  else label = 'Weak';

  return { score, label, reasons };
}

export function sentimentTone(score: number): 'up' | 'warn' | 'down' {
  if (score >= 64) return 'up';
  if (score >= 45) return 'warn';
  return 'down';
}

/* ------------------------------------------------------------ subscription */

export interface SubscriptionRow {
  key: 'qib' | 'nii' | 'retail' | 'total';
  label: string;
  value: number;
  display: string;
  tone: 'up' | 'warn' | 'info';
}

export function subscriptionRows(ipo: IPO): SubscriptionRow[] {
  const s: SubscriptionSplit | undefined = ipo.subscription;
  if (!s) return [];
  const rows: SubscriptionRow[] = [];
  const push = (
    key: SubscriptionRow['key'],
    label: string,
    value: number | undefined,
    tone: SubscriptionRow['tone']
  ) => {
    if (value == null) return;
    rows.push({ key, label, value, display: `${value.toFixed(2)}x`, tone });
  };
  push('qib', 'QIB', s.qib, 'info');
  push('nii', 'NII / HNI', s.nii, 'up');
  push('retail', ipo.segment === 'SME' ? 'Individual investors' : 'Retail', s.retail, 'up');
  push('total', 'Overall', s.total, 'warn');
  return rows;
}

/** Plain-language allotment expectation from the retail subscription multiple. */
export function allotmentOdds(ipo: IPO): string | null {
  const retail = ipo.subscription?.retail ?? ipo.subscription?.total;
  if (retail == null) return null;
  if (retail < 1) return 'All applications in this category should be allotted in full.';
  if (retail < 3) return 'Comfortable odds - most retail applications should get a full lot.';
  if (retail < 10) return 'Moderate odds - expect partial or single-lot allotments.';
  if (retail < 40) return 'Low odds - a lottery draw for a single lot.';
  return 'Very low odds - oversubscribed several times over, allotment is a lottery.';
}

/* ---------------------------------------------------------------- insights */

/** Short, plain-language takeaways built only from recorded numbers. */
export function insights(ipo: IPO): string[] {
  const out: string[] = [];
  const phase = phaseOf(ipo);
  const pct = gmpPercent(ipo);
  const listing = indicativeListing(ipo);

  if (ipo.gmp != null && pct != null && listing != null) {
    out.push(
      pct > 0
        ? `At the last recorded quote of ${formatPct(pct)}, the grey market implies a listing near ${formatRupees(
            listing
          )} against the upper band of ${formatRupees(ipo.priceBandHigh ?? 0)}.`
        : `The grey market quote of ${formatPct(pct)} implies a listing near ${formatRupees(
            listing
          )} - below the upper band of ${formatRupees(ipo.priceBandHigh ?? 0)}.`
    );
  } else if (ipo.gmp != null) {
    out.push(
      `Grey market premium of ${formatRupees(ipo.gmp)} a share. The price band has not been announced, so no percentage can be worked out.`
    );
  } else {
    out.push('No grey market quote has been recorded for this issue by the source tracker.');
  }

  if (phase.key === 'upcoming') {
    out.push(`Bidding opens ${formatDay(ipo.openDate, true)} (${countdownLabel(ipo.openDate)}).`);
  } else if (phase.key === 'open') {
    out.push(
      `Bidding is live and closes ${formatDay(ipo.closeDate, true)} (${countdownLabel(ipo.closeDate)}).`
    );
  } else if (phase.key === 'allotment') {
    out.push(
      `Bidding closed ${formatDay(ipo.closeDate, true)}. Allotment is due ${formatDay(
        ipo.allotmentDate,
        true
      )} and listing ${formatDay(ipo.listingDate, true)}.`
    );
  } else {
    out.push(`Listed on ${formatDay(ipo.listingDate, true)}. Grey market quotes stop mattering once trading starts.`);
  }

  const odds = allotmentOdds(ipo);
  if (odds) out.push(odds);

  const inv = lotInvestment(ipo);
  if (inv != null) {
    out.push(
      `One lot is ${ipo.lotSize} shares, about ${formatRupees(Math.round(inv))} at the upper band.`
    );
  }

  if (ipo.issueSizeCr != null) {
    out.push(
      `${formatCr(ipo.issueSizeCr)} issue on the ${ipo.platform} platform with ${
        ipo.exchanges.join('/')
      } listing.`
    );
  }

  const tentative = ipo.tentativeDates;
  if (tentative.length > 0) {
    out.push(
      `${tentative
        .map((k) => (k === 'open' ? 'opening' : k === 'close' ? 'closing' : k === 'allotment' ? 'allotment' : 'listing'))
        .join(', ')} ${tentative.length === 1 ? 'date is' : 'dates are'} provisional and can shift.`
    );
  }

  return out.slice(0, 4);
}

/* -------------------------------------------------------------- freshness */

export interface DataAge {
  /** days since the snapshot was compiled */
  days: number;
  stale: boolean;
  label: string;
}

/** How old the bundled snapshot is - surfaced in the UI instead of pretending it is live. */
export function dataAge(now = new Date()): DataAge {
  const asOf = new Date(DATA_AS_OF);
  const days = Math.max(0, Math.round((now.getTime() - asOf.getTime()) / 86400000));
  const stale = days >= 3;
  const label = days === 0 ? 'updated today' : days === 1 ? '1 day old' : `${days} days old`;
  return { days, stale, label };
}

export function gmpUpdatedLabel(ipo: IPO): string | null {
  if (!ipo.gmpUpdated) return null;
  return `GMP quote ${formatIstTime(ipo.gmpUpdated)} IST`;
}
