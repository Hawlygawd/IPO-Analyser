import assert from 'node:assert/strict';
import test from 'node:test';
import { findMismatches, parseRange, satisfies } from '../check-native-versions';

test('satisfies handles the range forms Expo ships', () => {
  // exact - reanimated and worklets are pinned exactly by the SDK
  assert.equal(satisfies('4.5.1', '4.5.1'), true);
  assert.equal(satisfies('4.6.0', '4.5.1'), false);
  assert.equal(satisfies('0.12.1', '0.10.1'), false, 'the worklets drift that broke the APK build');

  // tilde - patch-level drift within a minor is fine
  assert.equal(satisfies('4.26.2', '~4.26.0'), true);
  assert.equal(satisfies('4.27.0', '~4.26.0'), false);
  assert.equal(satisfies('5.7.0', '~5.7.0'), true);
  assert.equal(satisfies('57.0.3', '~57.0.2'), true);

  // caret - stays inside the major, and inside the minor for 0.x
  assert.equal(satisfies('15.1.1', '^15.0.2'), true);
  assert.equal(satisfies('16.0.0', '^15.0.2'), false);
  assert.equal(satisfies('0.12.1', '^0.12.0'), true);
  assert.equal(satisfies('0.13.0', '^0.12.0'), false);

  // ranges we cannot reason about must not produce false failures
  assert.equal(satisfies('1.0.0', 'next'), true);
  assert.equal(parseRange('workspace:*').op, 'any');
});

test('findMismatches only judges installed packages, and reports what to fix', () => {
  const expected = {
    'react-native-reanimated': '4.5.1',
    'react-native-worklets': '0.10.1',
    'react-native-screens': '~4.26.0',
    'expo-notifications': '~57.0.15',
    'expo-something-unused': '1.0.0',
  };
  const declared = { 'react-native-reanimated': '4.6.0', 'react-native-screens': '~4.26.0' };
  const installed: Record<string, string> = {
    'react-native-reanimated': '4.6.0',
    'react-native-worklets': '0.12.1',
    'react-native-screens': '4.26.2',
  };

  const mismatches = findMismatches(expected, declared, (name) => installed[name] ?? null);
  assert.deepEqual(
    mismatches.map((m) => m.name),
    ['react-native-reanimated', 'react-native-worklets'],
  );
  assert.equal(mismatches[0].declared, '4.6.0');
  assert.equal(mismatches[1].declared, null, 'a transitively installed library still gets checked');
  assert.equal(mismatches[0].expected, '4.5.1');
});

test('findMismatches is silent on a realigned tree', () => {
  const expected = { 'react-native-worklets': '0.10.1', 'react-native-reanimated': '4.5.1' };
  const declared = { 'react-native-worklets': '0.10.1', 'react-native-reanimated': '4.5.1' };
  const installed: Record<string, string> = { 'react-native-worklets': '0.10.1', 'react-native-reanimated': '4.5.1' };
  assert.deepEqual(findMismatches(expected, declared, (name) => installed[name] ?? null), []);
});
