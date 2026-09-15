/**
 * The AI-assist runtime: what the user saved, and the two dry checks the Settings screen
 * offers.
 *
 * The state lives outside React on purpose. The board store has to be able to ask "is there
 * a usable key right now?" during a background pull, without the two modules importing each
 * other; React simply subscribes for rendering (`useAi`).
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IPOT } from '../ipoData';
import { checkKey, type AiHttpOptions, type KeyCheckResult } from './client';
import { aiBoardSearch, type AiSearchResult } from './search';
import { deleteStoredKey, keyHint, readStoredKeyDetailed, writeStoredKey, type KeyStoreKind } from './keystore';
import { describeKey, detectProvider, looksLikeKey, providerSpec, type AiProviderId } from './providers';

const CONFIG_KEY = '@ipo_pulse/ai';

export interface AiConfig {
  /** null means "work it out from the key" */
  providerId: AiProviderId | null;
  /** null means "let the provider's default be picked" */
  model: string | null;
  /** only used by the "Other (OpenAI-compatible)" choice */
  baseUrl: string | null;
  /** false keeps the key saved but never spends it during a refresh */
  enabled: boolean;
}

export interface AiRuntime extends AiConfig {
  key: string | null;
  /** where the key is stored, once we know */
  stored: KeyStoreKind | null;
  /** true once storage has been read, so a pull can tell "no key" from "not loaded yet" */
  loaded: boolean;
  /** a check or dry search is in flight */
  busy: boolean;
  /** result of the last "Test this key" run */
  check: KeyCheckResult | null;
  /** result of the last "Dry-run a search" run */
  dryRun: AiSearchResult | null;
}

const DEFAULT_CONFIG: AiConfig = { providerId: null, model: null, baseUrl: null, enabled: true };

let runtime: AiRuntime = { ...DEFAULT_CONFIG, key: null, stored: null, loaded: false, busy: false, check: null, dryRun: null };
const listeners = new Set<() => void>();
let loading: Promise<AiRuntime> | null = null;

export function getAiRuntime(): AiRuntime {
  return runtime;
}

export function subscribeAiRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(patch: Partial<AiRuntime>): void {
  runtime = { ...runtime, ...patch };
  for (const listener of listeners) listener();
}

/** Reads the saved key + config once per launch. Safe to call from anywhere. */
export function loadAiRuntime(): Promise<AiRuntime> {
  if (!loading) {
    loading = (async () => {
      let config = DEFAULT_CONFIG;
      try {
        const raw = await AsyncStorage.getItem(CONFIG_KEY);
        if (raw) config = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AiConfig>) };
      } catch {
        // start from defaults
      }
      let key: string | null = null;
      let stored: KeyStoreKind | null = null;
      try {
        // a key that was saved while the keychain was unavailable (older build, unusual
        // device) is migrated onto the keychain the first time we see it again
        const found = await readStoredKeyDetailed();
        key = found.key;
        stored = found.kind;
        if (key && Platform.OS !== 'web' && stored === 'storage') stored = await writeStoredKey(key);
      } catch {
        key = null;
        stored = null;
      }
      emit({ ...config, key, stored, loaded: true });
      return runtime;
    })();
  }
  return loading;
}

/**
 * Waits (briefly) for the stored key to be loaded: the first live pull starts 400 ms after
 * boot and must not decide "no key" while the keychain is still being read.
 */
export async function whenAiReady(timeoutMs = 4000): Promise<AiRuntime> {
  if (runtime.loaded) return runtime;
  return Promise.race([
    loadAiRuntime(),
    new Promise<AiRuntime>((resolve) => setTimeout(() => resolve(runtime), timeoutMs)),
  ]);
}

export async function saveAiKey(raw: string, providerId?: AiProviderId | null): Promise<{ ok: boolean; message: string }> {
  const key = raw.trim();
  if (!looksLikeKey(key)) {
    return { ok: false, message: 'That does not look like an API key - paste the whole value with no spaces.' };
  }
  const guess = detectProvider(key);
  const pinned = providerId ?? runtime.providerId ?? guess?.id ?? null;
  const stored = await writeStoredKey(key);
  const config: AiConfig = {
    providerId: pinned,
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    enabled: runtime.enabled,
  };
  emit({ key, stored, providerId: pinned, loaded: true, check: null, dryRun: null });
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // the key itself is saved; the non-secret config just will not survive a restart
  }
  return {
    ok: true,
    message: `Saved to your ${stored === 'keychain' ? 'device keychain' : 'this device'}${pinned ? ` • ${providerSpec(pinned).label}` : ''}. Press Test this key to prove it works.`,
  };
}

export async function clearAiKey(): Promise<void> {
  await deleteStoredKey();
  emit({ key: null, stored: null, check: null, dryRun: null });
}

/** The HTTP options every AI call uses: the web build goes through the app's own proxy. */
export function aiHttpOptions(): AiHttpOptions {
  return { useProxy: Platform.OS === 'web', listTimeoutMs: 20000, chatTimeoutMs: 60000 };
}

/**
 * Dry check 1: does the saved key authenticate and answer? Remembers the provider and model
 * that actually answered, so later pulls do not have to guess.
 */
export async function runAiCheck(): Promise<KeyCheckResult> {
  const key = runtime.key;
  if (!key) {
    const missing: KeyCheckResult = {
      ok: false,
      providerId: 'custom',
      providerLabel: 'No key saved',
      model: '',
      models: [],
      steps: [],
      latencyMs: 0,
      error: 'Save a key first, then test it.',
      tried: [],
    };
    emit({ check: missing });
    return missing;
  }
  emit({ busy: true });
  try {
    const result = await checkKey({
      key,
      providerId: runtime.providerId,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      ...aiHttpOptions(),
    });
    if (result.ok) await setAiConfig({ providerId: result.providerId, model: result.model });
    emit({ check: result });
    return result;
  } finally {
    emit({ busy: false });
  }
}

/**
 * Dry check 2: does the key return figures this app can actually merge? Runs the same search
 * a blocked refresh would run, over the bundled board, and reports what came back.
 */
export async function runAiDrySearch(): Promise<AiSearchResult> {
  emit({ busy: true });
  try {
    const result = await aiBoardSearch(IPOT, {
      key: runtime.key ?? '',
      providerId: runtime.providerId,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      search: true,
      limit: 5,
      ...aiHttpOptions(),
    });
    emit({ dryRun: result });
    return result;
  } finally {
    emit({ busy: false });
  }
}

export async function setAiConfig(patch: Partial<AiConfig>): Promise<void> {
  emit(patch);
  const config: AiConfig = {
    providerId: runtime.providerId,
    model: runtime.model,
    baseUrl: runtime.baseUrl,
    enabled: runtime.enabled,
  };
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // the in-memory value still applies for this session
  }
}

/* ------------------------------------------------------------------ the hook */

export interface AiValue extends AiRuntime {
  /** human label for the saved key, e.g. "Google Gemini • AIza…7f2c" */
  keyLabel: string;
  /** what the key shape looks like it is, before any network call */
  shapeLabel: string;
  /** on the web build every call goes through the app's own /api/ai route */
  viaProxy: boolean;
  busy: boolean;
  /** result of the last "Test this key" run */
  check: KeyCheckResult | null;
  /** result of the last "Dry-run a search" run */
  dryRun: AiSearchResult | null;
  save: (raw: string, providerId?: AiProviderId | null) => Promise<{ ok: boolean; message: string }>;
  remove: () => Promise<void>;
  test: () => Promise<KeyCheckResult>;
  drySearch: () => Promise<AiSearchResult>;
  setProvider: (id: AiProviderId | null) => Promise<void>;
  setModel: (model: string | null) => Promise<void>;
  setBaseUrl: (url: string | null) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  http: AiHttpOptions;
}

/**
 * The Settings-facing view of the runtime. `test()` and `drySearch()` are the two dry
 * checks: one proves the key authenticates and answers, the other proves it returns rows
 * this app can actually merge onto the board.
 */
export function useAi(): AiValue {
  const [snapshot, setSnapshot] = useState<AiRuntime>(runtime);

  useEffect(() => {
    void loadAiRuntime();
    setSnapshot({ ...runtime });
    return subscribeAiRuntime(() => setSnapshot({ ...runtime }));
  }, []);

  return {
    ...snapshot,
    keyLabel: snapshot.key
      ? `${snapshot.providerId ? providerSpec(snapshot.providerId).label : 'Key'} • ${keyHint(snapshot.key)}`
      : '',
    shapeLabel: snapshot.key ? describeKey(snapshot.key) : '',
    viaProxy: Platform.OS === 'web',
    http: aiHttpOptions(),
    save: async (raw, providerId) => saveAiKey(raw, providerId ?? null),
    remove: clearAiKey,
    test: runAiCheck,
    drySearch: runAiDrySearch,
    setProvider: (id) => setAiConfig({ providerId: id }),
    setModel: (model) => setAiConfig({ model }),
    setBaseUrl: (url) => setAiConfig({ baseUrl: url }),
    setEnabled: (enabled) => setAiConfig({ enabled }),
  };
}
