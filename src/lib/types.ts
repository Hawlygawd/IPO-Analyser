export type Segment = 'Mainboard' | 'SME';

export type IpoPhase = 'upcoming' | 'open' | 'allotment' | 'listed';
export type IPOStatus = 'announced' | 'upcoming' | 'open' | 'closed' | 'listed';

export interface SubscriptionSplit {
  qib?: number;
  /** Non-institutional investor total (NII / HNI). */
  nii?: number;
  /** Small HNI allocation, when the source provides it separately. */
  sNii?: number;
  /** Big HNI allocation, when the source provides it separately. */
  bNii?: number;
  retail?: number;
  employee?: number;
  shareholder?: number;
  total?: number;
  asOf?: string;
}

export interface IpoSource {
  name: string;
  url?: string;
  /** ISO timestamp supplied by the source, when available. */
  updatedAt?: string;
}

export interface IPO {
  /** Stable, local ID; does not change when a provider's record ID changes. */
  id: string;
  /** Provider ticker/symbol, if available. */
  symbol?: string;
  name: string;
  sector: string;
  segment: Segment;
  /** ISO date (YYYY-MM-DD) */
  openDate: string;
  closeDate: string;
  allotmentDate: string;
  listingDate: string;
  /** dates that are provisional / not yet confirmed by the exchange */
  tentativeDates: string[];
  /** Last lifecycle status reported by a live source. */
  currentStatus?: IPOStatus;
  priceBandLow?: number;
  priceBandHigh?: number;
  lotSize?: number;
  issueSizeCr?: number;
  issueType?: string;
  exchanges: string[];
  /** Grey market premium in ₹ over the upper price band. */
  gmp?: number;
  /** Only verified source observations; never generated or interpolated. */
  gmpHistory?: number[];
  subscription?: SubscriptionSplit;
  about: string;
  /** Backward-compatible display fields for older saved IPO records. */
  sourceName: string;
  sourceUrl: string;
  /** Providers contributing data for this IPO. */
  sources?: IpoSource[];
  /** ISO timestamp for the latest field update received from a provider. */
  sourceUpdatedAt?: string;
}

export interface DataSourceStatus {
  id: string;
  name: string;
  status: 'ok' | 'limited' | 'unconfigured' | 'error';
  recordCount: number;
  plan?: string;
  note?: string;
  updatedAt?: string;
  url?: string;
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
