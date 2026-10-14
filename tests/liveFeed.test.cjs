const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const api = require(path.join(root, 'api/ipoFeed.js'));
const sourceModule = loadTypeScript(path.join(root, 'src/lib/ipoSources.ts'));

function loadTypeScript(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(output, filename);
  return compiled.exports;
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function exchangeFetchMock() {
  return async (request) => {
    const url = String(request);
    if (url === 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo') {
      return new Response('<html>session</html>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'set-cookie': 'nse-session=test; Path=/' },
      });
    }
    if (url.includes('/ipo-current-issue')) {
      return jsonResponse([
        {
          companyName: 'Northstar Foods Limited',
          symbol: 'NSTAR',
          issueStartDate: '13-Oct-2026',
          issueEndDate: '17-Oct-2026',
          allotmentDate: '20-Oct-2026',
          listingDate: '23-Oct-2026',
          priceRange: '₹100 - 110',
          lotSize: 120,
          status: 'open',
          series: 'EQ',
        },
      ]);
    }
    if (url.includes('/all-upcoming-issues')) return jsonResponse([]);
    if (url.includes('/public-past-issues')) return jsonResponse([]);
    if (url.includes('/ipo-active-category')) {
      return jsonResponse({ Table: [
        { category: 'QIB', noOfTotalMeant: '2.50' },
        { category: 'Retail', noOfTotalMeant: '1.75' },
      ] });
    }
    if (url.includes('GetPublicIssue_par_updated')) {
      return jsonResponse([
        {
          LONG_NAME: 'Northstar Foods Ltd.',
          Scrip_Name: 'NSTAR',
          IPO_NO: 9123,
          Start_Dt: '14-Oct-2026',
          End_Dt: '18-Oct-2026',
          Allotment_Dt: '21-Oct-2026',
          Listing_Dt: '24-Oct-2026',
          Price_Band: '₹105 - 115',
          Status: 'L',
          IR_flag: 'IPO',
          eXCHANGE_PLATFORM: 'BSE SME',
        },
      ]);
    }
    if (url.includes('Pubissues_GetBkbldgCatdem')) {
      return jsonResponse([
        { col2: 'QIB', col5: '2.35' },
        { col2: 'NII', col5: '3.10' },
        { col2: 'Retail', col5: '1.80' },
      ]);
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
}

test('NSE and BSE public exchange feeds normalize, attribute and flag conflicting facts', async () => {
  const previousFetch = global.fetch;
  global.fetch = exchangeFetchMock();
  try {
    const nse = await api.collectNse();
    const bse = await api.collectBse();
    assert.equal(nse.source.status, 'ok');
    assert.equal(bse.source.status, 'ok');
    assert.equal(nse.records.length, 1);
    assert.equal(bse.records.length, 1);
    assert.equal(nse.records[0].subscription.qib, 2.5);
    assert.equal(bse.records[0].subscription.nii, 3.1);

    const feed = sourceModule.normalizeRawFeed({
      records: {
        nse: nse.records,
        bse: bse.records,
        ipoAlerts: [{
          name: 'Northstar Foods Limited',
          startDate: '2026-10-13',
          endDate: '2026-10-17',
          allotmentDate: '2026-10-20',
          listingDate: '2026-10-23',
          priceRange: '₹100 - 110',
          prospectusUrl: 'https://example.test/northstar-rhp.pdf',
          about: 'Northstar Foods supplies packaged food products across India.',
        }],
        ipoGuru: [],
      },
      sources: [nse.source, bse.source],
      completeness: 'limited',
      fetchedAt: '2026-10-14T10:00:00.000Z',
    });
    assert.equal(feed.isFresh, true);
    assert.equal(feed.completeness, 'limited');
    assert.equal(feed.ipos.length, 1);
    const ipo = feed.ipos[0];
    assert.deepEqual([...ipo.exchanges].sort(), ['BSE SME', 'NSE'].sort());
    assert.equal(ipo.priceBandLow, 100, 'NSE facts take precedence in the normalized display');
    assert.equal(ipo.subscription.qib, 2.5);
    assert.equal(ipo.subscription.nii, 3.1);
    assert.equal(ipo.prospectusUrl, 'https://example.test/northstar-rhp.pdf');
    assert.equal(ipo.about, 'Northstar Foods supplies packaged food products across India.');
    assert.ok(ipo.sources.some((source) => source.name.startsWith('IPOAlerts')));
    assert.ok(ipo.sources.some((source) => source.name.startsWith('NSE India')));
    assert.ok(ipo.sources.some((source) => source.name.startsWith('BSE India')));
    assert.ok(ipo.sourceConflicts.some((message) => message.includes('opening date')));
    assert.ok(ipo.sourceConflicts.some((message) => message.includes('price band')));
    assert.ok(feed.warnings.some((warning) => warning.includes('Source disagreement')));

    const oneSource = sourceModule.normalizeRawFeed({
      records: { nse: nse.records, bse: [], ipoAlerts: [], ipoGuru: [] },
      sources: [nse.source],
      completeness: 'limited',
    }).ipos[0];
    assert.equal(oneSource.sourceConflicts, undefined);
    assert.ok(sourceModule.mergeIpo(ipo, oneSource).sourceConflicts.length > 0, 'one responding source cannot clear an older disagreement');

    const matchingBseRow = {
      ...bse.records[0],
      Start_Dt: '13-Oct-2026',
      End_Dt: '17-Oct-2026',
      Price_Band: '₹100 - 110',
      Allotment_Dt: '20-Oct-2026',
      Listing_Dt: '23-Oct-2026',
    };
    const agreeing = sourceModule.normalizeRawFeed({
      records: { nse: nse.records, bse: [matchingBseRow], ipoAlerts: [], ipoGuru: [] },
      sources: [nse.source, bse.source],
      completeness: 'limited',
    }).ipos[0];
    assert.deepEqual(agreeing.sourceConflicts, []);
    assert.deepEqual(sourceModule.mergeIpo(ipo, agreeing).sourceConflicts, [], 'a new two-source agreement clears the old warning');
  } finally {
    global.fetch = previousFetch;
  }
});

test('feed endpoint combines public exchanges without requiring paid provider keys', async () => {
  const previousFetch = global.fetch;
  const envKeys = ['IPOALERTS_API_KEY', 'IPOALERTS_PLAN', 'IPOGURU_API_KEY', 'IPOALERTS_INCLUDE_GMP'];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  envKeys.forEach((key) => delete process.env[key]);
  global.fetch = exchangeFetchMock();
  api.resetCachesForTests();

  const response = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
  try {
    await api({ method: 'GET' }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.completeness, 'limited');
    assert.equal(response.body.records.nse.length, 1);
    assert.equal(response.body.records.bse.length, 1);
    assert.deepEqual(
      response.body.sources.map((source) => source.id),
      ['nse', 'bse', 'ipoalerts', 'ipoguru']
    );
    assert.equal(response.body.sources.find((source) => source.id === 'ipoalerts').status, 'unconfigured');
    assert.ok(response.body.warnings.some((warning) => warning.includes('best-effort') || warning.includes('not a guaranteed')));
  } finally {
    global.fetch = previousFetch;
    envKeys.forEach((key) => {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    });
    api.resetCachesForTests();
  }
});

test('valid feed responses with provider errors preserve source details for the UI', async () => {
  const previousUrl = process.env.EXPO_PUBLIC_IPO_API_URL;
  const previousFetch = global.fetch;
  process.env.EXPO_PUBLIC_IPO_API_URL = 'https://feed.example.test/api/ipoFeed';
  global.fetch = async () => jsonResponse({
    records: { nse: [], bse: [], ipoAlerts: [], ipoGuru: [] },
    sources: [{ id: 'nse', name: 'NSE India', status: 'error', recordCount: 0, note: 'Mock outage' }],
    completeness: 'limited',
    warnings: ['NSE mock failure'],
  });
  try {
    const feed = await sourceModule.fetchLiveIpoFeed();
    assert.equal(feed.isFresh, false);
    assert.equal(feed.sources[0].status, 'error');
    assert.equal(feed.warnings[0], 'NSE mock failure');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_IPO_API_URL;
    else process.env.EXPO_PUBLIC_IPO_API_URL = previousUrl;
  }
});

test('native builds fail clearly when no first-party feed endpoint is configured', async () => {
  const previousUrl = process.env.EXPO_PUBLIC_IPO_API_URL;
  const previousFetch = global.fetch;
  let requestCount = 0;
  delete process.env.EXPO_PUBLIC_IPO_API_URL;
  global.fetch = async () => { requestCount += 1; throw new Error('should not make an anonymous provider request'); };
  try {
    await assert.rejects(sourceModule.fetchLiveIpoFeed(), /Live IPO endpoint is not configured/);
    assert.equal(requestCount, 0);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_IPO_API_URL;
    else process.env.EXPO_PUBLIC_IPO_API_URL = previousUrl;
  }
});
