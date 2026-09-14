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
import { AppState, Platform, useColorScheme } from 'react-native';
import { AlertLogItem, NotifPrefs, IPO } from './types';
import { ThemeMode } from '../theme';
import { darkTheme, lightTheme, Theme } from '../theme';
import { IPOT, DATA_AS_OF, DATA_AS_OF_LABEL } from './ipoData';
import {
  failedSourceStatuses,
  mergeBoard,
  pullLiveBoard,
  istLabel,
  type LiveBoard,
  type LiveSourceStatus,
  emptyParsedLive,
  type ParsedLive,
} from './live';
import { aiBoardSearch, aiSourceStatus, aiIdleStatus, type AiSearchResult } from './ai/search';
import { whenAiReady } from './ai/settings';
import { providerSpec } from './ai/providers';
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
const KEY_LIVE = '@ipo_pulse/live';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type LiveState = 'idle' | 'loading' | 'live' | 'ai' | 'offline';

/** What the AI assist did on the last pull. */
export interface AiPullInfo {
  /** true when at least one figure on the board came from the model */
  used: boolean;
  /** a key is saved and enabled, whether or not it was needed */
  armed: boolean;
  providerLabel: string;
  model: string;
  /** rows the model returned */
  rows: number;
  /** rows that could not be believed and were dropped */
  rejected: number;
  search: boolean;
  note: string | null;
  error: string | null;
}

export interface LiveInfo {
  state: LiveState;
  /** when the last successful pull finished */
  fetchedAt: number | null;
  /** newest upstream stamp we could prove (quote time), ISO */
  asOf: string | null;
  error: string | null;
  /** figures that changed on the last pull */
  updated: number;
  /** issues the last pull discovered */
  added: number;
  sources: LiveSourceStatus[];
  /** the AI assist's part in this pull, null when no key is saved */
  ai: AiPullInfo | null;
}
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
  /** the board the screens render: bundled snapshot with any live pull merged over it */
  ipos: IPO[];
  findIpo: (id: string) => IPO | undefined;
  /** newest upstream stamp behind `ipos`, ISO */
  boardAsOf: string;
  /** human label for `boardAsOf`, e.g. "14 Sep 2026, 5:30 PM IST" */
  boardAsOfLabel: string;
  live: LiveInfo;
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
  /** forces the AI assist to search even when the boards answered */
  refreshWithAi: () => Promise<void>;
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
  const [board, setBoard] = useState<IPO[]>(IPOT);
  const [boardAsOf, setBoardAsOf] = useState<string>(DATA_AS_OF);
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [liveFetchedAt, setLiveFetchedAt] = useState<number | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveUpdated, setLiveUpdated] = useState(0);
  const [liveAdded, setLiveAdded] = useState(0);
  const [liveSources, setLiveSources] = useState<LiveSourceStatus[]>([]);
  const [liveAi, setLiveAi] = useState<AiPullInfo | null>(null);

  // refs mirror the state the async notification code needs to read
  const notifIds = useRef<Record<string, string[]>>({});
  const watchlistRef = useRef<string[]>([]);
  const prefsRef = useRef<NotifPrefs>(DEFAULT_PREFS);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef<IPO[]>(IPOT);
  const liveFetchedRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

  watchlistRef.current = watchlist;
  prefsRef.current = prefs;
  boardRef.current = board;
  liveFetchedRef.current = liveFetchedAt;

  /** Looks the issue up in the live board first, then in the bundled snapshot. */
  const findIpo = useCallback(
    (id: string) => boardRef.current.find((ipo) => ipo.id === id) ?? IPOT.find((ipo) => ipo.id === id),
    []
  );

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
        // multiGet, not the newer getMany: it is the API that async-storage 2.x (the version
        // Expo SDK 57 pins) actually exports, and it is all we need here.
        const stored = await AsyncStorage.multiGet([
          KEY_WATCH,
          KEY_PREFS,
          KEY_ALERTS,
          KEY_THEME,
          KEY_IDS,
          KEY_CHECKED,
          KEY_LIVE,
        ]);
        const map: Record<string, string | null> = Object.fromEntries(stored);
        if (map[KEY_WATCH]) {
          const parsed = JSON.parse(map[KEY_WATCH]);
          if (Array.isArray(parsed)) {
            // drop any ids that are no longer on the board
            const clean = parsed.filter((id: string) => Boolean(findIpo(id)));
            setWatchlist(clean);
            watchlistRef.current = clean;
          }
        }
        if (map[KEY_PREFS]) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(map[KEY_PREFS]) });
        if (map[KEY_ALERTS]) setAlerts(JSON.parse(map[KEY_ALERTS]));
        if (map[KEY_THEME]) setThemeModeState(JSON.parse(map[KEY_THEME]));
        if (map[KEY_IDS]) notifIds.current = JSON.parse(map[KEY_IDS]);
        if (map[KEY_CHECKED]) setLastChecked(Number(map[KEY_CHECKED]) || Date.now());
        if (map[KEY_LIVE]) {
          // last successful pull: show it immediately, the network call below replaces it
          const cached = JSON.parse(map[KEY_LIVE]) as LiveBoard & { ai?: AiPullInfo | null };
          if (Array.isArray(cached?.ipos) && cached.ipos.length > 0 && cached.fetchedAt) {
            boardRef.current = cached.ipos;
            liveFetchedRef.current = cached.fetchedAt;
            setBoard(cached.ipos);
            setBoardAsOf(cached.asOf ?? DATA_AS_OF);
            setLiveFetchedAt(cached.fetchedAt);
            setLiveUpdated(cached.updated ?? 0);
            setLiveAdded(cached.added ?? 0);
            setLiveSources(cached.sources ?? []);
            // remember whether the figures on screen came from the boards or from the AI assist
            if (cached.ai) setLiveAi(cached.ai);
            setLiveState(cached.ai?.used && (cached.ai.rows ?? 0) > 0 ? 'ai' : 'live');
          }
        }
      } catch {
        // start fresh on any storage error
      }
      const state = await getPermissionState();
      setPermission(notificationsSupported() ? state : 'unsupported');

      const idCount = Object.values(notifIds.current).reduce((sum, ids) => sum + ids.length, 0);
      setScheduledCount(idCount);
      setReady(true);
    })();
  }, [findIpo]);

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
        const ipo = findIpo(id);
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
        ipoName: findIpo(ipoId ?? '')?.name ?? 'Reminder',
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
   * Pulls the upstream boards, merges them over the snapshot and caches the result.
   *
   * When a board pull fails or comes back with no quotes - the usual sign that the site is
   * blocking this network or has changed shape - and the user has saved an API key, the same
   * refresh asks the AI assist to search the web for the figures. Published board data always
   * wins over anything the model says (merge.ts enforces it), and `silent` is used for the
   * boot/foreground refresh so it never interrupts with a toast.
   */
  const pullLive = useCallback(
    async (silent: boolean, options: { forceAi?: boolean } = {}): Promise<boolean> => {
      if (pullingRef.current) return false;
      pullingRef.current = true;
      setLiveState('loading');
      const useProxy = Platform.OS === 'web';
      try {
        // the keychain read may still be in flight during the boot pull
        const ai = await whenAiReady(4000);
        const armed = Boolean(ai.key && ai.enabled);

        let direct: Awaited<ReturnType<typeof pullLiveBoard>> | null = null;
        let directError: string | null = null;
        try {
          direct = await pullLiveBoard(IPOT, { useProxy });
        } catch (error) {
          directError = error instanceof Error ? error.message : String(error);
        }

        // Ask the model only when it is worth a request: the boards failed, or they answered
        // without a single premium or subscription figure to show.
        const thin =
          !direct ||
          (direct.parsed.gmp.rows.length === 0 &&
            direct.parsed.gmpAlt.rows.length === 0 &&
            direct.parsed.subscription.rows.length === 0);
        let search: AiSearchResult | null = null;
        if (armed && (thin || options.forceAi)) {
          search = await aiBoardSearch(IPOT, {
            key: ai.key ?? '',
            providerId: ai.providerId,
            model: ai.model,
            baseUrl: ai.baseUrl,
            search: true,
            useProxy,
          });
        }

        if (!direct && !search?.ok) {
          throw new Error(search?.error ?? directError ?? 'no data in the upstream pages');
        }

        const fetchedAt = Date.now();
        const parsed: ParsedLive = direct
          ? {
              ...direct.parsed,
              ai: search?.ok
                ? { rows: search.rows, asOf: search.asOf, rejected: search.rejected }
                : { rows: [] },
            }
          : emptyParsedLive(
              search?.ok
                ? { rows: search.rows, asOf: search.asOf, rejected: search.rejected }
                : { rows: [] }
            );

        const aiInfo: AiPullInfo | null = search
          ? {
              used: search.ok && parsed.ai.rows.length > 0,
              armed,
              providerLabel: search.providerLabel,
              model: search.model,
              rows: search.rows.length,
              rejected: search.rejected,
              search: search.search,
              note: search.hint ?? null,
              error: search.ok ? null : (search.error ?? null),
            }
          : armed
            ? {
                used: false,
                armed: true,
                providerLabel: providerSpec(ai.providerId).label,
                model: ai.model ?? providerSpec(ai.providerId).modelFallback,
                rows: 0,
                rejected: 0,
                search: false,
                note: 'armed - used only when the boards fail',
                error: null,
              }
            : null;

        const sources: LiveSourceStatus[] = [
          ...(search
            ? [aiSourceStatus(search)]
            : armed && aiInfo
              ? [aiIdleStatus(`${aiInfo.providerLabel} • ${aiInfo.model} ${aiInfo.note ?? ''}`.trim())]
              : []),
          ...(direct ? direct.board.sources : failedSourceStatuses(directError ?? 'unreachable')),
        ];

        const next = mergeBoard(IPOT, parsed, { fetchedAt, sources });
        boardRef.current = next.ipos;
        liveFetchedRef.current = next.fetchedAt;
        setBoard(next.ipos);
        setBoardAsOf(next.asOf);
        setLiveFetchedAt(next.fetchedAt);
        setLiveUpdated(next.updated);
        setLiveAdded(next.added);
        setLiveSources(next.sources);
        setLiveAi(aiInfo);
        setLiveError(direct ? null : directError);
        setLiveState(direct ? 'live' : 'ai');
        setBoardVersion((version) => version + 1);
        const at = Date.now();
        setLastChecked(at);
        persist(KEY_CHECKED, at);
        // the cache carries the AI note too, so a relaunch keeps saying where the figures came from
        persist(KEY_LIVE, { ...next, ai: aiInfo });

        if (!silent) {
          const parts = [
            direct ? `Live data • ${istLabel(next.asOf)}` : `AI web search • ${istLabel(next.asOf)}`,
            next.updated > 0 ? `${next.updated} updated` : 'no figure moved',
            next.added > 0 ? `${next.added} new` : null,
            aiInfo?.used ? `${aiInfo.rows} from ${aiInfo.providerLabel}` : null,
          ].filter(Boolean);
          showToast(parts.join(' • '), direct ? 'up' : 'info');
          logAlert({
            ipoId: '-',
            ipoName: 'Live update',
            kind: 'system',
            title: direct ? 'Board refreshed from IPO Ji' : 'Board refreshed by AI web search',
            body: direct
              ? `${next.updated} of ${next.ipos.length} issues changed, ${next.added} new. Newest upstream stamp ${istLabel(
                  next.asOf
                )}.`
              : `The IPO Ji boards could not be read (${directError ?? 'no rows'}), so ${
                  aiInfo?.providerLabel ?? 'your key'
                } searched the web: ${next.updated} of ${next.ipos.length} issues changed. Newest stamp ${istLabel(
                  next.asOf
                )}.`,
          });
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLiveError(message);
        setLiveState(liveFetchedRef.current ? 'live' : 'offline');
        if (!silent) {
          showToast(`Could not reach the live boards (${message}) - showing the saved snapshot`, 'warn');
        }
        return false;
      } finally {
        pullingRef.current = false;
      }
    },
    [logAlert, persist, showToast]
  );

  /**
   * User-initiated refresh: pull the live boards, and fall back to re-deriving the
   * bundled snapshot (dates, phases) when the device is offline.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const ok = await pullLive(false);
    if (!ok) {
      setBoardVersion((version) => version + 1);
      const at = Date.now();
      setLastChecked(at);
      await persist(KEY_CHECKED, at);
    }
    setRefreshing(false);
  }, [persist, pullLive]);

  /** Same refresh, but the AI assist searches even when the boards answered (spends one request). */
  const refreshWithAi = useCallback(async () => {
    setRefreshing(true);
    await pullLive(false, { forceAi: true });
    setRefreshing(false);
  }, [pullLive]);

  /** First pull after boot, then one per foreground return when the data has aged. */
  useEffect(() => {
    if (!ready) return;
    // Let the first frame settle before the pull re-renders the board: a network call that
    // lands mid-paint costs more than the milliseconds it saves.
    const timer = setTimeout(() => {
      pullLive(true).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [pullLive, ready]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const last = liveFetchedRef.current;
      if (last && Date.now() - last < 10 * 60 * 1000) return;
      pullLive(true).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [pullLive]);

  const theme = useMemo(() => {
    const resolved = themeMode === 'system' ? (systemScheme ?? 'light') : themeMode;
    return resolved === 'dark' ? darkTheme : lightTheme;
  }, [themeMode, systemScheme]);

  const watchedIpos = useMemo(
    () => watchlist.map((id) => findIpo(id)).filter((x): x is IPO => Boolean(x)),
    [findIpo, watchlist]
  );

  const live = useMemo<LiveInfo>(
    () => ({
      state: liveState,
      fetchedAt: liveFetchedAt,
      asOf: liveFetchedAt ? boardAsOf : null,
      error: liveError,
      updated: liveUpdated,
      added: liveAdded,
      sources: liveSources,
      ai: liveAi,
    }),
    [boardAsOf, liveAdded, liveAi, liveError, liveFetchedAt, liveSources, liveState, liveUpdated]
  );

  const boardAsOfLabel = liveFetchedAt ? istLabel(boardAsOf) : DATA_AS_OF_LABEL;

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      boardVersion,
      refreshing,
      lastChecked,
      theme,
      themeMode,
      setThemeMode,
      ipos: board,
      findIpo,
      boardAsOf,
      boardAsOfLabel,
      live,
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
      refreshWithAi,
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
      board,
      boardAsOf,
      boardAsOfLabel,
      findIpo,
      live,
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
