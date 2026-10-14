# IPO Pulse / IPO Analyser

Expo + React Native app for Indian IPO dates, subscription status, grey-market context, reminders, and a locally saved watchlist.

## Live data and source strategy

The app fetches the first-party feed from the user's internet connection: web builds call the same-origin `/api/ipoFeed`; iOS/Android builds must set `EXPO_PUBLIC_IPO_API_URL` to the deployed feed URL. The serverless function fetches upstream sites and keeps provider credentials server-side, avoiding browser CORS failures and secret keys in the app bundle. Refresh runs on launch, pull-to-refresh, and periodically while the app is foregrounded. The last usable live catalogue is saved locally for offline use.

The feed combines primary exchange information with optional aggregators:

- **NSE India public website** — current and forthcoming issues, plus a best-effort recent past-issues lookback (up to 365 days). Category subscription lookups are capped at 10 active issues per refresh.
- **BSE India public-issues website** — useful for BSE SME and BSE-only issues, with category lookups capped at 10 live issues per refresh.
- **IPOAlerts** — optional authenticated cross-check for lifecycle details and, if the account includes the add-on, GMP.
- **IPO Guru** — optional second aggregator for issue details/GMP and category-wise subscription when the account plan allows it. Standard or higher is required by its current subscription endpoint; category lookups are capped at 10 issues per refresh.

For issue terms and live category bidding, NSE/BSE are the appropriate primary sources. **IPO Ji is a private tracking platform, not an official exchange or SEBI source**; in this repository it appears only in the dated bundled fallback and is not queried by the live feed. SEBI is the official source for regulatory offer-document filings (DRHP/RHP/prospectus), not a live subscription feed; the app links its [public-issues filings index](https://www.sebi.gov.in/filings/public-issues.html) for document checks. For allotment outcomes, the IPO's named registrar and exchange notices are authoritative checks; registrar pages are issue-specific and are not represented here as a universal live catalogue. GMP has no official exchange source.

The NSE/BSE sources above are **official exchange websites, but the JSON routes used by this app are undocumented website endpoints, not guaranteed public APIs**. They can be blocked, change response shape, or stop working without notice. Their current availability has not been verified against a live deployment. IPOAlerts/IPO Guru are alternatives and cross-checks, not proof of complete coverage. The API deliberately reports `completeness: limited` rather than claiming that a paid plan or a successful request yields a complete IPO history. Compare important facts with the linked exchange notice, offer document/RHP, and registrar notice.

When two connected feeds disagree on confirmed timeline dates or price band, the IPO detail page flags the disagreement and links each contributing source. Exchange rows are applied after aggregator rows for primary issue facts; GMP remains unofficial and is only supplied by providers that report it. Missing allotment/listing dates may be shown as tentative estimates; verify them before acting. Subscription categories are displayed only when supplied—an overall total is never relabelled as QIB/NII/Retail.

## Deployment configuration

Deploy `api/ipoFeed.js` as a Vercel serverless function at `/api/ipoFeed`. Set these in Vercel Project Settings → Environment Variables (or in the server process for local API testing):

- `IPOALERTS_API_KEY` — optional authenticated aggregator. Without a key, IPOAlerts is marked **Not configured**; the app does not call an anonymous IPOAlerts preview endpoint.
- `IPOALERTS_PLAN` — optional; defaults conservatively to `free`. Set it to the plan actually subscribed to (`free`, `basic`, `standard`, `pro`, or `enterprise`) so the handler can request the configured lifecycle filters and cache duration; confirm the account includes those endpoints. Unknown values fall back to `free`. Free mode requests only the open lifecycle with one result. Non-free requests are still capped at three pages per lifecycle.
- `IPOGURU_API_KEY` — optional second aggregator. IPO Guru's Standard-or-higher plan is required for its category-wise subscription endpoint. Free provider data is cached for up to three hours; actual cache windows depend on the detected/configured plan.
- `IPOALERTS_INCLUDE_GMP=true` — optional, only if the IPOAlerts account includes its separately billed GMP add-on.

Keep these keys on the server; **never** put them in `EXPO_PUBLIC_*`, the mobile bundle, or Git. `.env.example` documents the public native-app endpoint variable only.

For native builds, set `EXPO_PUBLIC_IPO_API_URL` to the deployed function URL, e.g. `https://your-app.vercel.app/api/ipoFeed`. Web builds use same-origin `/api/ipoFeed` automatically. Without a deployed/configured endpoint, native builds show a clear connection error and retain cached data; the client does not silently bypass the proxy with direct third-party requests.

## Local checks

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
```

`npm test` runs mocked NSE/BSE endpoint and normalization tests; it does not verify that live exchange endpoints or a Vercel deployment are currently reachable. `npm run build` exports the web app to `dist`.

## Persistence and refresh behavior

- Watchlist, notification preferences, reminders, source status, and the live IPO cache are stored locally.
- Bundled IPO data is an offline fallback, not a live feed. Once usable live rows arrive, unverified bundled entries are removed from the live board except those the user explicitly watches; an empty/unparseable response leaves the previous board intact and raises a warning.
- A failed refresh leaves the last usable cache and watchlist untouched.
- Refreshes are serialized; scheduled notification IDs are reconciled after data updates to avoid duplicate reminders.
- GMP history is charted only when dated source observations are supplied; no trend points are fabricated.

## Data limitations

NSE/BSE website routes are best-effort and may return incomplete/empty results; NSE history is bounded to 365 days and subscription lookups to 10 issues per exchange per refresh. IPO Guru category lookups are also capped. Some provider plans restrict lifecycle or historical coverage, and source disagreements are not automatically resolved as fact. Grey-market premiums are unofficial and speculative. Verify issue dates, price bands, subscription figures, and allotment/listing information against current exchange notices and the issuer's RHP. This app is informational only, not investment advice.
