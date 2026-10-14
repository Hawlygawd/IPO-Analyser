import { DataSourceStatus, IPO, IPOStatus, IpoSource, SubscriptionSplit } from './types';

const IPO_ALERTS_HOME = 'https://ipoalerts.in/';
const IPO_GURU_HOME = 'https://www.ipoguru.in/ipo-gmp-details-developer-api';
const NSE_IPO_PAGE = 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
const BSE_IPO_PAGE = 'https://www.bseindia.com/publicissue';
export const SEBI_PUBLIC_ISSUES_URL = 'https://www.sebi.gov.in/filings/public-issues.html';
const LIVE_REQUEST_TIMEOUT_MS = 20_000;

export interface IpoFeed {
  ipos: IPO[];
  sources: DataSourceStatus[];
  fetchedAt: string;
  isFresh: boolean;
  completeness: 'complete' | 'limited';
  warnings: string[];
}

interface RawFeed {
  records?: {
    nse?: unknown[];
    bse?: unknown[];
    ipoAlerts?: unknown[];
    ipoGuru?: unknown[];
  };
  ipos?: unknown[];
  sources?: unknown[];
  fetchedAt?: string;
  generatedAt?: string;
  completeness?: 'complete' | 'limited';
  warnings?: unknown[];
}

function readApiUrl(): string | undefined {
  // Expo inlines this public URL at build time. It is an endpoint, not a secret.
  try {
    const value = process.env.EXPO_PUBLIC_IPO_API_URL?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function endpointUrl(): string | undefined {
  const explicit = readApiUrl();
  if (explicit) return explicit;
  // Web deployments use the same-origin Vercel function. Native builds must
  // explicitly point to the deployed server endpoint; provider keys stay server-side.
  if (typeof window !== 'undefined') return '/api/ipoFeed';
  return undefined;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`IPO feed endpoint returned HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new Error('IPO feed endpoint did not return JSON');
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Fetches only the first-party aggregator; no anonymous third-party fallback is assumed. */
export async function fetchLiveIpoFeed(signal?: AbortSignal): Promise<IpoFeed> {
  const endpoint = endpointUrl();
  if (!endpoint) {
    throw new Error('Live IPO endpoint is not configured. Deploy api/ipoFeed.js and set EXPO_PUBLIC_IPO_API_URL for native builds.');
  }
  const raw = (await getJson(endpoint, signal)) as RawFeed;
  const feed = normalizeRawFeed(raw);
  if (!feed.isFresh && feed.ipos.length === 0 && feed.sources.length === 0) {
    throw new Error('The configured IPO feed returned no source status or usable data. Check the server deployment.');
  }
  return feed;
}

export function normalizeRawFeed(raw: RawFeed): IpoFeed {
  const alertRows = Array.isArray(raw?.records?.ipoAlerts) ? raw.records.ipoAlerts : [];
  const guruRows = Array.isArray(raw?.records?.ipoGuru) ? raw.records.ipoGuru : [];
  const nseRows = Array.isArray(raw?.records?.nse) ? raw.records.nse : [];
  const bseRows = Array.isArray(raw?.records?.bse) ? raw.records.bse : [];
  const directRows = Array.isArray(raw?.ipos) ? raw.ipos : [];

  const fromAlerts = alertRows.map(normalizeIpoAlertsRecord).filter(isIPO);
  const fromGuru = guruRows.map(normalizeIpoGuruRecord).filter(isIPO);
  const fromBse = bseRows.map(normalizeBseRecord).filter(isIPO);
  const fromNse = nseRows.map(normalizeNseRecord).filter(isIPO);
  const direct = directRows.map(normalizeGenericRecord).filter(isIPO);
  // Aggregators enrich GMP/industry, while already-normalized custom rows are
  // merged before exchange rows so exchange-published issue facts win conflicts.
  const providerRecords = [...fromAlerts, ...fromGuru, ...direct, ...fromBse, ...fromNse];
  const conflictMap = findSourceConflicts(providerRecords);
  const sourceNamesByCompany = new Map<string, Set<string>>();
  for (const issue of providerRecords) {
    const key = companyKey(issue.name);
    const names = sourceNamesByCompany.get(key) ?? new Set<string>();
    names.add(issue.sources?.[0]?.name ?? issue.sourceName);
    sourceNamesByCompany.set(key, names);
  }
  const ipos = uniqueIpos(providerRecords).map((ipo) => {
    const key = companyKey(ipo.name);
    const conflicts = conflictMap.get(key);
    return {
      ...ipo,
      // An empty conflict list means at least two independent sources agreed;
      // undefined means there was not enough cross-source data to clear an older warning.
      sourceConflicts: conflicts ?? (sourceNamesByCompany.get(key)?.size && sourceNamesByCompany.get(key)!.size > 1 ? [] : undefined),
    };
  });
  const sources = (Array.isArray(raw?.sources) ? raw.sources : []).map(normalizeSourceStatus).filter(isSourceStatus);
  const anySourceResponded = sources.some((source) => source.status === 'ok' || source.status === 'limited');
  const providerWarnings = Array.isArray(raw?.warnings)
    ? raw.warnings.filter((item): item is string => typeof item === 'string')
    : [];
  if (anySourceResponded && ipos.length === 0) {
    providerWarnings.unshift('Sources responded, but no usable IPO rows were normalized. The app keeps its prior cache or fallback instead of treating an empty response as proof there are no IPOs.');
  }
  const conflictWarnings = [...conflictMap.values()].flat().slice(0, 6).map((item) => `Source disagreement: ${item}`);

  return {
    ipos,
    sources,
    fetchedAt: validTimestamp(raw?.fetchedAt ?? raw?.generatedAt) ?? new Date().toISOString(),
    isFresh: anySourceResponded,
    completeness: raw?.completeness === 'complete' ? 'complete' : 'limited',
    warnings: [...conflictWarnings, ...providerWarnings],
  };
}

function normalizeSourceStatus(value: unknown): DataSourceStatus | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const allowed = ['ok', 'limited', 'unconfigured', 'error'];
  const status = allowed.includes(String(item.status)) ? (item.status as DataSourceStatus['status']) : 'error';
  return {
    id: text(item.id) ?? 'unknown',
    name: text(item.name) ?? 'IPO source',
    status,
    recordCount: finiteNumber(item.recordCount) ?? 0,
    plan: text(item.plan),
    note: text(item.note),
    updatedAt: validTimestamp(text(item.updatedAt)) ?? undefined,
    url: text(item.url),
  };
}

function normalizeIpoAlertsRecord(value: unknown): IPO | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  if (!name) return null;
  const schedule = Array.isArray(raw.schedule) ? raw.schedule : [];
  const scheduled = (pattern: RegExp) => {
    const row = schedule.find((item) => {
      if (!item || typeof item !== 'object') return false;
      return pattern.test(String((item as Record<string, unknown>).event ?? ''));
    }) as Record<string, unknown> | undefined;
    return validDate(text(row?.date));
  };

  const openDate = validDate(text(raw.startDate)) ?? scheduled(/open date/i);
  const closeDate = validDate(text(raw.endDate)) ?? scheduled(/close date/i);
  if (!openDate || !closeDate) return null;

  const tentativeDates: string[] = [];
  let allotmentDate = validDate(text(raw.allotmentDate)) ?? scheduled(/allotment/i);
  let listingDate = validDate(text(raw.listingDate)) ?? scheduled(/listing date/i);
  if (!allotmentDate) {
    allotmentDate = addIsoDays(closeDate, 1);
    tentativeDates.push('allotment');
  }
  if (!listingDate) {
    listingDate = addIsoDays(closeDate, 6);
    tentativeDates.push('listing');
  }

  const band = parsePriceRange(text(raw.priceRange));
  const segment: IPO['segment'] = String(raw.type ?? '').toUpperCase().includes('SME') ? 'SME' : 'Mainboard';
  const status = parseStatus(raw.status);
  const subscription = normalizeSubscription(raw.subscription);
  const gmp = normalizeIpoAlertsGmp(raw.gmp);
  const sourceUpdatedAt =
    validTimestamp(text(raw.updatedAt ?? raw.updated_at ?? raw.lastUpdatedAt)) ?? validTimestamp(subscription?.asOf) ?? gmp?.updatedAt;
  const sources: IpoSource[] = [
    {
      name: 'IPOAlerts · NSE/BSE aggregate',
      url: validUrl(text(raw.nseInfoUrl)) ?? validUrl(text(raw.bseInfoUrl)) ?? validUrl(text(raw.infoUrl)) ?? IPO_ALERTS_HOME,
      updatedAt: sourceUpdatedAt,
    },
  ];
  const sourceUrl = validUrl(text(raw.prospectusUrl)) ?? sources[0].url ?? IPO_ALERTS_HOME;

  return {
    id: stableIpoId(name, text(raw.slug)),
    prospectusUrl: validUrl(text(raw.prospectusUrl ?? raw.prospectus_url)),
    symbol: text(raw.symbol),
    name,
    sector: text(raw.sector) ?? 'Sector not reported',
    segment,
    openDate,
    closeDate,
    allotmentDate,
    listingDate,
    tentativeDates,
    currentStatus: status ?? undefined,
    priceBandLow: band?.low,
    priceBandHigh: band?.high,
    lotSize: finiteNumber(raw.minQty),
    issueSizeCr: parseCrores(raw.issueSize),
    exchanges: normalizeExchanges(raw, segment),
    gmp: gmp?.value,
    subscription,
    about: text(raw.about) ?? `${name} IPO data received from a live public source.`,
    sourceName: sources[0].name,
    sourceUrl,
    sources,
    sourceUpdatedAt,
  };
}

function normalizeIpoGuruRecord(value: unknown): IPO | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.display_name ?? raw.name);
  if (!name) return null;

  const openDate = validDate(text(raw.open_date ?? raw.openDate));
  const closeDate = validDate(text(raw.close_date ?? raw.closeDate));
  if (!openDate || !closeDate) return null;
  const tentativeDates: string[] = [];
  let allotmentDate = validDate(text(raw.allotment_date ?? raw.allotmentDate));
  let listingDate = validDate(text(raw.listing_date ?? raw.listingDate));
  if (!allotmentDate) {
    allotmentDate = addIsoDays(closeDate, 1);
    tentativeDates.push('allotment');
  }
  if (!listingDate) {
    listingDate = addIsoDays(closeDate, 6);
    tentativeDates.push('listing');
  }

  const priceLow = finiteNumber(raw.price_min ?? raw.priceMin);
  const priceHigh = finiteNumber(raw.price_max ?? raw.priceMax);
  const band = parsePriceRange(text(raw.price_band ?? raw.priceBand));
  const subscription = normalizeIpoGuruSubscription(raw.subscription ?? raw.subscription_summary, raw.subscription_total);
  const gmp = normalizeIpoGuruGmp(raw.gmp);
  const sourceUpdatedAt =
    validTimestamp(text(raw.updated_at ?? raw.updatedAt)) ?? validTimestamp(subscription?.asOf) ?? gmp?.updatedAt;
  const segment: IPO['segment'] = String(raw.type ?? raw.sub_type ?? '').toUpperCase().includes('SME')
    ? 'SME'
    : 'Mainboard';
  const sourceUrl = validUrl(text(raw.web_url ?? raw.prospectus_url ?? raw.prospectusUrl)) ?? IPO_GURU_HOME;
  const source: IpoSource = { name: 'IPO Guru', url: sourceUrl, updatedAt: sourceUpdatedAt };

  return {
    id: stableIpoId(name, text(raw.slug ?? raw.symbol)),
    prospectusUrl: validUrl(text(raw.prospectus_url ?? raw.prospectusUrl)),
    symbol: text(raw.symbol ?? raw.nse_symbol),
    name,
    sector: text(raw.sector) ?? 'Sector not reported',
    segment,
    openDate,
    closeDate,
    allotmentDate,
    listingDate,
    tentativeDates,
    currentStatus: raw.is_listed === true ? 'listed' : parseStatus(raw.status) ?? undefined,
    priceBandLow: priceLow ?? band?.low,
    priceBandHigh: priceHigh ?? band?.high ?? finiteNumber(raw.issue_price),
    lotSize: finiteNumber(raw.lot_size ?? raw.lotSize),
    issueSizeCr: parseCrores(raw.issue_size ?? raw.issueSize),
    issueType: text(raw.sale_type ?? raw.type_of_issue ?? raw.typeOfIssue),
    exchanges: normalizeExchanges(raw, segment),
    gmp: gmp?.value,
    subscription,
    about: text(raw.about ?? raw.description) ?? `${name} IPO data received from IPO Guru.`,
    sourceName: source.name,
    sourceUrl,
    sources: [source],
    sourceUpdatedAt,
  };
}

function normalizeNseRecord(value: unknown): IPO | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.companyName ?? raw.company ?? raw.name);
  if (!name) return null;
  const openDate = normalizeExchangeDate(text(raw.issueStartDate ?? raw.ipoStartDate ?? raw.openDate));
  const closeDate = normalizeExchangeDate(text(raw.issueEndDate ?? raw.ipoEndDate ?? raw.closeDate));
  if (!openDate || !closeDate) return null;

  const tentativeDates: string[] = [];
  let allotmentDate = normalizeExchangeDate(text(raw.allotmentDate ?? raw.allotment_date));
  let listingDate = normalizeExchangeDate(text(raw.listingDate ?? raw.listing_date));
  if (!allotmentDate) {
    allotmentDate = addIsoDays(closeDate, 1);
    tentativeDates.push('allotment');
  }
  if (!listingDate) {
    listingDate = addIsoDays(closeDate, 6);
    tentativeDates.push('listing');
  }

  const segment: IPO['segment'] = String(raw.series ?? raw.securityType ?? raw.type ?? '').toUpperCase().includes('SME') ? 'SME' : 'Mainboard';
  const sourceUpdatedAt = validTimestamp(text(raw.updatedAt ?? raw.updated_at ?? raw.feedCheckedAt));
  const sourceUrl = validUrl(text(raw.infoUrl ?? raw.info_url)) ??
    (text(raw.symbol) ? `https://www.nseindia.com/market-data/issue-information?symbol=${encodeURIComponent(String(raw.symbol))}&series=${encodeURIComponent(String(raw.series ?? 'EQ'))}&type=Active` : NSE_IPO_PAGE);
  const subscription = normalizeExchangeSubscription(raw.subscription, raw.noOfTime ?? raw.totalSubscription);
  const gmp = normalizeIpoAlertsGmp(raw.gmp);
  const status = parseStatus(raw.status) ?? inferStatus(openDate, closeDate, normalizeExchangeDate(text(raw.listingDate ?? raw.listing_date)));
  const exchanges = ['NSE'];
  if (isTruthyFlag(raw.isBse ?? raw.is_bse)) exchanges.push(segment === 'SME' ? 'BSE SME' : 'BSE');

  const source: IpoSource = { name: 'NSE India · official exchange feed', url: sourceUrl, updatedAt: sourceUpdatedAt };
  return {
    id: stableIpoId(name, text(raw.slug ?? raw.symbol)),
    symbol: text(raw.symbol),
    name,
    sector: text(raw.sector ?? raw.industry) ?? 'Sector not reported',
    segment,
    openDate,
    closeDate,
    allotmentDate,
    listingDate,
    tentativeDates,
    currentStatus: status,
    priceBandLow: parsePriceRange(text(raw.priceRange ?? raw.priceBand))?.low ?? finiteNumber(raw.minimumPrice),
    priceBandHigh: parsePriceRange(text(raw.priceRange ?? raw.priceBand))?.high ?? finiteNumber(raw.maximumPrice),
    lotSize: finiteNumber(raw.lotSize ?? raw.lot_size),
    issueSizeCr: parseCrores(raw.issueSize ?? raw.issue_size),
    issueType: text(raw.issueType ?? raw.issue_type) ?? 'IPO',
    exchanges,
    gmp: gmp?.value,
    subscription,
    about: text(raw.about ?? raw.description) ?? `${name} issue information reported on the NSE public exchange page.`,
    sourceName: source.name,
    sourceUrl,
    sources: [source],
    sourceUpdatedAt,
  };
}

function normalizeBseRecord(value: unknown): IPO | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.LONG_NAME ?? raw.Scrip_Name ?? raw.name);
  if (!name) return null;
  const openDate = normalizeExchangeDate(text(raw.Start_Dt ?? raw.issueStartDate ?? raw.openDate));
  const closeDate = normalizeExchangeDate(text(raw.End_Dt ?? raw.issueEndDate ?? raw.closeDate));
  if (!openDate || !closeDate) return null;

  const tentativeDates: string[] = [];
  let allotmentDate = normalizeExchangeDate(text(raw.Allotment_Dt ?? raw.allotmentDate));
  let listingDate = normalizeExchangeDate(text(raw.Listing_Dt ?? raw.listingDate));
  if (!allotmentDate) {
    allotmentDate = addIsoDays(closeDate, 1);
    tentativeDates.push('allotment');
  }
  if (!listingDate) {
    listingDate = addIsoDays(closeDate, 6);
    tentativeDates.push('listing');
  }

  const segment: IPO['segment'] = String(raw.eXCHANGE_PLATFORM ?? raw.platform ?? '').toUpperCase().includes('SME') ? 'SME' : 'Mainboard';
  const sourceUpdatedAt = validTimestamp(text(raw.updatedAt ?? raw.Maxdt ?? raw.feedCheckedAt));
  const sourceUrl = validUrl(text(raw.infoUrl ?? raw.bseInfoUrl)) ?? BSE_IPO_PAGE;
  const priceBand = parsePriceRange(text(raw.Price_Band ?? raw.priceBand));
  const subscription = normalizeExchangeSubscription(raw.subscription, raw.noOfTime ?? raw.totalSubscription);
  const rawStatus = raw.Status ?? raw.status;
  if (['w', 'withdrawn'].includes(String(rawStatus ?? '').trim().toLowerCase())) return null;
  const status = normalizeBseStatus(rawStatus) ?? inferStatus(openDate, closeDate, normalizeExchangeDate(text(raw.Listing_Dt ?? raw.listingDate)));
  const exchanges = [segment === 'SME' ? 'BSE SME' : 'BSE'];
  if (isTruthyFlag(raw.isNse ?? raw.is_nse) || text(raw.NSE_symbol ?? raw.nseSymbol)) exchanges.push(segment === 'SME' ? 'NSE SME' : 'NSE');
  const source: IpoSource = { name: 'BSE India · official exchange feed', url: sourceUrl, updatedAt: sourceUpdatedAt };

  return {
    id: stableIpoId(name, text(raw.IPO_NO ?? raw.Scrip_cd ?? raw.slug)),
    symbol: text(raw.symbol ?? raw.Scrip_Name ?? raw.short_name),
    name,
    sector: text(raw.sector ?? raw.industry) ?? 'Sector not reported',
    segment,
    openDate,
    closeDate,
    allotmentDate,
    listingDate,
    tentativeDates,
    currentStatus: status,
    priceBandLow: priceBand?.low,
    priceBandHigh: priceBand?.high,
    lotSize: finiteNumber(raw.Lot_Size ?? raw.lotSize ?? raw.Market_Lot),
    issueSizeCr: parseCrores(raw.issueSize ?? raw.issue_size),
    issueType: text(raw.IR_FLAG_FULL ?? raw.IR_flag ?? raw.issueType) ?? 'IPO',
    exchanges,
    subscription,
    about: text(raw.about ?? raw.description) ?? `${name} issue information reported on the BSE public-issues page.`,
    sourceName: source.name,
    sourceUrl,
    sources: [source],
    sourceUpdatedAt,
  };
}

function normalizeExchangeSubscription(value: unknown, totalValue?: unknown): SubscriptionSplit | undefined {
  const categories = normalizeSubscription(value);
  const overall = normalizeSubscription({ total: totalValue });
  if (!categories && !overall) return undefined;
  return { ...(overall ?? {}), ...(categories ?? {}) };
}

function normalizeBseStatus(value: unknown): IPOStatus | undefined {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'l' || status === 'o' || status === 'live') return 'open';
  if (status === 'f' || status === 'future' || status === 'forthcoming') return 'upcoming';
  if (status === 'c' || status === 'closed') return 'closed';
  if (status === 'w' || status === 'withdrawn') return undefined;
  return parseStatus(value);
}

function inferStatus(openDate: string, closeDate: string, listingDate?: string): IPOStatus {
  const today = indiaDateKey();
  if (listingDate && listingDate <= today) return 'listed';
  if (today > closeDate) return 'closed';
  if (today >= openDate) return 'open';
  return 'upcoming';
}

function indiaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || ['1', 'true', 'yes', 'y'].includes(String(value ?? '').toLowerCase());
}

function normalizeExchangeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const direct = validDate(value);
  if (direct) return direct;
  const yearFirst = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (yearFirst) return validDate(`${yearFirst[1]}-${String(Number(yearFirst[2])).padStart(2, '0')}-${String(Number(yearFirst[3])).padStart(2, '0')}`);
  const match = value.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](\d{4})/);
  if (!match) return undefined;
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : months[match[2].slice(0, 3).toLowerCase()];
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
  return validDate(date);
}

function normalizeGenericRecord(value: unknown): IPO | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  // The app's API endpoint normally returns provider rows. This path allows a
  // self-hosted endpoint to return already-normalized IPO objects as well.
  if (typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.openDate === 'string') {
    const ipo = raw as unknown as IPO;
    if (!validDate(ipo.openDate) || !validDate(ipo.closeDate) || !validDate(ipo.listingDate)) return null;
    return {
      ...ipo,
      prospectusUrl: validUrl(text(ipo.prospectusUrl)),
      tentativeDates: Array.isArray(ipo.tentativeDates) ? ipo.tentativeDates : [],
      sourceName: text(ipo.sourceName) ?? 'Live IPO feed',
      sourceUrl: validUrl(text(ipo.sourceUrl)) ?? IPO_ALERTS_HOME,
      sources: Array.isArray(ipo.sources) ? ipo.sources : [],
    };
  }
  return null;
}

function normalizeSubscription(value: unknown): SubscriptionSplit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const split: SubscriptionSplit = {
    qib: numberField(raw, ['qib', 'qibX', 'qib_x', 'qib_subscription_x']),
    nii: numberField(raw, ['nii', 'niiX', 'nii_x', 'nii_subscription_x', 'hni']),
    sNii: numberField(raw, ['sNii', 'snii', 'sNiiX', 'sniiX', 's_nii', 'sNiiX']),
    bNii: numberField(raw, ['bNii', 'bnii', 'bNiiX', 'bniiX', 'b_nii', 'bNiiX']),
    retail: numberField(raw, ['retail', 'retailX', 'retail_x', 'retail_subscription_x', 'rii']),
    employee: numberField(raw, ['employee', 'employeeX', 'employees', 'employee_x']),
    shareholder: numberField(raw, ['shareholder', 'shareholderX', 'shareholders', 'shareholder_x']),
    total: numberField(raw, ['total', 'totalX', 'total_x', 'timesSubscribed', 'times_subscribed', 'overall']),
    asOf: text(raw.asOf ?? raw.updatedAt ?? raw.updated_at ?? raw.subscriptionAsOn),
  };
  return Object.values(split).some((item) => item !== undefined) ? split : undefined;
}

function normalizeIpoGuruSubscription(value: unknown, overallValue?: unknown): SubscriptionSplit | undefined {
  if (!value || typeof value !== 'object') {
    return normalizeSubscription({ total: overallValue });
  }
  const root = value as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const summary = data.summary && typeof data.summary === 'object' ? (data.summary as Record<string, unknown>) : data;
  const normalized = normalizeSubscription({
    ...summary,
    total: summary.total ?? overallValue,
    asOf: summary.updated_at_label ?? summary.updated_at ?? summary.asOf,
  });
  const result: SubscriptionSplit = { ...(normalized ?? {}) };
  const categories = Array.isArray(data.categories) ? data.categories : [];

  const assignCategory = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    const key = String(row.key ?? row.label ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const amount = finiteNumber(row.times_value) ?? finiteNumber(row.times);
    if (amount == null) return;
    if (key === 'qib' || key.includes('qualifiedinstitutional')) result.qib = amount;
    else if (key.includes('snii') || key.includes('shni') || key.includes('smallhni')) result.sNii = amount;
    else if (key.includes('bnii') || key.includes('bhni') || key.includes('bighni')) result.bNii = amount;
    else if (key === 'nii' || key.includes('noninstitutional') || key === 'hni') result.nii = amount;
    else if (key.includes('retail') || key === 'rii') result.retail = amount;
    else if (key.includes('employee')) result.employee = amount;
    else if (key.includes('shareholder')) result.shareholder = amount;
    else if (key === 'total') result.total = amount;
  };

  for (const category of categories) {
    assignCategory(category);
    if (category && typeof category === 'object') {
      const subCategories = (category as Record<string, unknown>).sub_categories;
      if (Array.isArray(subCategories)) subCategories.forEach(assignCategory);
    }
  }
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

function normalizeIpoAlertsGmp(value: unknown): { value?: number; updatedAt?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const aggregations = (raw.aggregations ?? {}) as Record<string, unknown>;
  const sourceValues = Array.isArray(raw.sources)
    ? raw.sources
        .map((source) => (source && typeof source === 'object' ? finiteNumber((source as Record<string, unknown>).gmpPrice) : undefined))
        .filter((item): item is number => item != null)
    : [];
  const selected =
    finiteNumber(aggregations.median) ??
    finiteNumber(aggregations.mode) ??
    finiteNumber(aggregations.mean) ??
    (sourceValues.length ? median(sourceValues) : undefined);
  const updatedAt = validTimestamp(text(raw.lastUpdatedAt ?? raw.updatedAt));
  return {
    value: selected === 0 && !updatedAt && sourceValues.length === 0 ? undefined : selected,
    updatedAt,
  };
}

function normalizeIpoGuruGmp(value: unknown): { value?: number; updatedAt?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const updatedAt = validTimestamp(text(raw.updated_at ?? raw.updatedAt ?? raw.updated_at_label)) ?? undefined;
  const amount = numberField(raw, ['price_value', 'price', 'gmp', 'value']);
  // IPO Guru v2 uses null for unknown and zero for a genuine nil GMP reading.
  return { value: amount, updatedAt };
}

function numberField(raw: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) {
    const n = finiteNumber(raw[name]);
    if (n != null) return n;
  }
  return undefined;
}

function normalizeExchanges(raw: Record<string, unknown>, segment: IPO['segment']): string[] {
  const output = new Set<string>();
  const listingOn = text(raw.listing_on ?? raw.listingOn ?? raw.exchange ?? raw.source)?.toUpperCase() ?? '';
  const nseUrl = text(raw.nseInfoUrl ?? raw.nse_info_url);
  const bseUrl = text(raw.bseInfoUrl ?? raw.bse_info_url);
  if (/NSE|NATIONAL STOCK EXCHANGE/.test(listingOn) || nseUrl) output.add(segment === 'SME' ? 'NSE SME' : 'NSE');
  if (/BSE|BOMBAY STOCK EXCHANGE/.test(listingOn) || bseUrl) output.add(segment === 'SME' ? 'BSE SME' : 'BSE');
  if (!output.size) output.add('Not reported');
  return [...output];
}

function parseStatus(value: unknown): IPOStatus | undefined {
  const status = String(value ?? '').toLowerCase();
  if (
    status.includes('not listed') ||
    status.includes('not yet listed') ||
    status.includes('unlisted') ||
    status.includes('awaiting listing')
  ) return undefined;
  if (status.includes('announ')) return 'announced';
  if (status.includes('upcoming') || status === 'u') return 'upcoming';
  if (status.includes('open') || status === 'active') return 'open';
  if (status.includes('list')) return 'listed';
  if (status.includes('clos')) return 'closed';
  return undefined;
}

function parsePriceRange(value?: string): { low?: number; high?: number } | undefined {
  if (!value) return undefined;
  const numbers = value.match(/\d[\d,]*(?:\.\d+)?/g)?.map((item) => Number(item.replace(/,/g, ''))).filter(Number.isFinite);
  if (!numbers?.length) return undefined;
  if (numbers.length === 1) return { low: numbers[0], high: numbers[0] };
  return { low: Math.min(numbers[0], numbers[1]), high: Math.max(numbers[0], numbers[1]) };
}

function parseCrores(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const numeric = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!numeric) return undefined;
  const amount = Number(numeric[0]);
  if (!Number.isFinite(amount)) return undefined;
  if (/\b(lakh|lac|l)\b/i.test(raw) && !/\bcr(?:ore)?s?\b/i.test(raw)) return amount / 100;
  return amount;
}

function stableIpoId(name: string, providerSlug?: string): string {
  const nameKey = companyKey(name);
  if (nameKey) return nameKey;
  const slug = providerSlug?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'ipo-unknown';
}

function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(initial public offering|ipo|limited|ltd|incorporated|inc|corporation|corp|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueIpos(ipos: IPO[]): IPO[] {
  const result: IPO[] = [];
  for (const ipo of ipos) {
    const index = result.findIndex((item) => companyKey(item.name) === companyKey(ipo.name) || item.id === ipo.id);
    if (index < 0) result.push(ipo);
    else result[index] = mergeIpo(result[index], ipo);
  }
  return result;
}

function findSourceConflicts(records: IPO[]): Map<string, string[]> {
  const groups = new Map<string, IPO[]>();
  for (const ipo of records) {
    const key = companyKey(ipo.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), ipo]);
  }

  const conflicts = new Map<string, string[]>();
  const fields = [
    ['openDate', 'opening date', undefined],
    ['closeDate', 'closing date', undefined],
    ['allotmentDate', 'allotment date', 'allotment'],
    ['listingDate', 'listing date', 'listing'],
    ['priceBandLow', 'lower price band', undefined],
    ['priceBandHigh', 'upper price band', undefined],
  ] as const;
  for (const [company, issues] of groups) {
    if (issues.length < 2) continue;
    const messages: string[] = [];
    for (const [field, label, tentativeKey] of fields) {
      const values = new Map<string, Set<string>>();
      for (const issue of issues) {
        if (tentativeKey && issue.tentativeDates?.includes(tentativeKey)) continue;
        const value = issue[field];
        if (value == null) continue;
        const normalized = typeof value === 'number' ? value.toFixed(2) : String(value);
        const source = issue.sources?.[0]?.name ?? issue.sourceName;
        const names = values.get(normalized) ?? new Set<string>();
        names.add(source);
        values.set(normalized, names);
      }
      if (values.size > 1) {
        const descriptions = [...values.entries()].map(([value, names]) => `${[...names].join('/')} reports ${value}`);
        messages.push(`${label} differs: ${descriptions.join(' vs ')}`);
      }
    }
    if (messages.length) conflicts.set(company, messages.map((message) => `${issues[0].name}: ${message}`));
  }
  return conflicts;
}

/** Merge a newer provider value into a saved/cached record without erasing data
 * that a provider does not return (e.g. IPOAlerts has overall subscription only). */
function hasInformativeAbout(value?: string): boolean {
  return Boolean(value && !/(?:data received from a live public source|IPO data received from IPO Guru|issue information reported on the (?:NSE public exchange|BSE public-issues) page)\.$/i.test(value));
}

export function mergeIpo(previous: IPO, incoming: IPO): IPO {
  const sources = mergeSources(previous.sources ?? [], incoming.sources ?? []);
  const subscription = mergeDefined(previous.subscription, incoming.subscription);
  const timeline = mergeTimelineDates(previous, incoming);
  const exchanges = [...new Set([...(previous.exchanges ?? []), ...(incoming.exchanges ?? [])])].filter(
    (exchange) => exchange !== 'Not reported'
  );
  const segment: IPO['segment'] = previous.segment === 'SME' || incoming.segment === 'SME' ? 'SME' : incoming.segment ?? previous.segment;
  const merged: IPO = {
    ...previous,
    ...incoming,
    ...timeline,
    id: previous.id,
    prospectusUrl: incoming.prospectusUrl ?? previous.prospectusUrl,
    segment,
    symbol: incoming.symbol ?? previous.symbol,
    currentStatus: incoming.currentStatus ?? previous.currentStatus,
    sector: incoming.sector && incoming.sector !== 'Sector not reported' ? incoming.sector : previous.sector,
    priceBandLow: incoming.priceBandLow ?? previous.priceBandLow,
    priceBandHigh: incoming.priceBandHigh ?? previous.priceBandHigh,
    lotSize: incoming.lotSize ?? previous.lotSize,
    issueSizeCr: incoming.issueSizeCr ?? previous.issueSizeCr,
    issueType: incoming.issueType ?? previous.issueType,
    exchanges,
    gmp: incoming.gmp ?? previous.gmp,
    gmpHistory: incoming.gmpHistory?.length ? incoming.gmpHistory : previous.gmpHistory,
    subscription,
    about: hasInformativeAbout(incoming.about) ? incoming.about : previous.about,
    sourceName: sources.length ? sources.map((source) => source.name).join(' · ') : incoming.sourceName || previous.sourceName,
    sourceUrl: incoming.sourceUrl || previous.sourceUrl,
    sources,
    sourceConflicts: incoming.sourceConflicts ?? previous.sourceConflicts,
    sourceUpdatedAt: newerTimestamp(incoming.sourceUpdatedAt, previous.sourceUpdatedAt),
  };
  return merged;
}

function mergeTimelineDates(previous: IPO, incoming: IPO): Pick<IPO, 'openDate' | 'closeDate' | 'allotmentDate' | 'listingDate' | 'tentativeDates'> {
  const fields = [
    ['openDate', 'open'],
    ['closeDate', 'close'],
    ['allotmentDate', 'allotment'],
    ['listingDate', 'listing'],
  ] as const;
  const dates: Partial<Pick<IPO, 'openDate' | 'closeDate' | 'allotmentDate' | 'listingDate'>> = {};
  const tentativeDates: string[] = [];
  const previousTentative = previous.tentativeDates ?? [];
  const incomingTentative = incoming.tentativeDates ?? [];

  for (const [field, key] of fields) {
    const keepPreviousConfirmed =
      Boolean(incomingTentative.includes(key)) &&
      !previousTentative.includes(key) &&
      Boolean(previous.sources?.length);
    const tentative = keepPreviousConfirmed ? previousTentative.includes(key) : incomingTentative.includes(key);
    dates[field] = keepPreviousConfirmed ? previous[field] : incoming[field] || previous[field];
    if (tentative) tentativeDates.push(key);
  }
  return { ...dates, tentativeDates } as Pick<IPO, 'openDate' | 'closeDate' | 'allotmentDate' | 'listingDate' | 'tentativeDates'>;
}

/** Merge live results into a cache/seed list while preserving stable local IDs. */
export function mergeIpoCatalog(existing: IPO[], incoming: IPO[]): IPO[] {
  const next = [...existing];
  for (const ipo of incoming) {
    const index = next.findIndex((item) => item.id === ipo.id || companyKey(item.name) === companyKey(ipo.name));
    if (index === -1) next.push(ipo);
    else next[index] = mergeIpo(next[index], ipo);
  }
  return next;
}

function mergeSources(previous: IpoSource[], incoming: IpoSource[]): IpoSource[] {
  const output = new Map<string, IpoSource>();
  for (const source of [...previous, ...incoming]) {
    const key = source.name.toLowerCase();
    const old = output.get(key);
    output.set(
      key,
      old
        ? {
            ...old,
            ...source,
            url: source.url ?? old.url,
            updatedAt: newerTimestamp(source.updatedAt, old.updatedAt),
          }
        : source
    );
  }
  return [...output.values()];
}

function mergeDefined(
  previous?: SubscriptionSplit,
  incoming?: SubscriptionSplit
): SubscriptionSplit | undefined {
  if (!previous && !incoming) return undefined;
  const merged: SubscriptionSplit = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(incoming ?? {}) as [keyof SubscriptionSplit, SubscriptionSplit[keyof SubscriptionSplit]][]) {
    if (value !== undefined) merged[key] = value as never;
  }
  return merged;
}

function newerTimestamp(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/,/g, '').replace(/[₹x%\s]/gi, '');
  if (!clean || !/^-?\d+(?:\.\d+)?$/.test(clean)) return undefined;
  const number = Number(clean);
  return Number.isFinite(number) ? number : undefined;
}

function validDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function validTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const match = value.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*(IST)?$/i);
    if (!match) return undefined;
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[match[2].slice(0, 3).toLowerCase()];
    if (month == null) return undefined;
    let hour = Number(match[4]) % 12;
    if (match[6].toUpperCase() === 'PM') hour += 12;
    // IPO Guru timestamps without a numeric offset are specified in IST.
    const istOffsetMinutes = match[7] ? 330 : 0;
    date = new Date(Date.UTC(Number(match[3]), month, Number(match[1]), hour, Number(match[5])) - istOffsetMinutes * 60_000);
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function validUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIPO(value: IPO | null): value is IPO {
  return value !== null;
}

function isSourceStatus(value: DataSourceStatus | null): value is DataSourceStatus {
  return value !== null;
}
