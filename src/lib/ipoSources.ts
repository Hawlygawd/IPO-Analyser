import { DataSourceStatus, IPO, IPOStatus, IpoSource, SubscriptionSplit } from './types';

const IPO_ALERTS_URL = 'https://api.ipoalerts.in/ipos';
const IPO_ALERTS_HOME = 'https://ipoalerts.in/';
const IPO_GURU_HOME = 'https://www.ipoguru.in/ipo-gmp-details-developer-api';
const LIVE_REQUEST_TIMEOUT_MS = 12_000;
const PUBLIC_STATUSES = ['open', 'upcoming', 'closed', 'listed'] as const;

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
  // The Vercel function is same-origin in the deployed web build. In Expo Go /
  // local preview this path may not exist; fetchLiveIpoFeed then falls back to
  // the public, deliberately limited IPOAlerts preview endpoint.
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
    if (!response.ok) throw new Error(`IPO source returned HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new Error('IPO feed endpoint did not return JSON');
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Loads the first-party Vercel aggregator (if deployed) or, for a local/mobile
 * build without a configured proxy, the public IPOAlerts preview. API keys are
 * only ever sent by the serverless function; no credentials are bundled here.
 */
export async function fetchLiveIpoFeed(signal?: AbortSignal): Promise<IpoFeed> {
  const endpoint = endpointUrl();
  let endpointError: unknown;

  if (endpoint) {
    try {
      const raw = (await getJson(endpoint, signal)) as RawFeed;
      const feed = normalizeRawFeed(raw);
      // An HTML fallback page or empty response is not a successful live sync.
      if (feed.isFresh || feed.ipos.length > 0) return feed;
      endpointError = new Error('The configured IPO feed returned no usable data.');
    } catch (error) {
      endpointError = error;
    }
  }

  const publicFeed = await fetchPublicPreview(signal);
  if (publicFeed.isFresh || publicFeed.ipos.length > 0) {
    if (endpointError) {
      publicFeed.warnings.unshift('Using limited public preview because the configured feed is unavailable.');
    }
    return publicFeed;
  }

  if (endpointError) throw endpointError;
  throw new Error('No IPO data source could be reached. Check your internet connection and try again.');
}

async function fetchPublicPreview(signal?: AbortSignal): Promise<IpoFeed> {
  const results = await Promise.allSettled(
    PUBLIC_STATUSES.map(async (status) => {
      const query = new URLSearchParams({ status, page: '1', limit: '1' });
      const payload = (await getJson(`${IPO_ALERTS_URL}?${query.toString()}`, signal)) as {
        ipos?: unknown[];
        meta?: { info?: string };
      };
      return { status, payload };
    })
  );

  const records: unknown[] = [];
  const warnings: string[] = [];
  let successfulQueries = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      warnings.push('A public IPO status query could not be loaded.');
      continue;
    }
    successfulQueries += 1;
    records.push(...(Array.isArray(result.value.payload.ipos) ? result.value.payload.ipos : []));
    if (result.value.payload.meta?.info) warnings.push(result.value.payload.meta.info);
  }

  const normalized = uniqueIpos(records.map((record) => normalizeIpoAlertsRecord(record)).filter(isIPO));
  const status: DataSourceStatus = {
    id: 'ipoalerts',
    name: 'IPOAlerts (NSE/BSE aggregate)',
    status: successfulQueries > 0 ? 'limited' : 'error',
    recordCount: normalized.length,
    note:
      successfulQueries > 0
        ? 'Public preview is limited to one result per lifecycle status. Configure IPOALERTS_API_KEY on the feed server for full coverage.'
        : 'Could not reach the public IPOAlerts endpoint.',
    updatedAt: new Date().toISOString(),
    url: IPO_ALERTS_HOME,
  };

  return {
    ipos: normalized,
    sources: [
      status,
      {
        id: 'ipoguru',
        name: 'IPO Guru (category-wise subscription)',
        status: 'unconfigured',
        recordCount: 0,
        note: 'Configure IPOGURU_API_KEY on the feed server to enable this source. Standard or higher is required for category-wise subscription data.',
        url: IPO_GURU_HOME,
      },
    ],
    fetchedAt: new Date().toISOString(),
    isFresh: successfulQueries > 0,
    completeness: 'limited',
    warnings: [...new Set(warnings)],
  };
}

function normalizeRawFeed(raw: RawFeed): IpoFeed {
  const alertRows = Array.isArray(raw?.records?.ipoAlerts) ? raw.records.ipoAlerts : [];
  const guruRows = Array.isArray(raw?.records?.ipoGuru) ? raw.records.ipoGuru : [];
  const directRows = Array.isArray(raw?.ipos) ? raw.ipos : [];

  const fromAlerts = alertRows.map(normalizeIpoAlertsRecord).filter(isIPO);
  const fromGuru = guruRows.map(normalizeIpoGuruRecord).filter(isIPO);
  const direct = directRows.map(normalizeGenericRecord).filter(isIPO);
  const ipos = uniqueIpos([...fromAlerts, ...fromGuru, ...direct]);
  const sources = (Array.isArray(raw?.sources) ? raw.sources : []).map(normalizeSourceStatus).filter(isSourceStatus);
  const anySourceResponded = sources.some((source) => source.status === 'ok' || source.status === 'limited');
  const warnings = Array.isArray(raw?.warnings)
    ? raw.warnings.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    ipos,
    sources,
    fetchedAt: validTimestamp(raw?.fetchedAt ?? raw?.generatedAt) ?? new Date().toISOString(),
    isFresh: anySourceResponded,
    completeness: raw?.completeness === 'complete' ? 'complete' : 'limited',
    warnings,
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

/** Merge a newer provider value into a saved/cached record without erasing data
 * that a provider does not return (e.g. IPOAlerts has overall subscription only). */
export function mergeIpo(previous: IPO, incoming: IPO): IPO {
  const sources = mergeSources(previous.sources ?? [], incoming.sources ?? []);
  const subscription = mergeDefined(previous.subscription, incoming.subscription);
  const timeline = mergeTimelineDates(previous, incoming);
  const exchanges = incoming.exchanges?.some((exchange) => exchange !== 'Not reported')
    ? incoming.exchanges
    : previous.exchanges;
  const merged: IPO = {
    ...previous,
    ...incoming,
    ...timeline,
    id: previous.id,
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
    about: incoming.about && !incoming.about.endsWith('data received from a live public source.') ? incoming.about : previous.about,
    sourceName: sources.length ? sources.map((source) => source.name).join(' · ') : incoming.sourceName || previous.sourceName,
    sourceUrl: incoming.sourceUrl || previous.sourceUrl,
    sources,
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
