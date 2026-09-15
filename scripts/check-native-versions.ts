/**
 * Expo SDK version guard.
 *
 * `node_modules/expo/bundledNativeModules.json` is the list of native library versions the SDK is
 * tested against. Drifting off it compiles on web (which ships its own implementations) and breaks
 * on a real device, which is exactly what happened here: reanimated was declared as ^4.6.0, that
 * pulled react-native-worklets 0.12.x, and expo-modules-core's C++ still called a method that
 * 0.12 had renamed - a native build error that no amount of web testing would have shown.
 *
 *   npm run check:deps
 *
 * Exits 1 with the offending packages, or 0 when every installed native dependency matches the SDK.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Bump = [number, number, number];

export type Range =
  | { op: 'exact' | '~' | '^' | '>='; version: Bump }
  | { op: 'any' };

/** Parses the range forms npm actually contains: `1.2.3`, `~1.2.3`, `^1.2.3`, `>=1.2.3`. */
export function parseRange(spec: string): Range {
  const trimmed = spec.trim();
  const op = trimmed.startsWith('>=') ? '>=' : /[~^]/.test(trimmed[0] ?? '') ? (trimmed[0] as '~' | '^') : 'exact';
  const numbers = trimmed.replace(/^[~^>=<\s]+/, '').split('.').map((part) => Number.parseInt(part, 10));
  if (numbers.length < 3 || numbers.some((n) => Number.isNaN(n))) {
    return { op: 'any' };
  }
  return { op, version: [numbers[0], numbers[1], numbers[2]] };
}

const compare = (a: Bump, b: Bump) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** npm 7+ range semantics, limited to the operators the SDK list uses. */
export function satisfies(version: string, spec: string): boolean {
  const range = parseRange(spec);
  if (range.op === 'any') return true;

  // drop prerelease/build metadata: 2.2.0-rc.1 behaves as 2.2.0 for this comparison
  const bump = version.split('-')[0].split('+')[0].split('.').map((part) => Number.parseInt(part, 10));
  if (bump.length < 3 || bump.some((n) => Number.isNaN(n))) return false;
  const installed = bump as Bump;
  const wanted = range.version;

  switch (range.op) {
    case 'exact':
      return compare(installed, wanted) === 0;
    case '>=':
      return compare(installed, wanted) >= 0;
    case '~':
      // patch-level changes: ~1.2.3 allows 1.2.x at or above 1.2.3
      return installed[0] === wanted[0] && installed[1] === wanted[1] && installed[2] >= wanted[2];
    case '^':
      // ^1.2.3 allows <2.0.0, but ^0.12.1 allows only <0.13.0
      if (wanted[0] === 0) return installed[0] === 0 && installed[1] === wanted[1] && compare(installed, wanted) >= 0;
      return installed[0] === wanted[0] && compare(installed, wanted) >= 0;
  }
}

export type Mismatch = { name: string; installed: string; expected: string; declared: string | null };

export function findMismatches(
  expected: Record<string, string>,
  declared: Record<string, string>,
  installed: (name: string) => string | null,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const [name, want] of Object.entries(expected)) {
    const isDeclared = name in declared;
    const have = installed(name);
    // Only judge what is actually on disk: the SDK list covers ~100 libraries, most of which this
    // app does not use and therefore does not install.
    if (!have) continue;
    if (!satisfies(have, want)) {
      mismatches.push({ name, installed: have, expected: want, declared: isDeclared ? declared[name] : null });
    }
  }
  return mismatches;
}

/* ------------------------------------------------------------------------------- CLI */

function readInstalled(packageName: string, root: string): string | null {
  const manifest = path.join(root, 'node_modules', packageName, 'package.json');
  if (!existsSync(manifest)) return null;
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

function main(): void {
  const root = process.cwd();
  const expectedPath = path.join(root, 'node_modules', 'expo', 'bundledNativeModules.json');
  if (!existsSync(expectedPath)) {
    console.error('Cannot find node_modules/expo/bundledNativeModules.json - run npm install first.');
    process.exit(1);
  }

  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<string, string>;
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const declared = pkg.dependencies ?? {};

  const sdkVersion = (JSON.parse(readFileSync(path.join(root, 'node_modules', 'expo', 'package.json'), 'utf8')) as {
    version: string;
  }).version;
  const mismatches = findMismatches(expected, declared, (name) => readInstalled(name, root));

  if (mismatches.length === 0) {
    const checked = Object.keys(expected).filter((name) => readInstalled(name, root) !== null).length;
    console.log(`expo SDK ${sdkVersion}: ${checked} installed native dependencies match the SDK's versions`);
    return;
  }

  console.error(`expo SDK ${sdkVersion}: ${mismatches.length} native dependency version(s) drifted:\n`);
  for (const { name, installed, expected: want, declared: spec } of mismatches) {
    console.error(`  ${name}`);
    console.error(`    installed ${installed}   sdk wants ${want}${spec ? `   (package.json: ${spec})` : '   (not declared)'}`);
  }
  console.error('\nWeb-only builds hide this; a device build will not. Fix with:');
  console.error('  npx expo install --fix');
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('check-native-versions.ts')) {
  main();
}
