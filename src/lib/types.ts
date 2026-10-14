export type Segment = 'Mainboard' | 'SME';

/**
 * `awaiting` = the issue's indicative opening date has passed but the board never confirmed it,
 * so we can't tell whether it opened, closed or listed.
 */
export type IpoPhase = 'upcoming' | 'awaiting' | 'open' | 'allotment' | 'listed';

/** Keys used in `IPO.tentativeDates`. */
export type DateKey = 'open' | 'close' | 'allotment' | 'listing';

export interface SubscriptionSplit {
  qib?: number;
  nii?: number;
  retail?: number;
  total?: number;
  asOf?: string;
}

export interface IPO {
  id: string;
  name: string;
  sector: string;
  segment: Segment;
  /** ISO date (YYYY-MM-DD) */
  openDate: string;
  closeDate: string;
  allotmentDate: string;
  listingDate: string;
  /** dates that are provisional / not yet confirmed by the exchange (as of the board snapshot) */
  tentativeDates: DateKey[];
  priceBandLow?: number;
  priceBandHigh?: number;
  lotSize?: number;
  issueSizeCr?: number;
  issueType?: string;
  exchanges: string[];
  /** grey market premium in ₹ over the upper price band */
  gmp?: number;
  subscription?: SubscriptionSplit;
  about: string;
  sourceName: string;
  sourceUrl: string;
}

export interface AlertLogItem {
  id: string;
  ipoId: string;
  ipoName: string;
  title: string;
  body: string;
  at: number;
  kind: 'watch' | 'unwatch' | 'scheduled' | 'system';
}

export interface NotifPrefs {
  openDay: boolean;
  lastDay: boolean;
  allotment: boolean;
  listing: boolean;
}
