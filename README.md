# IPO Pulse

An Expo (React Native + web) app for following the Indian IPO board: grey market premium,
category-wise subscription, the four dates that decide everything, and a plain-language read on
each issue — plus reminders so a subscription window never slips past.

## What it does

| Screen | What it gives you |
| --- | --- |
| **IPOs** | The board split into *Open / Soon / Closed*, summary tiles (bidding now, opening soon, premium ≥ 12%), sortable lists (closing next, top premium, issue size, A–Z) and a per-card read of price band, premium, subscription, minimum lot and derived demand. |
| **Watchlist** | Everything you have starred, ordered by the next key date, with the next event up top and the number of queued reminders. |
| **GMP board** | Every issue ranked by grey market premium with segment filters, "quoted only" / "premium ≥ 12%" toggles, full-text search and a per-row premium bar. |
| **IPO detail** | Price ladder (band vs implied listing price), demand score with the reasons behind it, a lot-size calculator with the ₹2 lakh retail limit, category-wise subscription bars with the 1.00x marker, key-date timeline, issue facts and the source of every figure. |
| **Reminder log** | The reminders this app queued or delivered, plus the plan that will fire next. |
| **Settings** | System/light/dark theme, per-milestone reminder switches, data freshness and provenance, source links, and on-device data controls. |

## Honesty about the data

The board is a **dated snapshot**, not a live feed. Everything shown is what the tracker published
at the snapshot time, and the app says so instead of implying real-time data:

- `DATA_AS_OF` in `src/lib/ipoData.ts` stamps the snapshot; the header and Settings show it, and a
  banner appears once the snapshot is a few days old.
- Each issue carries its own `gmpUpdated` timestamp, shown per row on the GMP board.
- There is no invented premium history: the app shows the recorded quote, the implied listing
  price and a **demand score** computed from that quote and the published subscription multiples.
- Unconfirmed dates are marked `tentative` in the timeline, and the UI never claims to predict a
  listing price.

## Running it

```bash
npm install
npm run web          # dev server (or: npm start, npm run ios, npm run android)
```

Quality gates:

```bash
npm run typecheck    # strict TS, app config + node config for scripts/tests
npm test             # 47 unit tests (tsx --test): data integrity, formatting, analysis, board, reminders
npm run board        # prints the board as the app sees it (npm run board -- gmp for the ranking)
npm run build:web    # static web export into dist/
npm run smoke        # renders dist/ in jsdom and clicks through the app
```

`npm run smoke` is the end-to-end check: it mounts the exported bundle, then walks the board →
detail screen → lot stepper → watch toggle → GMP board (filters + search) → watchlist → settings
(including a dark-theme repaint), asserting on the rendered DOM and failing on any console error.

## Architecture

```
App.tsx                     navigation shell, theme wiring, error boundary, toast host
src/theme.ts                light/dark palettes (WCAG AA checked), radii, shadows
src/lib/
  types.ts                  IPO, Segment, Platform, SubscriptionSplit, reminder prefs
  ipoData.ts                the curated snapshot + lookups (the only file to touch when refreshing)
  format.ts                 dates, money, percentages, GMP/lot maths, IST formatting
  analysis.ts               phases, milestones, gmpSignal, demand score, insights, data freshness
  board.ts                  bucketing, sorting, search/filters, board statistics
  reminders.ts              pure reminder planning (no platform imports — unit tested)
  notifications.ts          expo-notifications glue, lazily loaded on iOS/Android only
  store.tsx                 watchlist, prefs, alerts, theme, toasts, persistence
src/components/             UI kit (ui.tsx), charts, IPO card, timeline, segmented control, header
src/screens/                the six screens listed above
scripts/                    board inspector and the jsdom smoke test
```

### Design notes

- **Reminder planning is pure.** `src/lib/reminders.ts` has no React Native or
  expo-notifications imports, so the schedule is unit testable and the web preview can show the
  exact plan the native build would fire.
- **Notifications load lazily** (`src/lib/notifications.ts`) so the web bundle never pulls in the
  push shim.
- **The icon font cannot block the UI.** `useIconFontReady()` in `App.tsx` renders the app after a
  short grace period even if the font never resolves.
- **Accessibility:** controls are real buttons with labels and states, chips/tabs expose selection,
  the meter is a progressbar, and every colour clears WCAG AA on both its card and its soft tint.
- **No network calls at runtime.** The snapshot ships with the app; nothing is fetched in the
  background.

## Refreshing the snapshot

1. Pull current figures (IPO Ji's GMP board, live subscription report and event calendar are what
   this snapshot uses: <https://www.ipoji.com/ipo-gmp>).
2. Update `DATA_AS_OF` / `DATA_AS_OF_LABEL` and the rows in `src/lib/ipoData.ts`, keeping each
   row's `gmpUpdated` timestamp.
3. Run `npm test` (data integrity is asserted: date ordering, unique ids, platform/segment
   consistency, https sources) and `npm run board` to eyeball the result.

## Disclaimer

Grey market premiums are unofficial and unregulated, sourced from public trackers, and can change
without notice. Nothing in this app is investment advice — read the RHP and consider a
SEBI-registered adviser.
