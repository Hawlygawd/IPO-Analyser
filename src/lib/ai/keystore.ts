/**
 * Where a user's API key lives between sessions.
 *
 * On iOS and Android the key goes into the platform keychain / keystore (expo-secure-store)
 * and nowhere else - it is never written to plain storage, never logged and never sent
 * anywhere except the provider the user picked. On the web build there is no keychain, so
 * the browser's own storage is the only option and the Settings copy says so.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** SecureStore only accepts [A-Za-z0-9._-] in a key name. */
const SECURE_NAME = 'ipo_pulse.ai_key';
/** AsyncStorage (and localStorage on web) keeps the namespaced form. */
export const PREF_KEY = '@ipo_pulse/ai_key';

export type KeyStoreKind = 'keychain' | 'storage';

const native = Platform.OS !== 'web';

/** Reads the stored key, preferring the keychain when the platform has one. */
export async function readStoredKey(): Promise<string | null> {
  return (await readStoredKeyDetailed()).key;
}

/** Same read, but says which store answered - Settings shows it. */
export async function readStoredKeyDetailed(): Promise<{ key: string | null; kind: KeyStoreKind | null }> {
  if (native) {
    try {
      const fromKeychain = await SecureStore.getItemAsync(SECURE_NAME);
      if (fromKeychain) return { key: fromKeychain, kind: 'keychain' };
    } catch {
      // no keychain on this device (or the app was rebuilt without the module) - fall through
    }
  }
  try {
    const fromStorage = await AsyncStorage.getItem(PREF_KEY);
    return { key: fromStorage, kind: fromStorage ? 'storage' : null };
  } catch {
    return { key: null, kind: null };
  }
}

/** Saves the key; reports where it landed so Settings can say so. */
export async function writeStoredKey(key: string): Promise<KeyStoreKind> {
  if (native) {
    try {
      await SecureStore.setItemAsync(SECURE_NAME, key);
      return 'keychain';
    } catch {
      await AsyncStorage.setItem(PREF_KEY, key);
      return 'storage';
    }
  }
  await AsyncStorage.setItem(PREF_KEY, key);
  return 'storage';
}

/** Removes the key from every place it could have been written. */
export async function deleteStoredKey(): Promise<void> {
  if (native) {
    try {
      await SecureStore.deleteItemAsync(SECURE_NAME);
    } catch {
      // nothing stored there
    }
  }
  try {
    await AsyncStorage.removeItem(PREF_KEY);
  } catch {
    // nothing stored there
  }
}

/** "AIza…7f2c" - enough to recognise which key is saved, not enough to use it. */
export function keyHint(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
