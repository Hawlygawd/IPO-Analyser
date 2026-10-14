# IPO Pulse / IPO Analyser

Expo + React Native app for India IPO dates, subscription status, GMP context, reminders, and a locally saved watchlist.

## Live data

The app no longer treats the bundled IPO list as live data. It loads a feed on launch, on pull-to-refresh, and periodically while the app is foregrounded. The last successful feed is cached locally so the board and starred IPOs remain available offline.

The Vercel function at `api/ipoFeed.js` combines two independent providers:

- **IPOAlerts** — lifecycle data aggregated from public exchange/registrar sources. Its authenticated endpoint is needed for full listings and pagination.
- **IPO Guru** — secondary IPO feed with QIB, NII, Retail, and other category subscription fields when available.

For full coverage, set these as **server-side Vercel environment variables** (Project Settings → Environment Variables):

- `IPOALERTS_API_KEY` — required for complete IPOAlerts results.
- `IPOGURU_API_KEY` — enables the second feed. IPO Guru's **Standard or higher** plan is required for its category-wise subscription endpoint; lower plans can still supply IPO details and current GMP.
- `IPOALERTS_INCLUDE_GMP=true` — optional; only enable if the configured IPOAlerts plan includes its GMP add-on.

IPO Guru requires visible attribution wherever its data appears. The app labels category data and links the IPO Guru source from the IPO, GMP-board, and detail views when those records are supplied.

The keys are read only by the serverless function. Do not put them in `EXPO_PUBLIC_*`, the mobile bundle, or Git. `npm run build` exports the web app to `dist`; Vercel also deploys `api/ipoFeed.js` as the same-origin serverless feed at `/api/ipoFeed`. For a native build, copy `.env.example` to `.env` and set `EXPO_PUBLIC_IPO_API_URL` to the full deployed function URL, for example `https://your-app.vercel.app/api/ipoFeed`.

Without a server-side key, the public IPOAlerts preview can return at most one IPO per lifecycle status. The app labels that result **Preview / Limited** rather than claiming it is a complete board. A subscription total is never presented as a category split: if QIB/NII/Retail data is not supplied, the detail screen labels it **Overall only**. Configure IPO Guru to receive category-wise figures where published.

## Persistence and refresh behavior

- Watchlist changes are serialized and awaited before reminder scheduling starts.
- The last IPO feed is cached alongside the watchlist, so the saved IDs can still resolve after app restart or a provider refresh.
- Refresh keeps cached data on network failure; it does not replace it with an empty/error response.
- Existing scheduled notification IDs are reconciled on startup and after feed updates to avoid duplicate reminders.
- GMP history is only charted when actual observations are provided; the app does not fabricate trend values.

## Data limitations

GMP is unofficial and speculative. IPO dates can change; verify dates, price bands, and subscription totals against NSE/BSE notices and the issuer's RHP before acting. This app is informational only, not investment advice.
