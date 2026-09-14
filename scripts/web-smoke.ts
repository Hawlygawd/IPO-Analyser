/**
 * DOM smoke test.
 *
 * Renders the app inside jsdom and asserts that it actually mounts and works: no uncaught
 * errors, the header copy is present, the board rows render, a detail screen opens, the
 * filters work, the theme switches - and no React warning is emitted.
 *
 *   npm run build:web && npm run smoke         # production bundle from dist/
 *   WEB_DEV_BUNDLE_URL=http://localhost:8081/index.bundle?platform=web&dev=true npm run smoke
 *                                             # development bundle straight from Metro
 *
 * The dev mode is the stricter run: React's development warnings become failures, which is
 * how deprecated props (shadow*, pointerEvents) get caught before they break a release.
 * Because a few upstream libraries still emit those deprecations on web, the app's own files
 * are also scanned statically by assertNoDeprecatedProps().
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import 'fake-indexeddb/auto';

const DEV_BUNDLE_URL = process.env.WEB_DEV_BUNDLE_URL ?? '';
const OUT = process.env.WEB_EXPORT_DIR ?? 'dist';

/** Dev-only noise that is expected and harmless. */
const WARNING_ALLOWLIST = [
  /Reduced motion setting is enabled/i,
  /DevTools/i,
  /Download the React DevTools/i,
  /\[Reanimated\]/i,
  // @react-navigation/bottom-tabs 7.18.18 (latest 7.x) passes `pointerEvents` as a prop from
  // BottomTabBar on web, which react-native-web deprecates. Upstream, not reachable from app
  // code, so it is allowed here - assertNoDeprecatedProps() checks our own files instead.
  /props\.pointerEvents is deprecated/i,
];

const DEPRECATED_PROP_PATTERNS = [
  {
    // react-native-web deprecates the prop form; style.pointerEvents is the supported one.
    pattern: /(^|[{,\s])pointerEvents\s*=/,
    hint: 'pass pointerEvents through style (style={{ pointerEvents: ... }}) instead',
  },
  {
    // Native-only shadow props live in src/theme.ts behind the IS_WEB branch, so that file is
    // exempt: everywhere else must use cardShadow/floatingShadow, which emit boxShadow on web.
    pattern: /(^|[{,\s])shadow(Color|Offset|Opacity|Radius)\s*[:=]/,
    hint: 'use cardShadow(mode) / floatingShadow(mode) from src/theme.ts instead',
  },
];

/** Static guard: the DOM run only sees rendered components, so scan the source too. */
function assertNoDeprecatedProps(): void {
  const roots = ['App.tsx', 'src'];
  const files: string[] = [];
  const walk = (target: string) => {
    if (statSync(target).isDirectory()) {
      for (const entry of readdirSync(target)) walk(path.join(target, entry));
      return;
    }
    if (!/\.tsx?$/.test(target)) return;
    if (target.endsWith(path.join('src', 'theme.ts'))) return;
    files.push(target);
  };
  roots.forEach(walk);

  const offenders: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const { pattern, hint } of DEPRECATED_PROP_PATTERNS) {
          if (pattern.test(line)) offenders.push(`${file}:${index + 1} ${hint}\n    ${line.trim()}`);
        }
      });
  }
  assert.strictEqual(
    offenders.length,
    0,
    `deprecated React Native web props found in app source:\n  ${offenders.join('\n  ')}`,
  );
}

async function loadBundle(): Promise<string> {
  if (DEV_BUNDLE_URL) {
    const response = await fetch(DEV_BUNDLE_URL);
    if (!response.ok) throw new Error(`Metro returned ${response.status} for ${DEV_BUNDLE_URL}`);
    return await response.text();
  }
  if (!existsSync(OUT)) {
    console.error(`No web export found at ${OUT}. Run: npm run build:web`);
    process.exit(1);
  }
  const bundlesDir = path.join(OUT, '_expo', 'static', 'js', 'web');
  const bundleFile = readdirSync(bundlesDir).find((f) => f.endsWith('.js'));
  assert.ok(bundleFile, 'no web bundle in the export');
  return readFileSync(path.join(bundlesDir, bundleFile as string), 'utf8');
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assertNoDeprecatedProps();
  const bundle = await loadBundle();
  const html = DEV_BUNDLE_URL
    ? '<!doctype html><html><head><title>IPO Pulse</title></head><body><div id="root"></div></body></html>'
    : readFileSync(path.join(OUT, 'index.html'), 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');

  const errors: string[] = [];
  const warnings: string[] = [];

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    // Ignore resource loading noise from the bundle's asset URLs.
    if (/Could not load (img|link|script)/i.test(err.message)) return;
    errors.push(`jsdomError: ${err.message}`);
  });
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));
  virtualConsole.on('warn', (...args) => {
    const message = args.join(' ');
    if (WARNING_ALLOWLIST.some((pattern) => pattern.test(message))) return;
    warnings.push(`console.warn: ${message}`);
  });

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });

  const { window } = dom;

  // jsdom lacks these; react-native-web, reanimated and react-navigation expect them.
  window.matchMedia =
    window.matchMedia ??
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as any));
  (window as any).requestIdleCallback = (cb: any) => setTimeout(() => cb({ timeRemaining: () => 5 }), 0);
  (window as any).cancelIdleCallback = (id: any) => clearTimeout(id);

  // jsdom has no ResizeObserver; react-navigation measures its tab bar with one.
  (window as any).ResizeObserver =
    (window as any).ResizeObserver ??
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

  // jsdom has no CSS Font Loading API; expo-font probes for it when registering @font-face.
  // The app is built to render even when the icon font never resolves (see App.tsx), so these
  // stubs only need to stop the probes from throwing.
  (window as any).CSSFontFaceRule = (window as any).CSSFontFaceRule ?? class CSSFontFaceRule {};
  (window as any).FontFace =
    (window as any).FontFace ??
    class FontFace {
      family: string;
      constructor(family: string) {
        this.family = family;
      }
      load() {
        return Promise.resolve(this);
      }
    };
  (window as any).document.fonts = (window as any).document.fonts ?? {
    add: () => undefined,
    delete: () => undefined,
    has: () => true,
    check: () => true,
    load: () => Promise.resolve([{}]),
    ready: Promise.resolve(),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  const script = window.document.createElement('script');
  script.textContent = bundle;
  window.document.body.appendChild(script);

  const textOf = (selector: string) => window.document.querySelector(selector)?.textContent ?? '';

  // give the store's async boot (IndexedDB + permissions) and the icon-font grace period
  // time to finish before asserting on the UI
  for (let i = 0; i < 80; i += 1) {
    await settle(100);
    // the boot splash paints first, so wait for the board itself rather than the app name
    // (the subtitle reads "35 issues • live ..." or "... • snapshot ..." depending on the pull)
    const text = textOf('#root');
    if (/issues • (live|snapshot)/.test(text) && !text.includes('Updating')) break;
  }


  /**
   * Finds an interactive control. Accessibility labels win over plain text: several screens
   * stay mounted behind each other, so matching on text alone can hit a label on a screen
   * that is not visible.
   */
  const find = (label: string, exact = true): HTMLElement | undefined => {
    const all = [...window.document.querySelectorAll('*')] as HTMLElement[];
    const labelled = all.find((el) => {
      const aria = el.getAttribute('aria-label');
      if (!aria) return false;
      return exact ? aria === label : aria.includes(label);
    });
    if (labelled) return labelled;
    return all.find((el) =>
      exact ? el.textContent?.trim() === label : (el.textContent ?? '').includes(label)
    );
  };

  /** A faithful tap: react-native-web listens to the pointer sequence, not bare clicks. */
  const tap = (target: HTMLElement) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 }));
    }
    return target;
  };

  const press = (label: string) => {
    const target = find(label);
    assert.ok(target, `could not find a control labelled "${label}"`);
    return tap(target!);
  };

  const pressMatching = (fragment: string) => {
    const target = find(fragment, false);
    assert.ok(target, `could not find a control matching "${fragment}"`);
    return tap(target!);
  };

  // The store's first live pull lands a moment after the first paint and re-renders the board,
  // replacing the nodes behind it. Let it finish, then wait for a tab node that survives a
  // render before interacting - otherwise the first tap is dispatched into a detached node.
  await settle(1200);
  let tabNode = find('Soon', false);
  for (let i = 0; i < 20; i += 1) {
    await settle(150);
    const next = find('Soon', false);
    if (next && next === tabNode) break;
    tabNode = next;
  }

  /* ------------------------------------------------------------- first paint */
  const root = textOf('#root');
  assert.ok(root.length > 200, `the app rendered almost nothing (${root.length} chars)`);
  assert.match(root, /IPO Pulse/, 'header title did not render');
  assert.match(root, /issues • (live|snapshot)/, 'the data-status line did not render');
  assert.match(root, /(Live • |Snapshot)/, 'the data-status chip did not render');
  assert.match(root, /Bidding now/, 'summary tiles did not render');
  assert.match(root, /Open now/, 'no "Open now" phase chip rendered');
  assert.match(root, /Closes /, 'no closing-date line rendered on the cards');
  assert.match(root, /GMP \/ premium/i, 'card stat labels did not render');
  assert.match(root, /Veegaland Developers|Manika Plastech|Kanohar Electricals/, 'no board rows rendered');
  assert.ok(!/Something went wrong/.test(root), 'the error boundary tripped on first paint');

  // shadows must be web-native (box-shadow), never the deprecated shadow* props
  const htmlSnapshot = window.document.body.innerHTML;
  assert.match(htmlSnapshot, /box-shadow/i, 'card shadows are missing on web');
  assert.ok(!/shadow-color|shadow-color:/i.test(htmlSnapshot), 'deprecated shadow* props reached the web DOM');

  /* ---------------------------------------------------------------- detail */
  // the NSE issue is an upcoming one - switch tabs first, which also exercises the filter
  pressMatching('Soon');
  await settle(400);
  assert.match(textOf('#root'), /Opening soon|Quanto Agroworld/, 'the Soon tab did not render any rows');
  const card = find('NSE (National Stock Exchange), ', false);
  assert.ok(
    card,
    `could not find the NSE card on the board. Card labels rendered: ${
      [...window.document.querySelectorAll('[aria-label]')]
        .map((el) => el.getAttribute('aria-label') ?? '')
        .filter((label) => / IPO\./.test(label))
        .slice(0, 6)
        .join(' | ') || '(none)'
    }`
  );
  tap(card!);
  await settle(600);

  let detail = textOf('#root');
  assert.match(detail, /Demand signal/, 'detail screen: demand signal card missing');
  assert.match(detail, /Key dates/, 'detail screen: timeline missing');
  assert.match(detail, /Issue facts/, 'detail screen: facts card missing');
  assert.match(detail, /Where this came from/, 'detail screen: source card missing');
  assert.match(detail, /22,561\.57/, 'detail screen: issue size missing');
  assert.match(detail, /1,700/, 'detail screen: price band missing');
  assert.match(detail, /Watch \+ reminders/, 'detail screen: sticky action bar missing');

  // the lot calculator must move the cost when lots change
  assert.ok(detail.includes('1 ×'), 'detail screen: lot default missing');
  press('Increase the number of lots');
  await settle(250);
  detail = textOf('#root');
  assert.match(detail, /2 ×/, 'lot stepper did not update the cost breakdown');
  press('Decrease the number of lots');
  await settle(250);

  // watching from the detail screen must flip the button and log a reminder
  press('Watch + reminders');
  await settle(400);
  detail = textOf('#root');
  assert.match(detail, /Watching/, 'watch toggle did not update the detail button');

  press('Go back');
  await settle(500);
  assert.match(textOf('#root'), /Bidding now/, 'did not return to the board');
  pressMatching('Soon');
  await settle(400);
  // aria-labels are not part of textContent - query the DOM for the star's state instead
  assert.ok(
    find('Remove NSE (National Stock Exchange) from watchlist'),
    'watchlist star did not sync with the detail screen toggle'
  );

  /* ------------------------------------------------------------ gmp board */
  press('GMP board');
  await settle(500);
  const gmpText = textOf('#root');
  assert.match(gmpText, /GMP board/, 'GMP screen did not open');
  assert.match(gmpText, /Quotes recorded/, 'GMP summary tiles missing');
  assert.match(gmpText, /Premium ≥ 12%/, 'GMP premium toggle missing');

  /**
   * Other screens stay mounted behind the active one, so assertions about the GMP list are
   * scoped to its own row labels rather than the whole document text.
   */
  const gmpRows = () =>
    ([...window.document.querySelectorAll('[aria-label]')] as HTMLElement[])
      .map((el) => el.getAttribute('aria-label') ?? '')
      .filter((label) => /Ranked \d+ of \d+/.test(label));

  const premiumOf = (label: string) => Number(/\+([\d.]+)%/.exec(label)?.[1] ?? NaN);

  assert.match(gmpText, /35 shown/, 'the unfiltered row count is wrong');
  // the list virtualises, so only the first screenful of rows is in the DOM
  const unfilteredCount = gmpRows().length;
  assert.ok(unfilteredCount >= 5, `only ${unfilteredCount} GMP rows rendered`);
  press('Premium ≥ 12%');
  await settle(400);
  const toggledRows = gmpRows();
  assert.ok(toggledRows.length > 0, 'the premium toggle emptied the list');
  assert.ok(
    toggledRows.every((label) => premiumOf(label) >= 12),
    `the premium toggle let a sub-12% issue through: ${toggledRows.filter((l) => premiumOf(l) < 12).join(', ')}`
  );
  assert.ok(toggledRows.some((l) => l.includes('Kanohar Electricals')), 'the toggle dropped a qualifying issue');
  press('Premium ≥ 12%');
  await settle(300);
  assert.equal(gmpRows().length, unfilteredCount, 'clearing the premium toggle did not restore the list');

  // typing in the search box must filter too (React tracks the native value setter)
  const searchInput = window.document.querySelector('input') as HTMLInputElement | null;
  assert.ok(searchInput, 'GMP search input missing');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setValue.call(searchInput, 'kanohar');
  searchInput!.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(500);
  assert.match(textOf('#root'), /1 shown/, 'search did not filter the GMP rows');
  const searchRows = gmpRows();
  assert.equal(searchRows.length, 1, `search returned ${searchRows.length} rows`);
  assert.match(searchRows[0], /Kanohar Electricals/, 'the matching row disappeared');

  // the row is two sibling controls now (body + star), so both must still work
  pressMatching('Add Kanohar Electricals to watchlist');
  await settle(350);
  assert.ok(
    find('Remove Kanohar Electricals from watchlist'),
    'the star on a GMP row did not toggle the watchlist'
  );
  press('Remove Kanohar Electricals from watchlist');
  await settle(350);
  assert.ok(
    !find('Remove Kanohar Electricals from watchlist') && find('Add Kanohar Electricals to watchlist'),
    'tapping the GMP star twice did not restore the unwatched state'
  );
  pressMatching('Kanohar Electricals.');
  await settle(600);
  assert.match(textOf('#root'), /Issue facts/, 'tapping the GMP row body did not open the detail screen');
  press('Go back');
  await settle(500);

  /* ------------------------------------------------------------- watchlist */
  press('Watchlist');
  await settle(500);
  const watch = textOf('#root');
  assert.match(watch, /NSE \(National Stock Exchange\)/, 'the watched IPO is missing from the watchlist');
  assert.match(watch, /NEXT EVENT/i, 'watchlist next-event card missing');
  assert.match(watch, /reminder/i, 'watchlist reminder summary missing');

  /* -------------------------------------------------------------- settings */
  press('Settings');
  await settle(500);
  const settings = textOf('#root');
  assert.match(settings, /Appearance/, 'settings: appearance card missing');
  assert.match(settings, /Reminders/, 'settings: reminders card missing');
  assert.match(settings, /Privacy & data/, 'settings: privacy card missing');

  // dark mode must repaint the shell
  press('Dark theme');
  await settle(500);
  assert.ok(
    /13,\s*16,\s*21|#0D1015|rgb\(13 16 21\)/i.test(window.document.body.innerHTML),
    'switching to the dark theme did not apply the dark background'
  );
  assert.ok(!/Something went wrong/.test(textOf('#root')), 'the error boundary tripped while switching themes');

  assert.equal(errors.length, 0, `runtime errors:\n${errors.join('\n')}`);
  assert.equal(warnings.length, 0, `warnings that should have been fixed:\n${warnings.join('\n')}`);

  console.log(
    DEV_BUNDLE_URL ? 'web smoke test passed (development bundle)' : 'web smoke test passed (production export)'
  );
  console.log(`rendered ${root.length} characters of UI; 0 errors, 0 warnings`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
