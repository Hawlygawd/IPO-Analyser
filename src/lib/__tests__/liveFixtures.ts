/**
 * Trimmed copies of the real upstream markup, shared by the unit tests and the web smoke
 * test's live mode. Same classes, same data-* attributes, same timestamps as the pages the
 * probe-source workflow captured - so a change in what the parsers expect shows up here.
 */

/* ----------------------------------------------------------------- fixtures */

export const GMP_HTML = `
<div class="gmp-summary">As of 14 Sep 2026, 5:30 PM IST, 19 of 35 tracked Mainboard &amp; SME IPOs have a recorded premium.</div>
<table class="gmp-table" id="gmpTable">
  <tbody>
    <tr class="gmp-row" data-type="mainboard" data-status="open" data-hasgmp="true"
        data-gmp="22" data-pct="16"
        data-indicative="162" data-name="Veegaland Developers"
        data-rowurl="/ipo-gmp/veegaland-developers-ipo">
      <td class="gmp-col-name" data-label="IPO">
        <a class="gmp-ipo-link" href="/ipo/veegaland-developers-ipo">Veegaland Developers IPO</a>
        <span class="gmp-mobile-meta">
          <span class="gmp-type-badge gmp-type-mainboard">Mainboard</span>
          <span class="gmp-status gmp-status-open">Open</span>
        </span>
      </td>
      <td data-label="Type"><span class="gmp-type-badge gmp-type-mainboard">Mainboard</span></td>
      <td class="gmp-num" data-label="Price Band">₹130-140</td>
      <td class="gmp-num gmp-pos" data-label="GMP" title="Veegaland Developers IPO GMP: ₹22"><a class="gmp-value-link" href="/ipo-gmp/veegaland-developers-ipo">+₹22<span class="gmp-mobile-pct"> (+16%)</span></a></td>
      <td class="gmp-num gmp-pos" data-label="GMP %">+16%</td>
      <td class="gmp-num" data-label="Indicative Listing">₹162</td>
      <td class="gmp-secondary" data-label="Open – Close"><span class="gmp-dates">Sep 10, 2026 – Sep 15, 2026</span></td>
      <td data-label="Status"><span class="gmp-status gmp-status-open">Open</span></td>
      <td class="gmp-secondary" data-label="Last Updated"><time class="gmp-updated-time" datetime="2026-09-14T12:00:00.000Z">14 Sep 2026, 5:30 PM IST</time></td>
    </tr>
    <tr class="gmp-row gmp-row-nogmp" data-type="sme" data-status="open" data-hasgmp="false"
        data-gmp="" data-pct=""
        data-indicative="" data-name="Om Galaxy"
        data-rowurl="/ipo/om-galaxy-ipo">
      <td class="gmp-col-name" data-label="IPO">
        <a class="gmp-ipo-link" href="/ipo/om-galaxy-ipo">Om Galaxy IPO</a>
        <span class="gmp-mobile-meta">
          <span class="gmp-type-badge gmp-type-bse-sme">BSE SME</span>
          <span class="gmp-status gmp-status-open">Open</span>
        </span>
      </td>
      <td data-label="Type"><span class="gmp-type-badge gmp-type-bse-sme">BSE SME</span></td>
      <td class="gmp-num" data-label="Price Band">₹85-90</td>
      <td class="gmp-num gmp-na" data-label="GMP"><span class="gmp-na" title="GMP not available yet">—</span></td>
      <td class="gmp-num gmp-na" data-label="GMP %"><span class="gmp-na">—</span></td>
      <td class="gmp-num" data-label="Indicative Listing"><span class="gmp-na">—</span></td>
      <td class="gmp-secondary" data-label="Open – Close"><span class="gmp-dates">Sep 10, 2026 – Sep 15, 2026</span></td>
      <td data-label="Status"><span class="gmp-status gmp-status-open">Open</span></td>
      <td class="gmp-secondary" data-label="Last Updated"><span class="gmp-na">—</span></td>
    </tr>
    <tr class="gmp-row gmp-row-nogmp" data-type="sme" data-status="closed" data-hasgmp="false"
        data-gmp="" data-pct="" data-indicative="" data-name="Legacy Wires"
        data-rowurl="/ipo/legacy-wires-ipo">
      <td class="gmp-col-name" data-label="IPO"><a class="gmp-ipo-link" href="/ipo/legacy-wires-ipo">Legacy Wires IPO</a></td>
      <td data-label="Type"><span class="gmp-type-badge gmp-type-nse-sme">NSE SME</span></td>
      <td class="gmp-num" data-label="Price Band">₹100-105</td>
      <td class="gmp-num gmp-na" data-label="GMP"><span class="gmp-na">—</span></td>
      <td class="gmp-num gmp-na" data-label="GMP %"><span class="gmp-na">—</span></td>
      <td class="gmp-num" data-label="Indicative Listing"><span class="gmp-na">—</span></td>
      <td class="gmp-secondary" data-label="Open – Close"><span class="gmp-dates">Sep 01, 2026 – Sep 04, 2026</span></td>
      <td data-label="Status"><span class="gmp-status gmp-status-closed">Closed</span></td>
      <td class="gmp-secondary" data-label="Last Updated"><span class="gmp-na">—</span></td>
    </tr>
  </tbody>
</table>
`;

export const SUBSCRIPTION_HTML = `
<table class="subs-overview-table subs-data-table" aria-labelledby="live-ipo-overview-heading">
  <thead><tr><th scope="col">IPO</th><th scope="col">Type</th><th scope="col">Close Date</th>
    <th scope="col" class="text-center">QIB</th><th scope="col" class="text-center">NII</th>
    <th scope="col" class="text-center">Retail / Individual</th><th scope="col" class="text-center">Total</th>
    <th scope="col" class="text-center">Applications (approx.)</th><th scope="col" class="subs-overview-updated-col">Updated</th></tr>
  </thead>
  <tbody>
    <tr>
      <td class="subs-overview-name">
        <div class="subs-overview-name-cell"><div class="subs-overview-name-top">
          <a href="/ipo-subscription/veegaland-developers-ipo" class="subs-overview-ipo-link">
            <span class="subs-overview-ipo-titlerow">
              <span class="subs-overview-ipo-title">Veegaland Developers</span>
              <span class="badge_span subs-status-badge subs-status-badge--sm" data-role="status" style="background-color:var(--badge-status-live-bg);color:var(--badge-status-live-text);">
                <i class="fa-solid fa-circle" aria-hidden="true"></i> Live
              </span>
            </span>
            <span class="subs-overview-ipo-suffix">IPO subscription status</span>
          </a>
        </div></div>
      </td>
      <td class="subs-overview-type"><span class="badge_span" data-role="type" data-ipotype="Mainboard">Mainboard</span></td>
      <td class="subs-overview-date">Sep 15, 2026</td>
      <td class="text-center subs-overview-mult">0.61x</td>
      <td class="text-center subs-overview-mult">1.44x</td>
      <td class="text-center subs-overview-mult">2.02x</td>
      <td class="text-center subs-overview-mult subs-overview-mult--total"><span class="subs-overview-total-val">2.41x</span></td>
      <td class="subs-overview-apps" title="Approx. 92,318 total applications received">92,318</td>
      <td class="subs-overview-updated"><time datetime="2026-09-14T11:45:00+05:30">14 Sep 2026, 11:45 AM</time></td>
    </tr>
    <tr>
      <td class="subs-overview-name">
        <div class="subs-overview-name-cell"><div class="subs-overview-name-top">
          <a href="/ipo-subscription/manipal-payment-and-identity-ipo" class="subs-overview-ipo-link">
            <span class="subs-overview-ipo-titlerow">
              <span class="subs-overview-ipo-title">Manipal Payment &amp; Identity</span>
            </span>
          </a>
        </div></div>
      </td>
      <td class="subs-overview-type"><span class="badge_span" data-role="type" data-ipotype="NSE">NSE</span></td>
      <td class="subs-overview-date">Sep 11, 2026</td>
      <td class="text-center subs-overview-mult">1.77x</td>
      <td class="text-center subs-overview-mult">1.31x</td>
      <td class="text-center subs-overview-mult">1.25x</td>
      <td class="text-center subs-overview-mult subs-overview-mult--total"><span class="subs-overview-total-val">1.54x</span></td>
      <td class="subs-overview-apps" title="Approx. 410,552 total applications received">410,552</td>
      <td class="subs-overview-updated"><time datetime="2026-09-12T10:15:00+05:30">12 Sep 2026, 10:15 AM</time></td>
    </tr>
  </tbody>
</table>
`;

export const CARDS_HTML = `
<article class="card ipo-card ipo-card-new mb-0 "
  id="ipo-card-ipo-list-hero-motors-ipo"
  data-agent-href="/ipo/hero-motors-ipo"
  data-ipo-status="current"
  data-ipo-board="mainboard">
  <header class="ipo-card-header">
    <div class="ipo-card-header-middle">
      <h3 class="ipo-card-name" title="Hero Motors Limited IPO">Hero Motors</h3>
      <div class="ipo-card-date"><time datetime="2026-09-16">Sep 16, 2026</time> – <time datetime="2026-09-18">Sep 18, 2026</time></div>
    </div>
    <div class="ipo-card-header-right"><span class="ipo-card-market-badge" data-ipotype="Mainboard">Mainboard</span></div>
  </header>
  <div class="card-body"><div class="ipo-card-body-top-row">
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Exp. Premium</span>
      <span class="ipo-card-body-value " style="color: green;">₹24 <small>(16%)</small></span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Offer Price</span>
      <span class="ipo-card-body-value">₹145-153</span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Lot Size</span>
      <span class="ipo-card-body-value">98</span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Subscription</span>
      <span class="ipo-card-body-value">
        2.35x
      </span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Issue Size</span>
      <span class="ipo-card-body-value ipo-card-issue-size">₹1,250 Cr</span>
    </div>
  </div></div>
</article>

<article class="card ipo-card ipo-card-new mb-0 "
  id="ipo-card-ipo-list-veritas-finance-ipo"
  data-agent-href="/ipo/veritas-finance-ipo"
  data-ipo-status="current"
  data-ipo-board="sme">
  <header class="ipo-card-header">
    <div class="ipo-card-header-middle">
      <h3 class="ipo-card-name" title="Veritas Finance Limited IPO">Veritas Finance</h3>
      <div class="ipo-card-date">
        <time datetime="2050-01-01">TBA</time> – <time datetime="2050-01-01">TBA</time>
      </div>
    </div>
    <div class="ipo-card-header-right">
      <span class="ipo-card-market-badge" data-ipotype="BSE, NSE">BSE, NSE</span>
    </div>
  </header>
  <div class="card-body"><div class="ipo-card-body-top-row">
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Offer Price</span>
      <span class="ipo-card-body-value">₹N/A</span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Lot Size</span>
      <span class="ipo-card-body-value">N/A</span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Issue Size</span>
      <span class="ipo-card-body-value ipo-card-issue-size">₹3,500–4,500 Cr Approx</span>
    </div>
  </div></div>
</article>

<article class="card ipo-card ipo-card-new mb-0 "
  data-agent-href="/ipo/jio-platforms-ipo"
  data-ipo-status="upcoming"
  data-ipo-board="mainboard">
  <header class="ipo-card-header">
    <div class="ipo-card-header-middle">
      <h3 class="ipo-card-name">Jio Platforms</h3>
      <div class="ipo-card-date"><time datetime="2026-09-24">Sep 24, 2026</time> – <time datetime="2026-09-28">Sep 28, 2026</time></div>
    </div>
  </header>
  <div class="card-body"><div class="ipo-card-body-top-row">
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Offer Price</span>
      <span class="ipo-card-body-value">₹1,180-1,240</span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Lot Size</span>
      <span class="ipo-card-body-value">12</span>
    </div>
    <div class="ipo-card-body-stat">
      <span class="ipo-card-secondary-label">Issue Size</span>
      <span class="ipo-card-body-value ipo-card-issue-size">₹12,000 Cr</span>
    </div>
  </div></div>
</article>
`;

export const CALENDAR_JSON = `eventListData = [{"date":"2026-09-14","events":[{"name":"Ganesh Chaturthi","board":"Monday","url":null,"status":"HOLIDAY","statusLabel":"HOLIDAY"}]},{"date":"2026-09-17","events":[{"name":"Veegaland Developers","board":"Mainboard","slug":"veegaland-developers-ipo","url":"https://www.ipoji.com/ipo/veegaland-developers-ipo","status":"ALLOTMENT","statusLabel":"ALLOTMENT"},{"name":"Legacy Wires","board":"NSE SME","slug":"legacy-wires-ipo","url":"https://www.ipoji.com/ipo/legacy-wires-ipo","status":"LISTING","statusLabel":"LISTING"}]}];`;

export const CALENDAR_HTML = `<html><body><script>const other = 1;\n        ${CALENDAR_JSON}\n        window.eventListData = eventListData;</script></body></html>`;

export const livePageFixtures = {
  gmp: GMP_HTML,
  subscription: SUBSCRIPTION_HTML,
  current: CARDS_HTML,
  calendar: CALENDAR_HTML,
};
