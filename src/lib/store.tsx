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
import { phaseOf } from './analysis';
import {
  cancelRemindersFor,
  getPermissionState,
  joinLabels,
  notificationsSupported,
  planForIpo,
  requestPermission,
  ScheduleResult,
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
    async (ipo: IPO): Promise<ScheduleResult> => {
      await cancelRemindersFor(ipo.id, notifIds.current[ipo.id]);
      const result = await scheduleForIpo(ipo, prefs);
      notifIds.current = { ...notifIds.current, [ipo.id]: result.ids };
      persist(KEY_IDS, notifIds.current);
      return result;
    },
    [prefs, persist]
  );

  /**
   * Cancels and re-creates reminders for the given watchlist with the given preferences.
   * Old reminders are always cancelled first - previously a reminder type that had been switched
   * off kept firing because re-scheduling never removed it.
   */
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const syncReminders = useCallback(
    (ids: string[], nextPrefs: NotifPrefs): Promise<void> => {
      const run = async () => {
        const all: Record<string, string[]> = {};
        for (const [id, known] of Object.entries(notifIds.current)) {
          if (!ids.includes(id)) await cancelRemindersFor(id, known);
        }
        for (const id of ids) {
          await cancelRemindersFor(id, notifIds.current[id]);
          const ipo = getIpo(id);
          if (!ipo) continue;
          all[id] = (await scheduleForIpo(ipo, nextPrefs)).ids;
        }
        notifIds.current = all;
        persist(KEY_IDS, all);
      };
      // Serialise runs: quick successive toggles must not interleave cancel/schedule calls
      // (that could leave reminders from both the old and new settings scheduled).
      const next = syncQueue.current.then(run, run);
      syncQueue.current = next.catch(() => undefined);
      return next;
    },
    [persist]
  );

  const toggleWatch = useCallback(
    async (ipo: IPO) => {
      const isOn = watchlist.includes(ipo.id);
      if (isOn) {
        await cancelRemindersFor(ipo.id, notifIds.current[ipo.id]);
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
      const result = await scheduleIpo(ipo);
      logAlert({
        ipoId: ipo.id,
        ipoName: ipo.name,
        kind: 'watch',
        title: `${ipo.name} added to watchlist`,
        body: watchMessage(ipo, result),
      });
      return true;
    },
    [watchlist, persist, logAlert, scheduleIpo]
  );

  const rescheduleAll = useCallback(async () => {
    await syncReminders(watchlist, prefs);
    logAlert({
      ipoId: '-',
      ipoName: 'Reminders',
      kind: 'system',
      title: 'Reminders refreshed',
      body: `${watchlist.length} watched IPO${watchlist.length === 1 ? '' : 's'} re-synced with your schedule.`,
    });
  }, [watchlist, prefs, syncReminders, logAlert]);

  const setPref = useCallback(
    async (key: keyof NotifPrefs, value: boolean) => {
      const next = { ...prefs, [key]: value };
      setPrefs(next);
      persist(KEY_PREFS, next);
      // Apply the change to reminders that are already scheduled (switching a type off used to
      // have no effect until "Reschedule my reminders" was tapped - and not even then).
      if (permission === 'granted' && watchlist.length > 0) {
        await syncReminders(watchlist, next);
      }
    },
    [prefs, persist, permission, watchlist, syncReminders]
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

/** Alert-log copy after starring an IPO - says exactly what was (or wasn't) scheduled and why. */
function watchMessage(ipo: IPO, result: ScheduleResult): string {
  const count = result.ids.length;
  if (count > 0) {
    return `${count} reminder${count === 1 ? '' : 's'} scheduled \u2013 ${joinLabels(result.labels)}.`;
  }
  if (result.blocked === 'unsupported') return 'Reminders are available on the mobile app.';
  if (result.blocked === 'permission') return 'Turn on notifications in Settings to receive reminders.';
  if (phaseOf(ipo).key === 'awaiting') {
    return 'Its dates haven\u2019t been confirmed yet, so no reminders were scheduled.';
  }
  const allOn: NotifPrefs = { openDay: true, lastDay: true, allotment: true, listing: true };
  if (planForIpo(ipo, allOn).length > 0) {
    return 'None of its remaining dates match your reminder settings.';
  }
  return 'All key dates for this IPO have passed \u2013 there is nothing left to remind you about.';
}
