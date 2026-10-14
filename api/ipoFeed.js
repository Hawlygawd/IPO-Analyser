const IPO_ALERTS_URL = 'https://api.ipoalerts.in/ipos';
const IPO_GURU_URL = 'https://www.ipoguru.in/api/v2/ipos';
const NSE_API_ROOT = 'https://www.nseindia.com/api';
const NSE_IPO_PAGE = 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
const BSE_API_ROOT = 'https://api.bseindia.com/BseIndiaAPI/api';
const BSE_IPO_PAGE = 'https://www.bseindia.com/publicissue';
const REQUEST_TIMEOUT_MS = 4500;
const FEED_CACHE_MS = 60 * 1000;
const EXCHANGE_CACHE_MS = 5 * 60_000;
const ERROR_CACHE_MS = 60 * 1000;
const MAX_CATEGORY_LOOKUPS = 10;
const MAX_NSE_PAST_RECORDS = 350;
const NSE_LOOKBACK_DAYS = 365;
const STATUS_FILTERS = ['open', 'upcoming', 'closed', 'listed'];
const IPO_GURU_PLAN_CACHE_MS = {
  free: 3 * 60 * 60_000,
  basic: 10 * 60_000,
  standard: 20 * 60_000,
  pro: 10 * 60_000,
  enterprise: 10 * 60_000,
};
const IPO_ALERTS_PLAN_CACHE_MS = {
  free: 60 * 60_000,
  basic: 5 * 60_000,
  standard: 5 * 60_000,
  pro: 5 * 60_000,
  enterprise: 5 * 60_000,
};

let cachedPayload;
let cachedUntil = 0;
let pendingRequest;
const providerCache = new Map();

module.exports = async function ipoFeedHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  setPublicCacheHeaders(res, FEED_CACHE_MS);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (cachedPayload && Date.now() < cachedUntil) {
      setPublicCacheHeaders(res, FEED_CACHE_MS);
      return res.status(200).json(cachedPayload);
    }
    if (!pendingRequest) {
      pendingRequest = collectFeed().finally(() => {
        pendingRequest = undefined;
      });
    }
    const collected = await pendingRequest;
    cachedPayload = collected.payload;
    cachedUntil = Date.now() + FEED_CACHE_MS;
    setPublicCacheHeaders(res, FEED_CACHE_MS);
    return res.status(200).json(cachedPayload);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({
      error: 'Unable to collect IPO data from configured providers.',
      details: safeMessage(error),
      fetchedAt: new Date().toISOString(),
      records: { ipoAlerts: [], ipoGuru: [], nse: [], bse: [] },
      sources: [
        sourceFailure('nse', 'NSE India (official exchange feed)', NSE_IPO_PAGE, error),
        sourceFailure('bse', 'BSE India (official exchange feed)', BSE_IPO_PAGE, error),
        sourceFailure('ipoalerts', 'IPOAlerts (aggregated IPO data)', 'https://ipoalerts.in/', error),
        sourceFailure('ipoguru', 'IPO Guru (secondary IPO data)', 'https://www.ipoguru.in/ipo-gmp-details-developer-api', error),
      ],
      completeness: 'limited',
      warnings: ['Live IPO source requests failed. Previously cached app data was left untouched.'],
    });
  }
};

function setPublicCacheHeaders(res, ttlMs) {
  const seconds = Math.max(60, Math.floor(ttlMs / 1000));
  const staleSeconds = Math.min(120, seconds);
  res.setHeader('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`);
}

async function collectFeed() {
  const ipoAlertsKey = process.env.IPOALERTS_API_KEY;
  const ipoGuruKey = process.env.IPOGURU_API_KEY;
  const configuredPromises = [
    cachedProvider('nse', EXCHANGE_CACHE_MS, collectNse),
    cachedProvider('bse', EXCHANGE_CACHE_MS, collectBse),
    ipoAlertsKey && ipoAlertsKey.trim()
      ? cachedProvider('ipoalerts', alertsPlanCacheMs(), () => collectIpoAlerts(ipoAlertsKey))
      : Promise.resolve(collectIpoAlerts()),
    ipoGuruKey && ipoGuruKey.trim()
      ? cachedProvider('ipoguru', IPO_GURU_PLAN_CACHE_MS.free, () => collectIpoGuru(ipoGuruKey))
      : Promise.resolve(collectIpoGuru()),
  ];
  const [nseResult, bseResult, alertsResult, guruResult] = await Promise.all(
    configuredPromises.map((promise, index) =>
      promise.catch((error) => {
        const configs = [
          ['nse', 'NSE India (official exchange feed)', NSE_IPO_PAGE],
          ['bse', 'BSE India (official exchange feed)', BSE_IPO_PAGE],
          ['ipoalerts', 'IPOAlerts (aggregated IPO data)', 'https://ipoalerts.in/'],
          ['ipoguru', 'IPO Guru (secondary IPO data)', 'https://www.ipoguru.in/ipo-gmp-details-developer-api'],
        ][index];
        const [id, name, url] = configs;
        return {
          records: [],
          source: sourceFailure(id, name, url, error),
        };
      })
    )
  );

  const sources = [nseResult.source, bseResult.source, alertsResult.source, guruResult.source];
  const warnings = [
    'NSE/BSE website endpoints are best-effort and are not guaranteed public APIs; check primary exchange notices for important dates and prices.',
    ...sources
      .filter((source) => source.status === 'error' || source.status === 'unconfigured' || source.status === 'limited')
      .map((source) => `${source.name}: ${source.note}`)
      .filter(Boolean),
  ];

  return {
    payload: {
      fetchedAt: new Date().toISOString(),
      records: {
        nse: nseResult.records,
        bse: bseResult.records,
        ipoAlerts: alertsResult.records,
        ipoGuru: guruResult.records,
      },
      sources,
      // Direct exchange feeds improve coverage but do not provide a guarantee
      // of a complete historical catalog. Only keyed full catalogs can do so.
      // The website endpoints are best-effort and provider plan limits cannot
      // certify a complete catalogue or complete historical coverage. Keep the
      // response explicitly limited even when every configured source responds.
      completeness: 'limited',
      warnings,
    },
  };
}

function configuredAlertsPlan() {
  const plan = String(process.env.IPOALERTS_PLAN || 'free').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(IPO_ALERTS_PLAN_CACHE_MS, plan) ? plan : 'free';
}

function alertsPlanCacheMs() {
  return IPO_ALERTS_PLAN_CACHE_MS[configuredAlertsPlan()];
}

async function cachedProvider(id, defaultTtlMs, loader) {
  const now = Date.now();
  const existing = providerCache.get(id);
  if (existing?.value && now < existing.expiresAt) return existing.value;
  if (existing?.error && now < existing.errorUntil) throw existing.error;
  if (existing?.pending) return existing.pending;

  const entry = existing || {};
  entry.pending = Promise.resolve()
    .then(loader)
    .then((result) => {
      const requestedTtl = Number(result.cacheTtlMs);
      const ttl = Number.isFinite(requestedTtl) && requestedTtl >= 60_000 ? requestedTtl : defaultTtlMs;
      entry.value = result;
      entry.expiresAt = Date.now() + ttl;
      entry.error = undefined;
      entry.errorUntil = 0;
      return result;
    })
    .catch((error) => {
      entry.value = undefined;
      entry.error = error;
      entry.errorUntil = Date.now() + ERROR_CACHE_MS;
      throw error;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  providerCache.set(id, entry);
  return entry.pending;
}

async function collectIpoAlerts(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return {
      records: [],
      source: {
        id: 'ipoalerts',
        name: 'IPOAlerts (aggregated IPO data)',
        status: 'unconfigured',
        recordCount: 0,
        note: 'Optional aggregator. Set IPOALERTS_API_KEY on the server; the documented API does not provide anonymous access.',
        url: 'https://ipoalerts.in/',
      },
    };
  }

  const key = apiKey.trim();
  const plan = configuredAlertsPlan();
  const isFreePlan = plan === 'free';
  const statuses = isFreePlan ? ['open'] : STATUS_FILTERS;
  const records = [];
  const failures = [];
  const truncatedStatuses = [];
  const includeGmp = process.env.IPOALERTS_INCLUDE_GMP === 'true';

  const results = await Promise.all(
    statuses.map(async (status) => {
      try {
        const result = await fetchIpoAlertsStatus(status, key, includeGmp, isFreePlan);
        return { status, records: result.records, truncated: result.truncated, error: undefined };
      } catch (error) {
        return { status, records: [], truncated: false, error };
      }
    })
  );
  for (const result of results) {
    records.push(...result.records);
    if (result.error) failures.push(`${result.status}: ${safeMessage(result.error)}`);
    if (result.truncated) truncatedStatuses.push(result.status);
  }

  const sourceStatus =
    results.every((result) => result.error) ? 'error' :
      isFreePlan || failures.length > 0 || truncatedStatuses.length > 0 ? 'limited' : 'ok';
  if (results.every((result) => result.error)) {
    throw new Error(failures.join('; ') || 'IPOAlerts returned no successful status responses.');
  }
  const note = isFreePlan
    ? 'Free plan is limited to open issues and one IPO per request. Set IPOALERTS_PLAN=pro (or your actual plan) to enable full lifecycle pagination.'
    : failures.length || truncatedStatuses.length
      ? [
          failures.length ? `Some lifecycle requests failed: ${failures.join('; ')}` : '',
          truncatedStatuses.length ? `Results were capped at three pages for: ${truncatedStatuses.join(', ')}.` : '',
        ].filter(Boolean).join(' ')
      : 'Authenticated aggregator feed. Use the NSE/BSE exchange feeds below to cross-check published issue facts.';

  return {
    records,
    cacheTtlMs: alertsPlanCacheMs(),
    source: {
      id: 'ipoalerts',
      name: 'IPOAlerts (aggregated IPO data)',
      status: sourceStatus,
      recordCount: records.length,
      note,
      plan,
      updatedAt: new Date().toISOString(),
      url: 'https://ipoalerts.in/',
    },
  };
}

async function fetchIpoAlertsStatus(status, apiKey, includeGmp, isFreePlan) {
  const pageLimit = isFreePlan ? 1 : 100;
  const maxPages = isFreePlan ? 1 : 3;
  const headers = { Accept: 'application/json', 'x-api-key': apiKey };
  const fetchPage = async (page) => {
    const query = new URLSearchParams({ status, page: String(page), limit: String(pageLimit) });
    if (includeGmp) query.set('includeGmp', 'true');
    try {
      return await requestJson(`${IPO_ALERTS_URL}?${query.toString()}`, headers);
    } catch (error) {
      // GMP is a separately billed add-on; an unavailable add-on must not
      // cause the ordinary IPO lifecycle query to be discarded.
      if (!includeGmp) throw error;
      query.delete('includeGmp');
      return requestJson(`${IPO_ALERTS_URL}?${query.toString()}`, headers);
    }
  };

  const firstPage = await fetchPage(1);
  const allRecords = Array.isArray(firstPage.ipos) ? [...firstPage.ipos] : [];
  const reportedPages = Number(firstPage.meta && firstPage.meta.totalPages);
  const pagesToFetch = Number.isFinite(reportedPages) && reportedPages > 1 ? Math.min(reportedPages, maxPages) : 1;
  if (pagesToFetch > 1) {
    const remaining = await Promise.all(
      Array.from({ length: pagesToFetch - 1 }, (_, index) => fetchPage(index + 2))
    );
    for (const page of remaining) if (Array.isArray(page.ipos)) allRecords.push(...page.ipos);
  }
  return { records: allRecords, truncated: Number.isFinite(reportedPages) && reportedPages > maxPages };
}

async function collectIpoGuru(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return {
      records: [],
      source: {
        id: 'ipoguru',
        name: 'IPO Guru (secondary IPO data)',
        status: 'unconfigured',
        recordCount: 0,
        note: 'Optional second aggregator. Set IPOGURU_API_KEY on the server; Standard or higher is required for its category-subscription endpoint.',
        url: 'https://www.ipoguru.in/ipo-gmp-details-developer-api',
      },
    };
  }

  const key = apiKey.trim();
  const headers = { Accept: 'application/json', 'X-API-KEY': key };
  const listUrl = new URL(IPO_GURU_URL);
  listUrl.searchParams.set('months', '0');
  listUrl.searchParams.set('limit', '200');
  const result = await requestJson(listUrl.toString(), headers);
  if (result.success === false) throw new Error('IPO Guru returned an unsuccessful response.');
  const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.ipos) ? result.ipos : [];
  const plan = String(result.plan || '').toLowerCase();
  const hasCategoryScope = ['standard', 'pro', 'enterprise'].includes(plan);
  const eligibleCategoryRows = rows.filter((row) => row && typeof row === 'object' && needsSubscriptionRefresh(row));
  const categoryRows = eligibleCategoryRows.slice(0, MAX_CATEGORY_LOOKUPS);
  const categoryRowsCapped = eligibleCategoryRows.length > categoryRows.length;
  let categoryFailures = 0;

  if (hasCategoryScope) {
    await Promise.all(
      categoryRows.map(async (row) => {
        const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
        if (!slug) return;
        try {
          const subscription = await requestJson(`${IPO_GURU_URL}/${encodeURIComponent(slug)}/subscription`, headers);
          if (subscription.success === false) throw new Error('Subscription endpoint returned an unsuccessful response.');
          const payload = subscription.data && typeof subscription.data === 'object' ? subscription.data : subscription;
          row.subscription = payload;
        } catch {
          categoryFailures += 1;
        }
      })
    );
  }

  const records = rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const existing = row.subscription && typeof row.subscription === 'object' ? row.subscription : {};
    const summary = existing.summary && typeof existing.summary === 'object' ? existing.summary : {};
    const total = existing.total ?? summary.total ?? row.subscription_total ?? row.subscriptionTotal;
    row.subscription = { ...summary, ...existing, total };
    return row;
  });
  const mainboardCount = rows.filter(
    (row) => row && typeof row === 'object' && !String(row.type).toLowerCase().includes('sme')
  ).length;
  const smeCount = rows.filter(
    (row) => row && typeof row === 'object' && String(row.type).toLowerCase().includes('sme')
  ).length;
  const catalogComplete = mainboardCount < 200 && smeCount < 200;
  const status =
    hasCategoryScope && categoryFailures === 0 && !categoryRowsCapped && catalogComplete ? 'ok' : 'limited';
  const note = hasCategoryScope
    ? categoryFailures || categoryRowsCapped || !catalogComplete
      ? [
          categoryFailures ? `Category subscription was unavailable for ${categoryFailures} active/recent issue${categoryFailures === 1 ? '' : 's'}.` : '',
          categoryRowsCapped ? `Category lookups were capped at ${MAX_CATEGORY_LOOKUPS} issues per refresh.` : '',
          !catalogComplete ? 'IPO list reached its 200-issue per-board cap.' : '',
        ].filter(Boolean).join(' ')
      : 'Live IPO list and category subscription fields are enabled.'
    : `IPO Guru ${plan || 'unknown'} plan supplies IPO details/GMP; its category-wise subscription endpoint requires Standard or higher.${plan === 'free' ? ' Free-plan provider data is cached separately for up to three hours.' : ''}${!catalogComplete ? ' IPO list reached its 200-issue per-board cap.' : ''}`;
  const cacheTtlMs = Object.prototype.hasOwnProperty.call(IPO_GURU_PLAN_CACHE_MS, plan)
    ? IPO_GURU_PLAN_CACHE_MS[plan]
    : IPO_GURU_PLAN_CACHE_MS.basic;

  return {
    records,
    catalogComplete,
    cacheTtlMs,
    source: {
      id: 'ipoguru',
      name: 'IPO Guru (secondary IPO data)',
      status,
      recordCount: records.length,
      note,
      plan: plan || undefined,
      updatedAt: new Date().toISOString(),
      url: 'https://www.ipoguru.in/ipo-gmp-details-developer-api',
    },
  };
}

async function collectNse() {
  const sessionCookie = await warmNseSession();
  const endpoints = [
    ['current', `${NSE_API_ROOT}/ipo-current-issue`],
    ['upcoming', `${NSE_API_ROOT}/all-upcoming-issues?category=ipo`],
    ['past', `${NSE_API_ROOT}/public-past-issues`],
  ];
  const results = await Promise.all(
    endpoints.map(async ([key, url]) => {
      try {
        const payload = await requestJson(url, nseHeaders(sessionCookie));
        return { key, rows: extractRows(payload), error: undefined };
      } catch (error) {
        return { key, rows: [], error };
      }
    })
  );
  const byName = Object.fromEntries(results.map((result) => [result.key, result]));
  const failures = results.filter((result) => result.error).map((result) => `${result.key}: ${safeMessage(result.error)}`);
  if (results.every((result) => result.error)) throw new Error(`NSE exchange feed unavailable (${failures.join('; ')}).`);

  const currentRows = byName.current.rows;
  const upcomingRows = byName.upcoming.rows;
  const cutoff = Date.now() - NSE_LOOKBACK_DAYS * 24 * 60 * 60_000;
  const recentPastRows = byName.past.rows
    .filter((row) => isRecentNseIssue(row, cutoff))
    .sort((a, b) => nseSortDate(b) - nseSortDate(a));
  const pastRows = recentPastRows.slice(0, MAX_NSE_PAST_RECORDS);
  const pastRowsCapped = recentPastRows.length > MAX_NSE_PAST_RECORDS;
  const categoryCandidates = currentRows.filter((row) => textValue(row.symbol)).slice(0, MAX_CATEGORY_LOOKUPS);
  let categoryFailures = 0;
  await Promise.all(
    categoryCandidates.map(async (row) => {
      const symbol = textValue(row.symbol);
      try {
        const url = `${NSE_API_ROOT}/ipo-active-category?symbol=${encodeURIComponent(symbol)}`;
        const payload = await requestJson(url, nseHeaders(sessionCookie, symbol, row.series));
        const subscription = parseNseSubscription(payload);
        if (subscription) row.subscription = subscription;
      } catch {
        categoryFailures += 1;
      }
    })
  );

  const records = dedupeRawRecords([...currentRows, ...upcomingRows, ...pastRows], nseRawKey);
  const baseFailures = results.filter((result) => result.error).length;
  const status = baseFailures || categoryFailures || currentRows.length > categoryCandidates.length || pastRowsCapped || records.length === 0 ? 'limited' : 'ok';
  const noteParts = [
    'NSE public website feed: current, forthcoming, and recent listed/closed IPOs; best-effort, not a guaranteed public API.',
    records.length === 0 ? 'No issue rows were returned; this must not be interpreted as proof there are no relevant IPOs.' : '',

    categoryCandidates.length ? `Category subscription queried for up to ${MAX_CATEGORY_LOOKUPS} open issues.` : '',
    categoryFailures ? `Category subscription could not be read for ${categoryFailures} issue(s).` : '',
    currentRows.length > categoryCandidates.length ? `Category lookups capped at ${MAX_CATEGORY_LOOKUPS} active issues.` : '',
    baseFailures ? `Some NSE lifecycle lists failed: ${failures.join('; ')}.` : '',
    pastRowsCapped ? `Recent history capped at ${MAX_NSE_PAST_RECORDS} records.` : '',
  ].filter(Boolean);

  return {
    records,
    cacheTtlMs: EXCHANGE_CACHE_MS,
    source: {
      id: 'nse',
      name: 'NSE India (official exchange feed)',
      status,
      recordCount: records.length,
      note: noteParts.join(' '),
      updatedAt: new Date().toISOString(),
      url: NSE_IPO_PAGE,
    },
  };
}

async function collectBse() {
  const url = `${BSE_API_ROOT}/GetPublicIssue_par_updated/w?flag=1&status=&exchange=&ir_flag=IPO`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.bseindia.com',
    Referer: BSE_IPO_PAGE,
    'User-Agent': 'Mozilla/5.0 (compatible; IPO-Pulse/1.0; public exchange data)',
  };
  const payload = await requestJson(url, headers);
  const allRows = extractRows(payload);
  const ipoRows = allRows.filter((row) => {
    const type = String(row.IR_flag ?? row.IR_FLAG_FULL ?? '').trim().toUpperCase();
    return !type || type === 'IPO';
  });
  const activeRows = ipoRows.filter((row) => ['L', 'O', 'OPEN', 'LIVE'].includes(String(row.Status ?? '').trim().toUpperCase()));
  const categoryCandidates = activeRows.filter((row) => row.IPO_NO != null).slice(0, MAX_CATEGORY_LOOKUPS);
  let categoryFailures = 0;
  await Promise.all(
    categoryCandidates.map(async (row) => {
      try {
        const subscriptionUrl = `${BSE_API_ROOT}/Pubissues_GetBkbldgCatdem_PAR_bbnew_ng/w?IPO_NO=${encodeURIComponent(String(row.IPO_NO))}`;
        const subscription = await requestJson(subscriptionUrl, headers);
        const parsed = parseBseSubscription(subscription);
        if (parsed) row.subscription = parsed;
      } catch {
        categoryFailures += 1;
      }
    })
  );
  const records = dedupeRawRecords(ipoRows, bseRawKey);
  const categoryCapped = activeRows.length > categoryCandidates.length;
  const status = categoryFailures || categoryCapped || records.length === 0 ? 'limited' : 'ok';
  const note = [
    'BSE public-issue website feed supplements BSE SME and BSE-only issues; best-effort, not a guaranteed public API.',
    records.length === 0 ? 'No issue rows were returned; this must not be interpreted as proof there are no relevant IPOs.' : '',
    categoryCandidates.length ? `Category subscription queried for up to ${MAX_CATEGORY_LOOKUPS} live issues.` : '',
    categoryFailures ? `Category subscription could not be read for ${categoryFailures} issue(s).` : '',
    categoryCapped ? `Category lookups capped at ${MAX_CATEGORY_LOOKUPS} live issues.` : '',
    'The BSE website endpoint is not a guaranteed commercial API; it may be unavailable or change without notice.',
  ].filter(Boolean).join(' ');

  return {
    records,
    cacheTtlMs: EXCHANGE_CACHE_MS,
    source: {
      id: 'bse',
      name: 'BSE India (official exchange feed)',
      status,
      recordCount: records.length,
      note,
      updatedAt: new Date().toISOString(),
      url: BSE_IPO_PAGE,
    },
  };
}

async function warmNseSession() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(NSE_IPO_PAGE, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; IPO-Pulse/1.0; public exchange data)',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NSE page returned HTTP ${response.status}`);
    const cookieLines = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    const cookie = cookieLines
      .map((line) => String(line).split(';', 1)[0].trim())
      .filter(Boolean)
      .join('; ');
    try { await response.body?.cancel(); } catch { /* body isn't needed for the session */ }
    return cookie;
  } finally {
    clearTimeout(timeout);
  }
}

function nseHeaders(cookie, symbol, series) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en;q=0.9',
    Referer: symbol
      ? `https://www.nseindia.com/market-data/issue-information?symbol=${encodeURIComponent(symbol)}&series=${encodeURIComponent(series || 'EQ')}&type=Active`
      : NSE_IPO_PAGE,
    'User-Agent': 'Mozilla/5.0 (compatible; IPO-Pulse/1.0; public exchange data)',
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload.filter((row) => row && typeof row === 'object');
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['Table', 'table1', 'data', 'records', 'ipos', 'result']) {
    if (Array.isArray(payload[key])) return payload[key].filter((row) => row && typeof row === 'object');
  }
  return [];
}

function parseNseSubscription(payload) {
  const rows = extractRows(payload);
  if (!rows.length) return undefined;
  const split = { asOf: `NSE · checked ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} IST` };
  for (const row of rows) {
    const key = categoryKey(row.category ?? row.categoryName ?? row.catName ?? row.investorCategory ?? row.srNo);
    if (!key) continue;
    const offered = parseNumeric(row.noOfShareOffered ?? row.noOfShareO ?? row.sharesOffered ?? row.offered);
    const bids = parseNumeric(row.noOfSharesBid ?? row.noOfshareBid ?? row.sharesBid ?? row.bids);
    const multiple = parseNumeric(row.noOfTotalMeant ?? row.subscription ?? row.times ?? row.timesX) ??
      (offered > 0 && bids >= 0 ? bids / offered : undefined);
    if (multiple == null) continue;
    split[key] = multiple;
  }
  return Object.keys(split).some((key) => key !== 'asOf') ? split : undefined;
}

function parseBseSubscription(payload) {
  const rows = extractRows(payload);
  if (!rows.length) return undefined;
  const split = { asOf: textValue(rows.find((row) => row.Maxdt)?.Maxdt) ? `BSE · ${textValue(rows.find((row) => row.Maxdt)?.Maxdt)}` : undefined };
  for (const row of rows) {
    const label = row.col2 ?? row.category ?? row.Category;
    const key = categoryKey(label) || categoryKey(row.SRNo);
    if (!key) continue;
    const multiple = parseNumeric(row.col5 ?? row.times ?? row.subscription);
    if (multiple != null) split[key] = multiple;
  }
  return Object.keys(split).some((key) => key !== 'asOf' && split[key] != null) ? split : undefined;
}

function categoryKey(value) {
  const label = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!label) return undefined;
  if (label === 'total' || label.includes('overall')) return 'total';
  if (label.includes('employee')) return 'employee';
  if (label.includes('shareholder')) return 'shareholder';
  if (label.includes('qib') || label.includes('qualifiedinstitution')) return 'qib';
  if (label.includes('snii') || label.includes('shni') || label.includes('smallhni')) return 'sNii';
  if (label.includes('bnii') || label.includes('bhni') || label.includes('bighni')) return 'bNii';
  if (label === 'nii' || label.includes('noninstitutional') || label.includes('hni')) return 'nii';
  if (label.includes('retail') || label === 'rii') return 'retail';
  return undefined;
}

function parseNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/,/g, '').replace(/[x%\s]/gi, '');
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return undefined;
  const number = Number(clean);
  return Number.isFinite(number) ? number : undefined;
}

function isRecentNseIssue(row, cutoff) {
  const value = row.ipoStartDate ?? row.issueStartDate ?? row.openDate ?? row.listingDate;
  const date = exchangeDate(value);
  return Boolean(date && date.getTime() >= cutoff);
}

function nseSortDate(row) {
  const date = exchangeDate(row.listingDate ?? row.ipoEndDate ?? row.issueEndDate ?? row.ipoStartDate ?? row.issueStartDate);
  return date ? date.getTime() : 0;
}

function exchangeDate(value) {
  const text = textValue(value);
  if (!text) return undefined;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date
      : undefined;
  }
  const parts = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](\d{4})/);
  if (!parts) return undefined;
  const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const month = /^\d+$/.test(parts[2]) ? Number(parts[2]) - 1 : monthMap[parts[2].slice(0, 3).toLowerCase()];
  const day = Number(parts[1]);
  const year = Number(parts[3]);
  if (!Number.isInteger(month) || month < 0 || month > 11 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return undefined;
  return date;
}

function dedupeRawRecords(rows, keyFn) {
  const output = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const existing = output.get(key);
    output.set(key, existing ? { ...existing, ...row, subscription: row.subscription ?? existing.subscription } : row);
  }
  return [...output.values()];
}

function nseRawKey(row) {
  const name = normalizeName(row.companyName ?? row.company ?? row.name);
  const open = exchangeDate(row.issueStartDate ?? row.ipoStartDate ?? row.openDate)?.toISOString().slice(0, 10) ?? '';
  return name ? `${name}|${open}` : textValue(row.symbol);
}

function bseRawKey(row) {
  const name = normalizeName(row.LONG_NAME ?? row.Scrip_Name ?? row.name);
  const open = exchangeDate(row.Start_Dt ?? row.issueStartDate)?.toISOString().slice(0, 10) ?? '';
  return name ? `${name}|${open}` : String(row.IPO_NO ?? row.Scrip_cd ?? '');
}

function normalizeName(value) {
  return String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|company|co)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function needsSubscriptionRefresh(row) {
  const status = String(row.status || '').toLowerCase();
  if (status === 'open') return true;
  if (status !== 'closed') return false;
  const closeDate = new Date(`${row.close_date || ''}T00:00:00Z`);
  if (Number.isNaN(closeDate.getTime())) return false;
  const age = Date.now() - closeDate.getTime();
  return age >= -24 * 60 * 60_000 && age <= 7 * 24 * 60 * 60_000;
}

async function requestJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`Provider returned non-JSON data (HTTP ${response.status}).`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function sourceFailure(id, name, url, error) {
  return {
    id,
    name,
    status: 'error',
    recordCount: 0,
    note: safeMessage(error),
    url,
  };
}

function safeMessage(error) {
  if (!error) return 'Unknown provider error.';
  const message = error instanceof Error ? error.message : String(error);
  // Never pass credentials or full request URLs into logs / user-facing responses.
  return message.replace(/(x-api-key|api[_-]?key|token|authorization)[=: ]+[^ ,;]+/gi, '$1=[redacted]').slice(0, 240);
}

function textValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const result = String(value).trim();
  return result || undefined;
}

module.exports.resetCachesForTests = function resetCachesForTests() {
  cachedPayload = undefined;
  cachedUntil = 0;
  pendingRequest = undefined;
  providerCache.clear();
};
module.exports.parseNseSubscription = parseNseSubscription;
module.exports.parseBseSubscription = parseBseSubscription;
module.exports.collectNse = collectNse;
module.exports.collectBse = collectBse;
