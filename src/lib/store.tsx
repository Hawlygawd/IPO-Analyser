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
import { getIpo, DATA_AS_OF_LABEL } from './ipoData';
import {
  buildReminders,
  cancelIds,
  getPermissionState,
  notificationsSupported,
  requestPermission,
  scheduleForIpo,
  subscribeToDelivered,
} from './notifications';

const KEY_WATCH = '@ipo_pulse/watchlist';
const KEY_PREFS = '@ipo_pulse/prefs';
const KEY_ALERTS = '@ipo_pulse/alerts';
const KEY_THEME = '@ipo_pulse/theme';
const KEY_IDS = '@ipo_pulse/notif_ids';
const KEY_CHECKED = '@ipo_pulse/last_checked';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type ToastTone = 'info' | 'up' | 'down' | 'warn';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface StoreValue {
  ready: boolean;
  /** bumped whenever derived board data is recomputed */
  boardVersion: number;
  refreshing: boolean;
  /** timestamp of the last "check" run in this app (board snapshot date is separate) */
  lastChecked: number;
  theme: Theme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  watchlist: string[];
  watchedIpos: IPO[];
  isWatched: (id: string) => boolean;
  toggleWatch: (ipo: IPO) => Promise<boolean>;
  prefs: NotifPrefs;
  setPref: (key: keyof NotifPrefs, value: boolean) => Promise<void>;
  rescheduleAll: () => Promise<number>;
  scheduledCount: number;
  permission: PermissionState;
  enableNotifications: () => Promise<boolean>;
  alerts: AlertLogItem[];
  clearAlerts: () => Promise<void>;
  refresh: () => Promise<void>;
  toast: Toast | null;
  showToast: (message: string, tone?: ToastTone) => void;
  dismissToast: () => void;
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
  const [boardVersion, setBoardVersion] = useState(0);
  const [lastChecked, setLastChecked] = useState<number>(Date.now());
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [alerts, setAlerts] = useState<AlertLogItem[]>([]);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [scheduledCount, setScheduledCount] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  // refs mirror the state the async notification code needs to read
  const notifIds = useRef<Record<string, string[]>>({});
  const watchlistRef = useRef<string[]>([]);
  const prefsRef = useRef<NotifPrefs>(DEFAULT_PREFS);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  watchlistRef.current = watchlist;
  prefsRef.current = prefs;

  const persist = useCallback(async (key: string, value: unknown) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore write failures - the app keeps working from memory
    }
  }, []);

  const logAlert = useCallback(
    (item: Omit<AlertLogItem, 'id' | 'at'>) => {
      setAlerts((prev) => {
        const next = [{ ...item, id: uid(), at: Date.now() }, ...prev].slice(0, 80);
        persist(KEY_ALERTS, next);
        return next;
      });
    },
    [persist]
  );

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: uid(), message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /* ---------------------------------------------------------------- boot */
  useEffect(() => {
    (async () => {
      try {
        const map = await AsyncStorage.getMany([
          KEY_WATCH,
          KEY_PREFS,
          KEY_ALERTS,
          KEY_THEME,
          KEY_IDS,
          KEY_CHECKED,
        ]);
        if (map[KEY_WATCH]) {
          const parsed = JSON.parse(map[KEY_WATCH] as string);
          if (Array.isArray(parsed)) {
            // drop any ids that are no longer on the board
            const clean = parsed.filter((id: string) => Boolean(getIpo(id)));
            setWatchlist(clean);
            watchlistRef.current = clean;
          }
        }
        if (map[KEY_PREFS]) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(map[KEY_PREFS] as string) });
        if (map[KEY_ALERTS]) setAlerts(JSON.parse(map[KEY_ALERTS] as string));
        if (map[KEY_THEME]) setThemeModeState(JSON.parse(map[KEY_THEME] as string));
        if (map[KEY_IDS]) notifIds.current = JSON.parse(map[KEY_IDS] as string);
        if (map[KEY_CHECKED]) setLastChecked(Number(map[KEY_CHECKED]) || Date.now());
      } catch {
        // start fresh on any storage error
      }
      const state = await getPermissionState();
      setPermission(notificationsSupported() ? state : 'unsupported');

      const idCount = Object.values(notifIds.current).reduce((sum, ids) => sum + ids.length, 0);
      setScheduledCount(idCount);
      setReady(true);
    })();
  }, []);

  /* ------------------------------------------------------- reminder sync */

  const syncIpo = useCallback(async (ipo: IPO) => {
    await cancelIds(notifIds.current[ipo.id] ?? []);
    const { ids, plans } = await scheduleForIpo(ipo, prefsRef.current);
    const next = { ...notifIds.current, [ipo.id]: ids };
    notifIds.current = next;
    persist(KEY_IDS, next);
    setScheduledCount(Object.values(next).reduce((sum, list) => sum + list.length, 0));
    return { ids, plans };
  }, [persist]);

  const toggleWatch = useCallback(
    async (ipo: IPO) => {
      const current = watchlistRef.current;
      const isOn = current.includes(ipo.id);

      if (isOn) {
        await cancelIds(notifIds.current[ipo.id] ?? []);
        const rest = { ...notifIds.current };
        delete rest[ipo.id];
        notifIds.current = rest;
        persist(KEY_IDS, rest);
        setScheduledCount(Object.values(rest).reduce((sum, list) => sum + list.length, 0));
        const next = current.filter((id) => id !== ipo.id);
        watchlistRef.current = next;
        setWatchlist(next);
        persist(KEY_WATCH, next);
        logAlert({
          ipoId: ipo.id,
          ipoName: ipo.name,
          kind: 'unwatch',
          title: `${ipo.name} removed`,
          body: 'Reminders for this IPO have been switched off.',
        });
        showToast(`${ipo.name} removed from your watchlist`, 'info');
        return false;
      }

      const next = [ipo.id, ...current];
      watchlistRef.current = next;
      setWatchlist(next);
      persist(KEY_WATCH, next);

      const { ids, plans } = await syncIpo(ipo);
      const planned = buildReminders(ipo, prefsRef.current);

      if (ids.length > 0) {
        logAlert({
          ipoId: ipo.id,
          ipoName: ipo.name,
          kind: 'scheduled',
          title: `${ids.length} reminder${ids.length === 1 ? '' : 's'} queued for ${ipo.name}`,
          body: plans.map((p) => `${p.title} - ${p.when}`).join('\n'),
        });
        showToast(`Watching ${ipo.name} - ${ids.length} reminder${ids.length === 1 ? '' : 's'} set`, 'up');
      } else if (notificationsSupported() && permission !== 'granted') {
        logAlert({
          ipoId: ipo.id,
          ipoName: ipo.name,
          kind: 'watch',
          title: `${ipo.name} added to your watchlist`,
          body: 'Turn on notifications in Settings to receive the reminders.',
        });
        showToast('Added to watchlist - enable notifications to get reminders', 'warn');
      } else {
        logAlert({
          ipoId: ipo.id,
          ipoName: ipo.name,
          kind: 'scheduled',
          title: `${ipo.name} added to your watchlist`,
          body:
            planned.length > 0
              ? `Reminder plan: ${planned.map((p) => `${p.title} (${p.when})`).join(', ')}. Push delivery needs the iOS/Android build.`
              : 'Every milestone for this issue has already passed.',
        });
        showToast(
          planned.length > 0
            ? `Watching ${ipo.name} - ${planned.length} reminder${planned.length === 1 ? '' : 's'} planned`
            : `Watching ${ipo.name}`,
          'up'
        );
      }
      return true;
    },
    [logAlert, permission, persist, showToast, syncIpo]
  );

  const rescheduleAll = useCallback(
    async (nextPrefs?: NotifPrefs) => {
      const effective = nextPrefs ?? prefsRef.current;
      const all: Record<string, string[]> = {};
      let count = 0;
      for (const id of watchlistRef.current) {
        const ipo = getIpo(id);
        if (!ipo) continue;
        await cancelIds(notifIds.current[id] ?? []);
        const { ids } = await scheduleForIpo(ipo, effective);
        all[id] = ids;
        count += ids.length;
      }
      notifIds.current = all;
      persist(KEY_IDS, all);
      setScheduledCount(count);
      return count;
    },
    [persist]
  );

  const setPref = useCallback(
    async (key: keyof NotifPrefs, value: boolean) => {
      const next = { ...prefsRef.current, [key]: value };
      prefsRef.current = next;
      setPrefs(next);
      persist(KEY_PREFS, next);
      if (permission === 'granted' && watchlistRef.current.length > 0) {
        const count = await rescheduleAll(next);
        showToast(
          count > 0
            ? `Reminders updated - ${count} queued for ${watchlistRef.current.length} watched IPO${
                watchlistRef.current.length === 1 ? '' : 's'
              }`
            : 'Preference saved - no reminder is due in future for this setting',
          'up'
        );
      } else {
        showToast('Reminder preference saved', 'info');
      }
    },
    [permission, persist, rescheduleAll, showToast]
  );

  const enableNotifications = useCallback(async () => {
    if (!notificationsSupported()) {
      showToast('Push reminders are available in the iOS and Android builds', 'warn');
      return false;
    }
    const granted = await requestPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) {
      const count = await rescheduleAll();
      logAlert({
        ipoId: '-',
        ipoName: 'Notifications',
        kind: 'system',
        title: 'Notifications enabled',
        body:
          count > 0
            ? `${count} reminder${count === 1 ? '' : 's'} scheduled across your watchlist.`
            : 'You are all set - reminders appear as soon as you watch an IPO.',
      });
      showToast(count > 0 ? `Notifications on - ${count} reminders scheduled` : 'Notifications enabled', 'up');
    } else {
      logAlert({
        ipoId: '-',
        ipoName: 'Notifications',
        kind: 'system',
        title: 'Notifications blocked',
        body: 'iOS or Android is blocking notifications for this app. Open system settings to allow them.',
      });
      showToast('Notifications were not allowed - check system settings', 'down');
    }
    return granted;
  }, [logAlert, rescheduleAll, showToast]);

  /* Keep the in-app log honest: when a scheduled reminder actually fires, log it. */
  useEffect(() => {
    const unsubscribe = subscribeToDelivered(({ ipoId, title, body }) => {
      logAlert({
        ipoId: ipoId ?? '-',
        ipoName: getIpo(ipoId ?? '')?.name ?? 'Reminder',
        kind: 'scheduled',
        title,
        body,
      });
    });
    return unsubscribe;
  }, [logAlert]);

  /* Re-arm reminders once at boot so a stale plan (or a date shift) cannot go unnoticed. */
  useEffect(() => {
    if (!ready || permission !== 'granted' || watchlistRef.current.length === 0) return;
    rescheduleAll().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, permission]);

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

  /**
   * Recomputes the board. The dataset is a bundled snapshot - there is no live feed to
   * poll - so this re-derives every date-dependent value and records when it ran.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const at = Date.now();
    setLastChecked(at);
    setBoardVersion((v) => v + 1);
    await persist(KEY_CHECKED, at);
    setRefreshing(false);
    showToast(`Board re-checked • data snapshot of ${DATA_AS_OF_LABEL}`, 'info');
  }, [persist, showToast]);

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
      boardVersion,
      refreshing,
      lastChecked,
      theme,
      themeMode,
      setThemeMode,
      watchlist,
      watchedIpos,
      isWatched: (id: string) => watchlist.includes(id),
      toggleWatch,
      prefs,
      setPref,
      rescheduleAll: async () => rescheduleAll(),
      scheduledCount,
      permission,
      enableNotifications,
      alerts,
      clearAlerts,
      refresh,
      toast,
      showToast,
      dismissToast,
    }),
    [
      ready,
      boardVersion,
      refreshing,
      lastChecked,
      theme,
      themeMode,
      setThemeMode,
      watchlist,
      watchedIpos,
      toggleWatch,
      prefs,
      setPref,
      rescheduleAll,
      scheduledCount,
      permission,
      enableNotifications,
      alerts,
      clearAlerts,
      refresh,
      toast,
      showToast,
      dismissToast,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
