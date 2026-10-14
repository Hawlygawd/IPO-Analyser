const IPO_ALERTS_URL = 'https://api.ipoalerts.in/ipos';
const IPO_GURU_URL = 'https://www.ipoguru.in/api/v2/ipos';
const STATUS_FILTERS = ['open', 'upcoming', 'closed', 'listed'];
const REQUEST_TIMEOUT_MS = 4000;
const SERVER_CACHE_MS = 10 * 60_000;
const IPO_GURU_PLAN_CACHE_MS = {
  free: 3 * 60 * 60_000,
  basic: 10 * 60_000,
  standard: 20 * 60_000,
  pro: 10 * 60_000,
};

let cachedPayload;
let cachedUntil = 0;
let cachedTtlMs = SERVER_CACHE_MS;
let pendingRequest;

module.exports = async function ipoFeedHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (cachedPayload && Date.now() < cachedUntil) {
      setPublicCacheHeaders(res, cachedTtlMs);
      return res.status(200).json(cachedPayload);
    }
    if (!pendingRequest) {
      pendingRequest = collectFeed().finally(() => {
        pendingRequest = undefined;
      });
    }
    const collected = await pendingRequest;
    cachedPayload = collected.payload;
    cachedTtlMs = collected.cacheTtlMs;
    cachedUntil = Date.now() + cachedTtlMs;
    setPublicCacheHeaders(res, cachedTtlMs);
    return res.status(200).json(cachedPayload);
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to collect IPO data from configured providers.',
      details: safeMessage(error),
      fetchedAt: new Date().toISOString(),
      records: { ipoAlerts: [], ipoGuru: [] },
      sources: [
        { id: 'ipoalerts', name: 'IPOAlerts (NSE/BSE aggregate)', status: 'error', recordCount: 0 },
        { id: 'ipoguru', name: 'IPO Guru (category-wise subscription)', status: 'error', recordCount: 0 },
      ],
      completeness: 'limited',
      warnings: ['Live IPO source request failed. Cached app data was left untouched.'],
    });
  }
};

function setPublicCacheHeaders(res, ttlMs) {
  const seconds = Math.max(60, Math.floor(ttlMs / 1000));
  const staleSeconds = Math.min(300, seconds);
  res.setHeader('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=${staleSeconds}`);
}

async function collectFeed() {
  const ipoAlertsKey = process.env.IPOALERTS_API_KEY;
  const ipoGuruKey = process.env.IPOGURU_API_KEY;

  const [alertsResult, guruResult] = await Promise.all([
    collectIpoAlerts(ipoAlertsKey).catch((error) => ({
      records: [],
      source: {
        id: 'ipoalerts',
        name: 'IPOAlerts (NSE/BSE aggregate)',
        status: 'error',
        recordCount: 0,
        note: safeMessage(error),
        url: 'https://ipoalerts.in/',
      },
    })),
    collectIpoGuru(ipoGuruKey).catch((error) => ({
      records: [],
      source: {
        id: 'ipoguru',
        name: 'IPO Guru (category-wise subscription)',
        status: 'error',
        recordCount: 0,
        note: safeMessage(error),
        url: 'https://www.ipoguru.in/ipo-gmp-details-developer-api',
      },
    })),
  ]);

  const sources = [alertsResult.source, guruResult.source];
  const warnings = sources
    .filter((source) => source.status === 'error' || source.status === 'unconfigured' || source.status === 'limited')
    .map((source) => `${source.name}: ${source.note}`)
    .filter(Boolean);

  return {
    payload: {
      fetchedAt: new Date().toISOString(),
      records: { ipoAlerts: alertsResult.records, ipoGuru: guruResult.records },
      sources,
      completeness:
        (ipoAlertsKey && alertsResult.source.status === 'ok') || guruResult.catalogComplete
          ? 'complete'
          : 'limited',
      warnings,
    },
    cacheTtlMs: Math.max(SERVER_CACHE_MS, alertsResult.cacheTtlMs ?? 0, guruResult.cacheTtlMs ?? 0),
  };
}

async function collectIpoAlerts(apiKey) {
  const records = [];
  const failures = [];
  const truncatedStatuses = [];
  const keyConfigured = Boolean(apiKey && apiKey.trim());
  const includeGmp = process.env.IPOALERTS_INCLUDE_GMP === 'true';

  const results = await Promise.all(
    STATUS_FILTERS.map(async (status) => {
      try {
        const result = await fetchIpoAlertsStatus(status, keyConfigured ? apiKey.trim() : undefined, includeGmp);
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

  const successfulQueries = results.filter((result) => !result.error).length;
  const sourceStatus =
    successfulQueries === 0
      ? 'error'
      : keyConfigured && failures.length === 0 && truncatedStatuses.length === 0
        ? 'ok'
        : 'limited';
  const note = keyConfigured
    ? failures.length || truncatedStatuses.length
      ? [
          failures.length ? `Some lifecycle requests failed: ${failures.join('; ')}` : '',
          truncatedStatuses.length ? `Results were capped at three pages for: ${truncatedStatuses.join(', ')}.` : '',
        ]
            .filter(Boolean)
            .join(' ')
      : 'Authenticated feed. IPO records are aggregated from public exchange and registrar data.'
    : 'Using the public preview (one record per lifecycle status). Set IPOALERTS_API_KEY on the server for complete coverage.';

  if (successfulQueries === 0) throw new Error(failures.join('; ') || 'IPOAlerts returned no successful status responses.');
  return {
    records,
    source: {
      id: 'ipoalerts',
      name: 'IPOAlerts (NSE/BSE aggregate)',
      status: sourceStatus,
      recordCount: records.length,
      note,
      updatedAt: new Date().toISOString(),
      url: 'https://ipoalerts.in/',
    },
  };
}

async function fetchIpoAlertsStatus(status, apiKey, includeGmp) {
  const pageLimit = apiKey ? 100 : 1;
  const maxPages = apiKey ? 3 : 1;
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  const fetchPage = async (page) => {
    const query = new URLSearchParams({ status, page: String(page), limit: String(pageLimit) });
    if (includeGmp && apiKey) query.set('includeGmp', 'true');
    try {
      return await requestJson(`${IPO_ALERTS_URL}?${query.toString()}`, headers);
    } catch (error) {
      // GMP is a separately billed add-on on IPOAlerts. If it is not enabled on
      // the key, retry the ordinary IPO feed rather than losing lifecycle data.
      if (!includeGmp || !apiKey) throw error;
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
        name: 'IPO Guru (category-wise subscription)',
        status: 'unconfigured',
        recordCount: 0,
        note: 'Set IPOGURU_API_KEY on the server to enable this independent source. Standard or higher is required for category subscription data.',
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
  const categoryRows = eligibleCategoryRows.slice(0, 10);
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
    const existing = row && typeof row.subscription === 'object' ? row.subscription : {};
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
          categoryRowsCapped ? 'Category lookups were capped at ten issues per refresh.' : '',
          !catalogComplete ? 'IPO list reached its 200-issue per-board cap.' : '',
        ]
            .filter(Boolean)
            .join(' ')
      : 'Live IPO feed and category subscription fields are enabled.'
    : `IPO Guru ${plan || 'unknown'} plan supplies IPO details/GMP; category-wise subscription requires Standard or higher.${plan === 'free' ? ' Free-plan feed is cached for up to three hours to respect its daily request quota.' : ''}${!catalogComplete ? ' IPO list reached its 200-issue per-board cap.' : ''}`;
  const cacheTtlMs = Object.prototype.hasOwnProperty.call(IPO_GURU_PLAN_CACHE_MS, plan)
    ? IPO_GURU_PLAN_CACHE_MS[plan]
    : SERVER_CACHE_MS;
  const source = {
    id: 'ipoguru',
    name: 'IPO Guru (category-wise subscription)',
    status,
    recordCount: records.length,
    note,
    plan: plan || undefined,
    updatedAt: new Date().toISOString(),
    url: 'https://www.ipoguru.in/ipo-gmp-details-developer-api',
  };
  return {
    records,
    catalogComplete,
    cacheTtlMs,
    source,
  };
}

function needsSubscriptionRefresh(row) {
  const status = String(row.status || '').toLowerCase();
  if (status === 'open') return true;
  if (status !== 'closed') return false;
  const closeDate = new Date(`${row.close_date || ''}T00:00:00Z`);
  if (Number.isNaN(closeDate.getTime())) return false;
  const age = Date.now() - closeDate.getTime();
  return age >= -24 * 60 * 60 * 1000 && age <= 7 * 24 * 60 * 60 * 1000;
}

async function requestJson(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Provider returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const message = payload.detail || payload.message || payload.error || `HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function safeMessage(error) {
  if (!error) return 'Unknown provider error.';
  const message = error instanceof Error ? error.message : String(error);
  // Never pass credentials or full request URLs into logs / user-facing responses.
  return message.replace(/(x-api-key|api[_-]?key|token)[=: ]+[^ ,;]+/gi, '$1=[redacted]').slice(0, 240);
}
