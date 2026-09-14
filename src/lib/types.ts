export type Segment = 'Mainboard' | 'SME';

/** Exchange platform the issue is bidding on. */
export type Platform = 'NSE' | 'BSE' | 'NSE SME' | 'BSE SME';

export type MilestoneKey = 'open' | 'close' | 'allotment' | 'listing';

export type IpoPhase = 'upcoming' | 'open' | 'allotment' | 'listed';

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
  /** Broad industry label - omitted when it is not confirmed by a source. */
  sector?: string;
  segment: Segment;
  platform: Platform;
  /** ISO date (YYYY-MM-DD) */
  openDate: string;
  closeDate: string;
  allotmentDate: string;
  listingDate: string;
  /** dates that are provisional / not yet confirmed by the exchange */
  tentativeDates: MilestoneKey[];
  priceBandLow?: number;
  priceBandHigh?: number;
  lotSize?: number;
  issueSizeCr?: number;
  issueType?: string;
  exchanges: string[];
  /** grey market premium in ₹ over the upper price band */
  gmp?: number;
  /** ISO timestamp of the last recorded GMP quote */
  gmpUpdated?: string;
  subscription?: SubscriptionSplit;
  about: string;
  sourceName: string;
  sourceUrl: string;
}

export type AlertKind = 'watch' | 'unwatch' | 'scheduled' | 'system';

export interface AlertLogItem {
  id: string;
  ipoId: string;
  ipoName: string;
  title: string;
  body: string;
  at: number;
  kind: AlertKind;
}

export interface NotifPrefs {
  openDay: boolean;
  lastDay: boolean;
  allotment: boolean;
  listing: boolean;
}
