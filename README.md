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

## Install it on Android

The app builds to a standalone APK: the JavaScript bundle and the data snapshot are baked in, so it
runs on a phone with no Metro, no dev server and no network.

**Grab a build:** [Releases](https://github.com/Hawlygawd/IPO-Analyser/releases) - open the page on
the phone, tap the `.apk` under Assets, and allow installs from that source when Android asks.
Android 7.0 (API 24) or newer; the APK carries both 64-bit and 32-bit ARM libraries.

**Check a download:** the *Verify APK* workflow fetches the published asset and asserts the things
that decide whether it installs and starts - both ARM ABIs, the Hermes bundle, dex code and an
`apksigner`-verified signature - then reports into a check run. Trigger it with a tag
(`git tag apk-check-1 && git push origin apk-check-1`); the *Run workflow* button only appears once
the workflow is on the default branch.

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
npm run check:deps   # native dependencies must match the versions Expo SDK 57 ships
npm run typecheck    # strict TS, app config + node config for scripts/tests
npm test             # 47 unit tests (tsx --test): data integrity, formatting, analysis, board, reminders
npm run board        # prints the board as the app sees it (npm run board -- gmp for the ranking)
npm run build:web    # static web export into dist/
npm run smoke        # renders dist/ in jsdom and clicks through the app
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
  ipoData.ts                the curated snapshot + lookups (the only file to touch when refreshing)
  format.ts                 dates, money, percentages, GMP/lot maths, IST formatting
  analysis.ts               phases, milestones, gmpSignal, demand score, insights, data freshness
  board.ts                  bucketing, sorting, search/filters, board statistics
  reminders.ts              pure reminder planning (no platform imports — unit tested)
  notifications.ts          expo-notifications glue, lazily loaded on iOS/Android only
  store.tsx                 watchlist, prefs, alerts, theme, toasts, persistence
src/components/             UI kit (ui.tsx), charts, IPO card, timeline, segmented control, header
src/screens/                the six screens listed above
scripts/
  board-preview.ts          prints the board the way the app sees it
  web-smoke.ts              jsdom end-to-end test over dist/ or the Metro dev bundle
  android-release.mjs       release plumbing: ABIs, Gradle heap, keystore signing
.github/workflows/
  android-apk.yml           builds the shareable APK and publishes the Release
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
