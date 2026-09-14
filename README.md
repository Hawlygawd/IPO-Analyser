# IPO Pulse

An Expo (React Native + web) app for following the Indian IPO board: grey market premium,
category-wise subscription, the four dates that decide everything, and a plain-language read on
each issue — plus reminders so a subscription window never slips past.

Pull down on any board and the app fetches the live pages (IPO Ji's GMP board, live subscription
report, current/upcoming issues and the event calendar), parses them and merges the numbers over
the bundled snapshot. No connection, no problem: it falls back to the snapshot and says so.

## What it does

| Screen | What it gives you |
| --- | --- |
| **IPOs** | The board split into *Open / Soon / Closed*, summary tiles (bidding now, opening soon, premium ≥ 12%), sortable lists (closing next, top premium, issue size, A–Z) and a per-card read of price band, premium, subscription, minimum lot and derived demand. |
| **Watchlist** | Everything you have starred, ordered by the next key date, with the next event up top and the number of queued reminders. |
| **GMP board** | Every issue ranked by grey market premium with segment filters, "quoted only" / "premium ≥ 12%" toggles, full-text search and a per-row premium bar. |
| **IPO detail** | Price ladder (band vs implied listing price), demand score with the reasons behind it, a lot-size calculator with the ₹2 lakh retail limit, category-wise subscription bars with the 1.00x marker, key-date timeline, issue facts and the source of every figure. |
| **Reminder log** | The reminders this app queued or delivered, plus the plan that will fire next. |
| **Settings** | System/light/dark theme, per-milestone reminder switches, live-fetch status with a per-source row count, data freshness and provenance, source links, and on-device data controls. |

Every screen's header carries a status chip: **Live • 5:30 PM** when the last pull reached the
boards (with the newest upstream stamp), **Snapshot** when the app is running on bundled data.
Tapping the chip refreshes.

## Install it on Android

The app builds to a standalone APK: the JavaScript bundle and the data snapshot are baked in, so it
runs on a phone with no Metro, no dev server and no network.

**Grab a build:** [Releases](https://github.com/Hawlygawd/IPO-Analyser/releases) - open the page on
the phone, tap the `.apk` under Assets, and allow installs from that source when Android asks.
Android 7.0 (API 24) or newer; the APK carries both 64-bit and 32-bit ARM libraries.

**Check a download:** each release carries the APK's `sha256` next to it
(`sha256sum -c ipo-pulse-<version>.apk.sha256`), and the *Verify APK* workflow downloads the
published asset and
asserts the things that decide whether it installs and starts - both ARM ABIs, the Hermes bundle,
dex code and an `apksigner`-verified signature - then reports into a check run. Trigger it with a
tag (`git tag apk-check-1 && git push origin apk-check-1`); the *Run workflow* buttons in the
Actions tab only appear once these workflows are on the default branch.

**Build a fresh one:** Actions -> *Android APK* -> *Run workflow*. The run produces the APK as an
artifact and, with *publish a GitHub Release* ticked, a public download link. The workflow runs
typecheck + the unit tests before it builds, and takes roughly 10-15 minutes (the first one longer,
while Gradle warms its caches).

**Locally** (needs JDK 17 + the Android SDK, e.g. Android Studio):

```bash
npm install
npm run apk          # prebuild -> prepare sign-off -> gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`.

**With neither GitHub Actions nor an Android SDK**, Expo's cloud builder does the same job from
`eas.json` (needs a free Expo account, and `npx eas-cli login` first):

```bash
npx eas-cli build --platform android --profile preview   # returns an installable APK link
```

### Signing

Android will not install an unsigned APK, so every build is signed:

- **With a key of your own** - add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` as repository secrets, and the release build uses
  that key. Run the workflow once with *generate a signing key* ticked to mint one; the keystore and
  its password come back as the `release-signing-key` artifact, and the log prints the `base64 -w0`
  command for the first secret.
- **Without** - the build keeps the debug key that ships with the Expo template (`android/app/
  debug.keystore`, md5 `4d3dbe5438b4d52b2707d5c039d09afb`). That installs fine when sideloading and
  is stable across builds, but Play Store rejects it, and switching between the two keys means
  uninstalling the app first.

`scripts/android-release.mjs` does the rest of the release plumbing and refuses to continue if a
patch does not apply: it limits the build to the phone ABIs (`arm64-v8a,armeabi-v7a` - override with
`REACT_NATIVE_ARCHITECTURES`), raises the Gradle heap for the Reanimated C++ builds, and points the
release build type at the chosen keystore, detecting JKS vs PKCS#12 from the file's magic bytes.

The generated `android/` folder is not committed - `expo prebuild` recreates it from `app.json`, so
the icon, package name (`com.ipopulse.app`), version and permissions all stay declarative.

## Where the numbers come from

Two layers, in this order:

1. **A live pull.** On launch, on returning to the foreground after 10 minutes, and whenever you
   pull to refresh, `src/lib/live` downloads four public pages with a mobile user agent and parses
   the server-rendered markup:

   | Page | What is read |
   | --- | --- |
   | `/ipo-gmp` | one `tr.gmp-row` per tracked issue: the `data-*` attributes carry the quote, the band, the bidding window and the quote timestamp; a "no quote recorded" row clears a stale premium instead of keeping it |
   | `/ipo-subscription-status-live-bidding-data-bse-nse` | `table.subs-overview-table` rows: QIB / NII / retail / total multiples, applications and the exchange snapshot time |
   | `/ipo/current-ipo`, `/ipo/upcoming-ipo` | `article.ipo-card` blocks: price band, expected premium and the bidding window |
   | `/ipo-event-calendar` | the inline `eventListData = [...]` JSON that drives the calendar: per-day events with status `OPEN` / `CLOSING` / `ALLOTMENT` / `LISTING` / `HOLIDAY` |

   Live rows are matched to the snapshot by upstream slug, then by normalised name, and only the
   fields that page actually published are overwritten. Issues that exist only live (a new SME
   opening, say) are appended - with derived milestone dates still marked tentative - and an issue
   whose dates upstream has not announced yet is left out rather than given a placeholder date
   (those cards print "TBA" over a `2050-01-01` sentinel upstream, which the parser drops).

2. **The bundled snapshot.** `src/lib/ipoData.ts` ships with the app: 35 curated issues, their
   sectors, lot sizes and issue sizes. It renders instantly on launch, survives being offline, and
   fills in everything the live pages do not carry (sector, lot size, issue size, the written
   analysis). `DATA_AS_OF` stamps it, and the app says *Snapshot* rather than pretending.

3. **Your own AI key (optional).** Some networks - and some carriers - cannot reach the boards at
   all, and no amount of parsing fixes a 403. When that happens, and a key has been saved in
   Settings, the same refresh asks an AI model (with live web search where the provider offers it)
   for the current premium and subscription figures and merges whatever survives the plausibility
   checks. The key can be from **any** of the supported providers - Google Gemini, OpenAI, xAI
   (Grok), NVIDIA NIM, Groq, OpenRouter, Anthropic, Mistral, DeepSeek, Together, Perplexity,
   Cerebras, or any OpenAI-compatible endpoint via a custom base URL - and the app works out which
   one it is from the key's own shape, or from a dry check that tries the plausible providers in
   order. Free tiers exist for several of them (Gemini via AI Studio, NVIDIA's 1,000 credits, Groq
   and OpenRouter's free models); Settings links straight to each console.

   Two rules keep this honest. **Published board data always outranks the model**: AI figures are
   written first and every published row then overwrites them field by field, so a live pull is
   never watered down by a model. And **AI-found figures are labelled** - the chip reads `AI •` with
   the provider and model, the callout says where the numbers came from, the affected issues carry a
   "Filled by AI search" row, and the model is never allowed to invent an issue that is not already
   on the board. The key itself is stored on the device (keychain/keystore on iOS and Android) and is
   sent only to the provider you picked.

### Using your own AI key

Settings -> *Live data key (AI assist)*. Paste a key into the one field - it does not matter which
vendor it came from, the app reads the key's shape and, if that is ambiguous, tests the plausible
providers until one accepts it:

| Provider | Key looks like | What you get for free |
| --- | --- | --- |
| Google Gemini | `AIza…` / `AQ.…` | free tier in [AI Studio](https://aistudio.google.com/apikey) |
| OpenAI | `sk-…`, `sk-proj-…` | paid key |
| xAI (Grok) | `xai-…` | free credits on new accounts |
| NVIDIA NIM | `nvapi-…` | 1,000 inference credits from [build.nvidia.com](https://build.nvidia.com) |
| Groq | `gsk_…` | free tier with per-minute limits |
| OpenRouter | `sk-or-…` | many `:free` models |
| Anthropic | `sk-ant-…` | paid key (web builds go through the app's proxy) |
| Mistral / DeepSeek / Together / Perplexity / Cerebras | vendor shapes | free experiment plans where offered |
| Anything else | your own base URL | point the "Other (OpenAI-compatible)" option at it |

Then, in order:

1. **Save key** - stored in the keychain on iOS/Android (device storage on the web build), shown back
   as `Google Gemini • AIza…7f2c` so you can tell which key is in place.
2. **Test this key** - a real request: the model list proves the key authenticates, a one-word prompt
   proves a model answers, and the result names exactly which one (`gemini-2.5-flash-lite`, say) plus
   how long it took. A failing key gets the provider's own message and a plain-language hint (wrong
   key, rate limited, model name retired).
3. **Dry-run a search** - the same search a blocked refresh would run, reported row by row: how many
   issues came back, which rows were dropped as unverifiable, and the newest stamp the model reported.
4. **Refresh with an AI search now**, or just refresh normally: if the boards answer, their figures
   win; if they cannot be read, the model's figures fill in and are labelled as such.

Model names rot faster than app releases, so nothing is hard-coded: the model list decides, a refused
model name is swapped for one the key can actually reach, and a provider that does not support web
search or a search request is retried without it rather than failing.

Honesty is enforced rather than promised:

- The last pull is shown with the **newest upstream stamp** (quote time, not just "now"), so a
  5:30 PM quote and a 12:00 PM quote are never conflated.
- A failed pull never blocks the UI: the previous pull is restored from storage on the next launch,
  and once the bundled snapshot is a few days old a banner says so.
- Settings lists each source with its row count and stamp, so it is obvious which board is stale -
  and names the provider and model when the AI assist answered instead.
- Before you rely on a key there are two dry checks in Settings: **Test this key** proves it
  authenticates and a model actually answers (and reports exactly which one), and **Dry-run a
  search** proves the figures that come back can be parsed and merged. Both are also runnable from
  the terminal/CI with `scripts/ai-key-report.ts`.
- There is no invented premium history: the app shows the recorded quote, the implied listing
  price and a **demand score** computed from that quote and the published subscription multiples.
- Unconfirmed dates are marked `tentative`, and the UI never claims to predict a listing price.

On the web build the browser cannot read ipoji.com directly (no CORS headers), so the web app asks
its own origin instead - `api/ipoji.js` proxies the same four paths when the site is deployed. The
native build fetches them directly; there is no proxy in the middle.

## Running it

```bash
npm install
npm run web          # dev server (or: npm start, npm run ios, npm run android)
```

Quality gates:

```bash
npm run check:deps   # native dependencies must match the versions Expo SDK 57 ships
npm run typecheck    # strict TS, app config + node config for scripts/tests
npm test             # 87 unit tests (tsx --test): data integrity, formatting, analysis, board,
                     # reminders, live parsing + merge, and the AI key layer against fake providers
npm run board        # prints the board as the app sees it (npm run board -- gmp for the ranking)
npm run build:web    # static web export into dist/
npm run smoke        # renders dist/ in jsdom and clicks through the app
npm run smoke:live   # (WEB_LIVE_FIXTURES=1) same walk, with the captured upstream pages served as
                     # the app's own /api/ipoji proxy - asserts the live path end to end
npm run smoke:ai     # (WEB_AI_FIXTURES=1) the failing-network path: ipoji answers 403, a stubbed
                     # Gemini answers the key check, and the walk drives the real Settings card -
                     # paste key, save, test, dry-run, refresh - then asserts the board is labelled AI
npm run ai:check     # calls every provider endpoint with an invalid key: HTTP 401 is the healthy
                     # answer, and proves the client maps each provider's refusal into plain words
```

The live parsers are tested against trimmed copies of the real upstream markup (same classes, same
`data-*` attributes, same timestamps), and the *Live parse check* workflow runs the shipping parser
code against the real pages on a runner whenever a `live-*` tag is pushed - the sandbox this app is
developed in cannot reach ipoji.com:

```bash
git tag -f live-1 && git push -f origin live-1   # publishes a live-parse check run with the report
```

`npm run check:deps` compares what is installed with `node_modules/expo/bundledNativeModules.json`.
Web builds hide version drift because react-native-web supplies its own implementations: reanimated
`^4.6.0` pulled worklets 0.12, where a C++ method that `expo-modules-core` calls had been renamed, so
the web app was fine while every Android build failed. The check is part of the APK workflow too.

`npm run smoke` is the end-to-end check: it mounts the exported bundle, then walks the board →
detail screen → lot stepper → watch toggle → GMP board (filters + search, row tap and row star) →
watchlist → settings (including a dark-theme repaint), asserting on the rendered DOM and failing on
any console error.

Point it at the Metro dev bundle for the stricter run, where React's development warnings (deprecated
`shadow*` / `pointerEvents` props, invalid DOM nesting) fail the test:

```bash
npx expo start --web --port 8081          # in one terminal
WEB_DEV_BUNDLE_URL="http://127.0.0.1:8081/index.bundle?platform=web&dev=true" npm run smoke
```

The tab bar still logs the upstream `pointerEvents` deprecation from `@react-navigation/bottom-tabs`
(pinned at its latest 7.x), so that one message is allowlisted — the app's own files are scanned
statically by `assertNoDeprecatedProps()` in the same script instead.

## Architecture

```
App.tsx                     navigation shell, theme wiring, error boundary, toast host
src/theme.ts                light/dark palettes (WCAG AA checked), radii, shadows
src/lib/
  types.ts                  IPO, Segment, Platform, SubscriptionSplit, reminder prefs
  ipoData.ts                the curated snapshot + lookups (the base data, and the offline fallback)
  live/parse.ts             pure parsers for the upstream markup (GMP rows, subscription, cards, calendar JSON)
  live/merge.ts             live rows over the snapshot: matching, field-level merge, new issues, stamps
  live/sources.ts           the four URLs, user agent, timeouts, web proxy switch (no react-native import)
  live/index.ts             pullLiveBoard(): download -> parse -> merge, plus per-source health
  format.ts                 dates, money, percentages, GMP/lot maths, IST formatting
  analysis.ts               phases, milestones, gmpSignal, demand score, insights, data freshness
  board.ts                  bucketing, sorting, search/filters, board statistics
  reminders.ts              pure reminder planning (no platform imports — unit tested)
  notifications.ts          expo-notifications glue, lazily loaded on iOS/Android only
  store.tsx                 watchlist, prefs, alerts, theme, toasts, persistence, live pull + AI fallback
  ai/providers.ts           the provider registry: key shapes, dialects, defaults, free tiers (no react-native)
  ai/client.ts              model lists, one prompt, and the dry check that turns a status code into advice
  ai/extract.ts             the board prompt plus the coercion/plausibility rules every AI row must pass
  ai/search.ts              aiBoardSearch(): prompt -> reply -> believable rows -> the same merge as the pages
  ai/keystore.ts            keychain on iOS/Android, device storage on web
  ai/settings.tsx           what the user saved, the two dry checks, and useAi() for the Settings card
src/components/             UI kit (ui.tsx), charts, IPO card, timeline, segmented control, header
src/screens/                the six screens listed above
scripts/
  board-preview.ts          prints the board the way the app sees it
  web-smoke.ts              jsdom end-to-end test over dist/ or the Metro dev bundle
  android-release.mjs       release plumbing: ABIs, Gradle heap, keystore signing
  live-report.ts            pulls the real boards through the parser code and prints the result (CI)
  ai-key-report.ts          dry-checks a provider key, or every endpoint without one (CI / terminal)
api/ipoji.js                same-origin proxy so the web build can read the boards too
api/ai.js                   same-origin proxy for provider calls from the web build (host allowlist)
.github/workflows/
  android-apk.yml           builds the shareable APK and publishes the Release
  verify-apk.yml            re-checks a published APK (ABIs, bundle, apksigner)
  live-parse.yml            runs the parsers against the live boards and reports into a check run
  ai-check.yml              dry-checks the AI providers from a runner (keyless, plus AI_KEY if set)
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
- **The network layer never blocks a screen.** `pullLiveBoard()` is called from the store with its
  own timeout and error capture; a failed pull keeps whatever the app already had, so the board is
  always renderable and never shows a spinner it cannot finish.

## Updating the bundled snapshot

The snapshot is only the fallback now, but it is still what the app boots from and what it shows
offline, so it should stay fresh:

1. Pull current figures (IPO Ji's GMP board, live subscription report and event calendar:
   <https://www.ipoji.com/ipo-gmp>), or copy them from a *Live parse check* run.
2. Update `DATA_AS_OF` / `DATA_AS_OF_LABEL` and the rows in `src/lib/ipoData.ts`, keeping each
   row's `gmpUpdated` timestamp.
3. Run `npm test` (data integrity is asserted: date ordering, unique ids, platform/segment
   consistency, https sources) and `npm run board` to eyeball the result.

If upstream changes its markup, `src/lib/__tests__/live.test.ts` is where the fixture lives: paste
the new markup, run `npm test`, and the *Live parse check* workflow will confirm it on real pages.

## Disclaimer

Grey market premiums are unofficial and unregulated, sourced from public trackers, and can change
without notice. Nothing in this app is investment advice — read the RHP and consider a
SEBI-registered adviser.
