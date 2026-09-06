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
import { useColorScheme } from 'react-native';
import { AlertLogItem, NotifPrefs, IPO } from './types';
import { ThemeMode } from '../theme';
import { darkTheme, lightTheme, Theme } from '../theme';
import { getIpo, IPOT } from './ipoData';
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

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

interface StoreValue {
  ready: boolean;
  loading: boolean;
  refreshing: boolean;
  lastRefresh: number;
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [alerts, setAlerts] = useState<AlertLogItem[]>([]);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const notifIds = useRef<Record<string, string[]>>({});

  // ---- boot ---------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const map = await AsyncStorage.getMany([
          KEY_WATCH,
          KEY_PREFS,
          KEY_ALERTS,
          KEY_THEME,
          KEY_IDS,
          KEY_REFRESH,
        ]);
        if (map[KEY_WATCH]) setWatchlist(JSON.parse(map[KEY_WATCH] as string));
        if (map[KEY_PREFS]) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(map[KEY_PREFS] as string) });
        if (map[KEY_ALERTS]) setAlerts(JSON.parse(map[KEY_ALERTS] as string));
        if (map[KEY_THEME]) setThemeModeState(JSON.parse(map[KEY_THEME] as string));
        if (map[KEY_IDS]) notifIds.current = JSON.parse(map[KEY_IDS] as string);
        if (map[KEY_REFRESH]) setLastRefresh(Number(map[KEY_REFRESH]) || Date.now());
      } catch {
        // start fresh on any storage error
      }
      const state = await getPermissionState();
      setPermission(notificationsSupported() ? state : 'unsupported');
      setReady(true);
    })();
  }, []);

  const persist = useCallback(async (key: string, value: unknown) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore write failures
    }
  }, []);

  const logAlert = useCallback(
    (item: Omit<AlertLogItem, 'id' | 'at'>) => {
      setAlerts((prev) => {
        const next = [{ ...item, id: uid(), at: Date.now() }, ...prev].slice(0, 60);
        persist(KEY_ALERTS, next);
        return next;
      });
    },
    [persist]
  );

  const scheduleIpo = useCallback(
    async (ipo: IPO) => {
      await cancelIds(notifIds.current[ipo.id] ?? []);
      const ids = await scheduleForIpo(ipo, prefs);
      notifIds.current = { ...notifIds.current, [ipo.id]: ids };
      persist(KEY_IDS, notifIds.current);
      return ids.length;
    },
    [prefs, persist]
  );

  const toggleWatch = useCallback(
    async (ipo: IPO) => {
      const isOn = watchlist.includes(ipo.id);
      if (isOn) {
        await cancelIds(notifIds.current[ipo.id] ?? []);
        const rest = { ...notifIds.current };
        delete rest[ipo.id];
        notifIds.current = rest;
        persist(KEY_IDS, rest);
        const next = watchlist.filter((id) => id !== ipo.id);
        setWatchlist(next);
        persist(KEY_WATCH, next);
        logAlert({
          ipoId: ipo.id,
          ipoName: ipo.name,
          kind: 'unwatch',
          title: `${ipo.name} removed`,
          body: 'Reminders for this IPO have been switched off.',
        });
        return false;
      }
      const next = [ipo.id, ...watchlist];
      setWatchlist(next);
      persist(KEY_WATCH, next);
      const count = await scheduleIpo(ipo);
      logAlert({
        ipoId: ipo.id,
        ipoName: ipo.name,
        kind: 'watch',
        title: `${ipo.name} added to watchlist`,
        body:
          count > 0
            ? `${count} reminder${count === 1 ? '' : 's'} scheduled \u2013 open day, allotment and listing.`
            : notificationsSupported()
              ? 'Turn on notifications in Settings to receive reminders.'
              : 'Reminders are available on the mobile app.',
      });
      return true;
    },
    [watchlist, persist, logAlert, scheduleIpo]
  );

  const rescheduleAll = useCallback(async () => {
    const all: Record<string, string[]> = {};
    for (const id of watchlist) {
      const ipo = getIpo(id);
      if (!ipo) continue;
      all[id] = await scheduleForIpo(ipo, prefs);
    }
    notifIds.current = all;
    persist(KEY_IDS, all);
    logAlert({
      ipoId: '-',
      ipoName: 'Reminders',
      kind: 'system',
      title: 'Reminders refreshed',
      body: `${watchlist.length} watched IPO${watchlist.length === 1 ? '' : 's'} re-synced with your schedule.`,
    });
  }, [watchlist, prefs, persist, logAlert]);

  const setPref = useCallback(
    async (key: keyof NotifPrefs, value: boolean) => {
      const next = { ...prefs, [key]: value };
      setPrefs(next);
      persist(KEY_PREFS, next);
    },
    [prefs, persist]
  );

  const enableNotifications = useCallback(async () => {
    const granted = await requestPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) {
      await rescheduleAll();
    }
    return granted;
  }, [rescheduleAll]);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      persist(KEY_THEME, mode);
    },
    [persist]
  );

  const clearAlerts = useCallback(async () => {
    setAlerts([]);
    persist(KEY_ALERTS, []);
  }, [persist]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const at = Date.now();
    setLastRefresh(at);
    persist(KEY_REFRESH, at);
    setRefreshing(false);
  }, [persist]);

  const theme = useMemo(() => {
    const resolved = themeMode === 'system' ? (systemScheme ?? 'light') : themeMode;
    return resolved === 'dark' ? darkTheme : lightTheme;
  }, [themeMode, systemScheme]);

  const watchedIpos = useMemo(
    () => watchlist.map((id) => getIpo(id)).filter((x): x is IPO => Boolean(x)),
    [watchlist]
  );

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      loading: refreshing,
      refreshing,
      lastRefresh,
      theme,
      themeMode,
      setThemeMode,
      watchlist,
      watchedIpos,
      isWatched: (id: string) => watchlist.includes(id),
      toggleWatch,
      prefs,
      setPref,
      rescheduleAll,
      permission,
      enableNotifications,
      alerts,
      clearAlerts,
      refresh,
      watchedCountFor: (id: string) => (watchlist.includes(id) ? 1 : 0),
    }),
    [
      ready,
      refreshing,
      lastRefresh,
      theme,
      themeMode,
      setThemeMode,
      watchlist,
      watchedIpos,
      toggleWatch,
      prefs,
      setPref,
      rescheduleAll,
      permission,
      enableNotifications,
      alerts,
      clearAlerts,
      refresh,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

export const TOTAL_IPO_COUNT = IPOT.length;
