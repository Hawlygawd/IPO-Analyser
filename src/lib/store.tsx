import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, useColorScheme } from 'react-native';
import { AlertLogItem, DataSourceStatus, IPO, NotifPrefs } from './types';
import { ThemeMode } from '../theme';
import { darkTheme, lightTheme, Theme } from '../theme';
import { BUNDLED_IPOS } from './ipoData';
import { fetchLiveIpoFeed, mergeIpoCatalog } from './ipoSources';
import {
  cancelIds,
  getPermissionState,
  notificationsSupported,
  requestPermission,
  scheduleForIpo,
} from './notifications';

const KEY_WATCH = '@ipo_pulse/watchlist';
const KEY_PREFS = '@ipo_pulse/prefs';
const KEY_ALERTS = '@ipo_pulse/alerts';
const KEY_THEME = '@ipo_pulse/theme';
const KEY_IDS = '@ipo_pulse/notif_ids';
const KEY_REFRESH = '@ipo_pulse/last_refresh';
const KEY_LAST_ATTEMPT = '@ipo_pulse/last_attempt';
const KEY_IPOS = '@ipo_pulse/ipo_cache';
const KEY_SOURCES = '@ipo_pulse/data_sources';
const KEY_COMPLETE = '@ipo_pulse/catalog_complete';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type DataMode = 'loading' | 'live' | 'limited' | 'cached' | 'offline';

interface StoreValue {
  ready: boolean;
  loading: boolean;
  refreshing: boolean;
  lastRefresh: number;
  dataMode: DataMode;
  dataSources: DataSourceStatus[];
  dataWarning: string | null;
  storageWarning: string | null;
  ipos: IPO[];
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  watchlist: string[];
  watchedIpos: IPO[];
  isWatched: (id: string) => boolean;
  toggleWatch: (ipo: IPO) => Promise<boolean>;
  prefs: NotifPrefs;
  setPref: (key: keyof NotifPrefs, value: boolean) => Promise<void>;
  rescheduleAll: () => Promise<void>;
  permission: PermissionState;
  enableNotifications: () => Promise<boolean>;
  alerts: AlertLogItem[];
  clearAlerts: () => Promise<void>;
  refresh: () => Promise<void>;
  watchedCountFor: (id: string) => number;
}

const DEFAULT_PREFS: NotifPrefs = {
  openDay: true,
  lastDay: true,
  allotment: true,
  listing: true,
};

const StoreContext = createContext<StoreValue | null>(null);

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseStored<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [dataMode, setDataMode] = useState<DataMode>('loading');
  const [dataSources, setDataSources] = useState<DataSourceStatus[]>([]);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [ipos, setIpos] = useState<IPO[]>(BUNDLED_IPOS);
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [alerts, setAlerts] = useState<AlertLogItem[]>([]);
  const [permission, setPermission] = useState<PermissionState>('undetermined');

  // Refs keep async actions from closing over stale state during quick taps or
  // while a network refresh is in flight.
  const iposRef = useRef<IPO[]>(BUNDLED_IPOS);
  const watchlistRef = useRef<string[]>([]);
  const alertsRef = useRef<AlertLogItem[]>([]);
  const prefsRef = useRef<NotifPrefs>(DEFAULT_PREFS);
  const notifIds = useRef<Record<string, string[]>>({});
  const lastAttemptRef = useRef(0);
  const refreshLock = useRef(false);
  const watchQueue = useRef<Promise<void>>(Promise.resolve());

  const persistValues = useCallback(async (values: Record<string, unknown>): Promise<boolean> => {
    try {
      const encoded = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)])
      );
      await AsyncStorage.setMany(encoded);
      setStorageWarning(null);
      return true;
    } catch {
      setStorageWarning('Could not save local data. Check device storage and try again.');
      return false;
    }
  }, []);

  const persistValue = useCallback(
    async (key: string, value: unknown) => persistValues({ [key]: value }),
    [persistValues]
  );

  // ---- boot / rehydrate ---------------------------------------------------
  useEffect(() => {
    let active = true;
    const boot = async () => {
      let map: Record<string, string | null> = {};
      try {
        map = await AsyncStorage.getMany([
          KEY_WATCH,
          KEY_PREFS,
          KEY_ALERTS,
          KEY_THEME,
          KEY_IDS,
          KEY_REFRESH,
          KEY_LAST_ATTEMPT,
          KEY_IPOS,
          KEY_SOURCES,
          KEY_COMPLETE,
        ]);
      } catch {
        // A storage failure should not prevent the app from opening. The seed
        // snapshot remains available and all future writes report an error.
      }

      const cachedIpos = parseStored<IPO[]>(map[KEY_IPOS], []);
      const savedWatchlist = uniqueStringArray(parseStored<unknown>(map[KEY_WATCH], []));
      const savedSources = parseStored<DataSourceStatus[]>(map[KEY_SOURCES], []);
      const savedCatalogComplete = parseStored<boolean>(map[KEY_COMPLETE], false);
      const hadCompleteFeed =
        savedCatalogComplete ||
        (Array.isArray(savedSources) && savedSources.some((source) => source.id === 'ipoalerts' && source.status === 'ok'));
      const seed = hadCompleteFeed ? BUNDLED_IPOS.filter((ipo) => savedWatchlist.includes(ipo.id)) : BUNDLED_IPOS;
      const initialIpos = Array.isArray(cachedIpos) ? mergeIpoCatalog(seed, cachedIpos) : seed;
      const savedPrefs = {
        ...DEFAULT_PREFS,
        ...parseStored<Partial<NotifPrefs>>(map[KEY_PREFS], {}),
      };
      const savedAlerts = parseStored<AlertLogItem[]>(map[KEY_ALERTS], []);
      const savedTheme = parseStored<ThemeMode>(map[KEY_THEME], 'system');
      const savedNotifIds = parseStored<Record<string, string[]>>(map[KEY_IDS], {});
      const savedLastRefresh = Number(map[KEY_REFRESH]) || 0;
      const savedLastAttempt = Number(map[KEY_LAST_ATTEMPT]) || savedLastRefresh;

      if (active) {
        iposRef.current = initialIpos;
        watchlistRef.current = savedWatchlist;
        alertsRef.current = Array.isArray(savedAlerts) ? savedAlerts : [];
        prefsRef.current = savedPrefs;
        notifIds.current = savedNotifIds && typeof savedNotifIds === 'object' ? savedNotifIds : {};
        lastAttemptRef.current = savedLastAttempt;
        setIpos(initialIpos);
        setWatchlist(savedWatchlist);
        setPrefs(savedPrefs);
        setAlerts(alertsRef.current);
        setThemeModeState(savedTheme);
        setLastRefresh(savedLastRefresh);
        setDataSources(Array.isArray(savedSources) ? savedSources : []);
        setDataMode(cachedIpos.length > 0 ? 'cached' : 'offline');
      }

      const currentPermission = await getPermissionState();
      if (active) {
        setPermission(notificationsSupported() ? currentPermission : 'unsupported');
        setReady(true);
      }
    };

    void boot();
    return () => {
      active = false;
    };
  }, []);

  // ---- live IPO data ------------------------------------------------------
  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    const attemptedAt = Date.now();
    lastAttemptRef.current = attemptedAt;
    void persistValues({ [KEY_LAST_ATTEMPT]: attemptedAt });
    setRefreshing(true);
    setDataWarning(null);

    try {
      const feed = await fetchLiveIpoFeed();
      if (feed.sources.length > 0) setDataSources(feed.sources);
      setDataWarning(feed.warnings.length ? feed.warnings.slice(0, 3).join(' ') : null);

      if (feed.ipos.length > 0 || feed.completeness === 'complete') {
        const isComplete = feed.completeness === 'complete';
        const baseline = isComplete
          ? iposRef.current.filter((ipo) => watchlistRef.current.includes(ipo.id))
          : iposRef.current;
        const next = mergeIpoCatalog(baseline, feed.ipos);
        iposRef.current = next;
        await persistValues({
          [KEY_IPOS]: next,
          ...(isComplete ? { [KEY_COMPLETE]: true } : {}),
        });
        setIpos(next);
      }

      if (feed.isFresh) {
        const timestamp = new Date(feed.fetchedAt).getTime() || Date.now();
        setLastRefresh(timestamp);
        const hasUnrestrictedSource = feed.sources.some((source) => source.status === 'ok');
        const mode: DataMode = feed.completeness === 'complete' && hasUnrestrictedSource ? 'live' : 'limited';
        setDataMode(mode);
        await persistValues({
          [KEY_REFRESH]: timestamp,
          [KEY_SOURCES]: feed.sources,
        });
      } else {
        setDataMode(iposRef.current.length > 0 ? 'cached' : 'offline');
      }
    } catch (error) {
      setDataWarning(error instanceof Error ? error.message : 'Could not refresh IPO data.');
      setDataMode(iposRef.current.length > 0 ? 'cached' : 'offline');
      setDataSources((current) =>
        current.length
          ? current.map((source) =>
              source.status === 'unconfigured'
                ? source
                : {
                    ...source,
                    status: 'error',
                    note: error instanceof Error ? `Last check failed: ${error.message}` : 'Last live check failed.',
                  }
            )
          : [
              {
                id: 'network',
                name: 'Live IPO feed',
                status: 'error',
                recordCount: 0,
                note: error instanceof Error ? error.message : 'Could not reach live sources.',
              },
            ]
      );
    } finally {
      setRefreshing(false);
      refreshLock.current = false;
    }
  }, [persistValues]);

  useEffect(() => {
    if (!ready) return undefined;

    const refreshIfDue = () => {
      if (AppState.currentState !== 'background' && Date.now() - lastAttemptRef.current > 5 * 60 * 1000) {
        void refresh();
      }
    };
    refreshIfDue();
    const timer = setInterval(refreshIfDue, 30 * 60 * 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshIfDue();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready, refresh]);

  // ---- notification scheduling ------------------------------------------
  const scheduleIpo = useCallback(
    async (ipo: IPO, selectedPrefs = prefsRef.current) => {
      await cancelIds(notifIds.current[ipo.id] ?? []);
      const ids = await scheduleForIpo(ipo, selectedPrefs);
      notifIds.current = { ...notifIds.current, [ipo.id]: ids };
      await persistValue(KEY_IDS, notifIds.current);
      return ids.length;
    },
    [persistValue]
  );

  const logAlert = useCallback(
    async (item: Omit<AlertLogItem, 'id' | 'at'>) => {
      const next = [{ ...item, id: uid(), at: Date.now() }, ...alertsRef.current].slice(0, 60);
      alertsRef.current = next;
      setAlerts(next);
      await persistValue(KEY_ALERTS, next);
    },
    [persistValue]
  );

  const rescheduleFor = useCallback(
    async (selectedPrefs: NotifPrefs) => {
      const all: Record<string, string[]> = {};
      for (const id of watchlistRef.current) {
        const ipo = iposRef.current.find((item) => item.id === id);
        if (!ipo) continue;
        await cancelIds(notifIds.current[id] ?? []);
        all[id] = await scheduleForIpo(ipo, selectedPrefs);
      }
      notifIds.current = all;
      await persistValue(KEY_IDS, all);
    },
    [persistValue]
  );

  const lastStartupSchedule = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || permission !== 'granted') return;
    const marker = lastRefresh || -1;
    if (lastStartupSchedule.current === marker) return;
    lastStartupSchedule.current = marker;
    // Reconcile persisted notification IDs after each successful data sync so
    // changed IPO dates update reminders without creating duplicate alerts.
    void rescheduleFor(prefsRef.current);
  }, [ready, permission, lastRefresh, rescheduleFor]);

  const rescheduleAll = useCallback(async () => {
    await rescheduleFor(prefsRef.current);
    await logAlert({
      ipoId: '-',
      ipoName: 'Reminders',
      kind: 'system',
      title: 'Reminders refreshed',
      body: `${watchlistRef.current.length} watched IPO${watchlistRef.current.length === 1 ? '' : 's'} re-synced with your schedule.`,
    });
  }, [logAlert, rescheduleFor]);

  const toggleWatch = useCallback(
    (ipo: IPO): Promise<boolean> => {
      const operation = watchQueue.current.then(async () => {
        const current = watchlistRef.current;
        const isOn = current.includes(ipo.id);
        const next = isOn ? current.filter((id) => id !== ipo.id) : [ipo.id, ...current];

        // Persist the watchlist before doing slower notification work. This is
        // what prevents an app being closed immediately after tapping ⭐ from
        // losing the saved item on the next launch.
        watchlistRef.current = next;
        setWatchlist(next);
        const didPersist = await persistValues({ [KEY_WATCH]: next, [KEY_IPOS]: iposRef.current });
        if (!didPersist) {
          watchlistRef.current = current;
          setWatchlist(current);
          return isOn;
        }

        if (isOn) {
          await cancelIds(notifIds.current[ipo.id] ?? []);
          const ids = { ...notifIds.current };
          delete ids[ipo.id];
          notifIds.current = ids;
          await persistValue(KEY_IDS, ids);
          await logAlert({
            ipoId: ipo.id,
            ipoName: ipo.name,
            kind: 'unwatch',
            title: `${ipo.name} removed`,
            body: 'Reminders for this IPO have been switched off.',
          });
          return false;
        }

        let count = 0;
        try {
          count = await scheduleIpo(ipo);
        } catch {
          // Keep the watchlist even if a device cannot schedule notifications.
        }
        await logAlert({
          ipoId: ipo.id,
          ipoName: ipo.name,
          kind: 'watch',
          title: `${ipo.name} added to watchlist`,
          body:
            count > 0
              ? `${count} reminder${count === 1 ? '' : 's'} scheduled for the IPO's key dates.`
              : notificationsSupported()
                ? 'The IPO is saved. Enable notifications in Settings to receive reminders.'
                : 'The IPO is saved. Local push reminders are available in the iOS and Android app.',
        });
        return true;
      });
      watchQueue.current = operation.then(
        () => undefined,
        () => undefined
      );
      return operation;
    },
    [logAlert, persistValue, persistValues, scheduleIpo]
  );

  const setPref = useCallback(
    async (key: keyof NotifPrefs, value: boolean) => {
      const next = { ...prefsRef.current, [key]: value };
      prefsRef.current = next;
      setPrefs(next);
      await persistValue(KEY_PREFS, next);
      if (permission === 'granted') await rescheduleFor(next);
    },
    [permission, persistValue, rescheduleFor]
  );

  const enableNotifications = useCallback(async () => {
    const granted = await requestPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) await rescheduleFor(prefsRef.current);
    return granted;
  }, [rescheduleFor]);

  // ---- appearance and alerts --------------------------------------------
  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      void persistValue(KEY_THEME, mode);
    },
    [persistValue]
  );

  const clearAlerts = useCallback(async () => {
    alertsRef.current = [];
    setAlerts([]);
    await persistValue(KEY_ALERTS, []);
  }, [persistValue]);

  const theme = useMemo(() => {
    const resolved = themeMode === 'system' ? systemScheme ?? 'light' : themeMode;
    return resolved === 'dark' ? darkTheme : lightTheme;
  }, [themeMode, systemScheme]);

  const watchedIpos = useMemo(
    () => watchlist.map((id) => ipos.find((ipo) => ipo.id === id)).filter((ipo): ipo is IPO => Boolean(ipo)),
    [watchlist, ipos]
  );

  const isWatched = useCallback((id: string) => watchlist.includes(id), [watchlist]);
  const watchedCountFor = useCallback((id: string) => (watchlist.includes(id) ? 1 : 0), [watchlist]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      loading: refreshing,
      refreshing,
      lastRefresh,
      dataMode,
      dataSources,
      dataWarning,
      storageWarning,
      ipos,
      theme,
      themeMode,
      setThemeMode,
      watchlist,
      watchedIpos,
      isWatched,
      toggleWatch,
      prefs,
      setPref,
      rescheduleAll,
      permission,
      enableNotifications,
      alerts,
      clearAlerts,
      refresh,
      watchedCountFor,
    }),
    [
      ready,
      refreshing,
      lastRefresh,
      dataMode,
      dataSources,
      dataWarning,
      storageWarning,
      ipos,
      theme,
      themeMode,
      setThemeMode,
      watchlist,
      watchedIpos,
      isWatched,
      toggleWatch,
      prefs,
      setPref,
      rescheduleAll,
      permission,
      enableNotifications,
      alerts,
      clearAlerts,
      refresh,
      watchedCountFor,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside StoreProvider');
  return context;
}
