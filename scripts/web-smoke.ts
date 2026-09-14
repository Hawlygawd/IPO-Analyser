/**
 * DOM smoke test.
 *
 * Renders the exported web bundle inside jsdom and asserts that the app actually mounts:
 * no uncaught errors, the header copy is present, the board rows render and a detail
 * screen can be opened. This catches runtime breakage that type-checking cannot.
 *
 *   npm run build:web && npm run smoke
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import 'fake-indexeddb/auto';

const OUT = process.env.WEB_EXPORT_DIR ?? 'dist';

if (!existsSync(OUT)) {
  console.error(`No web export found at ${OUT}. Run: npm run build:web`);
  process.exit(1);
}

const html = readFileSync(path.join(OUT, 'index.html'), 'utf8');
const bundlesDir = path.join(OUT, '_expo', 'static', 'js', 'web');
const bundleFile = readdirSync(bundlesDir).find((f) => f.endsWith('.js'));
assert.ok(bundleFile, 'no web bundle in the export');
const bundle = readFileSync(path.join(bundlesDir, bundleFile as string), 'utf8');

const errors: string[] = [];
const warnings: string[] = [];

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (err) => {
  // Ignore resource loading noise from the bundle's asset URLs.
  if (/Could not load (img|link|script)/i.test(err.message)) return;
  errors.push(`jsdomError: ${err.message}`);
});
virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));
virtualConsole.on('warn', (...args) => warnings.push(`console.warn: ${args.join(' ')}`));

const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ''), {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole,
});

const { window } = dom;

// jsdom lacks these; react-native-web and reanimated expect them.
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

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(selector: string): string {
  return window.document.querySelector(selector)?.textContent ?? '';
}

async function run() {
  // give the store's async boot (IndexedDB + permissions) and the icon-font grace
  // period time to finish before asserting on the UI
  for (let i = 0; i < 60; i += 1) {
    await settle(100);
    if (textOf('#root').includes('IPO Pulse') && textOf('#root').length > 200) break;
  }

  const root = textOf('#root');
  assert.ok(root.length > 200, `the app rendered almost nothing (${root.length} chars)`);
  assert.match(root, /IPO Pulse/, 'header title did not render');
  assert.match(root, /Board snapshot/, 'snapshot subtitle did not render');
  assert.match(root, /Bidding now/, 'summary tiles did not render');

  // the board list itself
  assert.match(root, /Open now/, 'no "Open now" phase chip rendered');
  assert.match(root, /Closes /, 'no closing-date line rendered on the cards');
  assert.match(root, /GMP \/ premium/i, 'card stat labels did not render');

  // at least one real issue name from the snapshot
  assert.match(root, /Veegaland Developers|Manika Plastech|Kanohar Electricals/, 'no board rows rendered');

  // error boundary must not have tripped
  assert.ok(!/Something went wrong/.test(root), 'the error boundary tripped on first paint');

  // interactions: move to the GMP board and the watchlist
  /**
   * Finds an interactive control. Accessibility labels win over plain text: several
   * screens stay mounted behind each other, so matching on text alone can hit a label on
   * a screen that is not visible.
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
      target.dispatchEvent(
        new window.MouseEvent(type, { bubbles: true, cancelable: true, detail: 1 })
      );
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

  /* ---------------------------------------------------------------- detail */
  // the NSE issue is an upcoming one - switch tabs first, which also exercises the filter
  pressMatching('Soon');
  await settle(400);
  assert.match(textOf('#root'), /Opening soon|Quanto Agroworld/, 'the Soon tab did not render any rows');
  const card = find('NSE (National Stock Exchange), ', false);
  assert.ok(card, 'could not find the NSE card on the board');
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
  const beforeLots = /₹\d[\d,]*\s*\n?\s*1 ×/u.test(detail) || detail.includes('1 ×');
  assert.ok(beforeLots, 'detail screen: lot default missing');
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

  // keyboard/a11y affordance: the action bar button advertises state
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

  // the premium toggle must narrow the list
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
  const darkHtml = window.document.body.innerHTML;
  assert.ok(
    /13,\s*16,\s*21|#0D1015|rgb\(13 16 21\)/i.test(darkHtml),
    'switching to the dark theme did not apply the dark background'
  );
  assert.ok(!/Something went wrong/.test(textOf('#root')), 'the error boundary tripped while switching themes');

  assert.equal(errors.length, 0, `runtime errors:\n${errors.join('\n')}`);
  console.log('web smoke test passed');
  console.log(`rendered ${root.length} characters of UI; ${warnings.length} console warnings, ${errors.length} errors`);
  if (warnings.length > 0) console.log(warnings.slice(0, 5).join('\n'));
}

run()
  .then(() => {
    window.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    if (errors.length > 0) console.error(errors.join('\n'));
    window.close();
    process.exit(1);
  });
