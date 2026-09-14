import { Platform } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';
import { IPO, NotifPrefs } from './types';
import { buildReminders, Reminder } from './reminders';

declare const require: (name: string) => unknown;

const ANDROID_CHANNEL = 'reminders';
let handlerInstalled = false;
let channelInstalled = false;
let notificationsLib: typeof NotificationsModule | null = null;

/**
 * expo-notifications is only useful on iOS and Android. Loading it lazily keeps its web
 * shim (and the "push tokens are not supported on web" warning) out of the web build.
 */
function notifications(): typeof NotificationsModule | null {
  if (!notificationsSupported()) return null;
  if (!notificationsLib) {
    try {
      notificationsLib = require('expo-notifications') as typeof NotificationsModule;
    } catch {
      return null;
    }
  }
  return notificationsLib;
}

/**
 * Android delivers scheduled notifications through a channel, and the channel decides how loudly
 * they arrive. Without one, reminders land on expo-notifications' fallback channel at default
 * importance: no heads-up card and no vibration, which is not what a "subscriptions close
 * tomorrow" reminder is for. Called before scheduling; harmless to call on iOS and web.
 */
export function setupNotificationChannel(): void {
  if (Platform.OS !== 'android' || channelInstalled) return;
  const lib = notifications();
  if (!lib) return;
  channelInstalled = true;
  try {
    lib
      .setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: 'IPO reminders',
        description: 'Bidding windows, allotment and listing dates on your watchlist',
        importance: lib.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#0B7A54',
      })
      .catch(() => {
        // let a later call try again rather than giving up for the whole session
        channelInstalled = false;
      });
  } catch {
    channelInstalled = false;
  }
}

function installHandler() {
  if (handlerInstalled) return;
  const lib = notifications();
  if (!lib) return;
  handlerInstalled = true;
  try {
    lib.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // web / unsupported - local scheduling is skipped gracefully
  }
}

/** expo-notifications is not available on web - reminders are logged in-app instead. */
export function notificationsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function getPermissionState(): Promise<'granted' | 'denied' | 'undetermined'> {
  const lib = notifications();
  if (!lib) return 'undetermined';
  try {
    installHandler();
    const settings = await lib.getPermissionsAsync();
    if (settings.granted) {
      // permission already granted: make sure the Android channel exists before the first schedule
      setupNotificationChannel();
      return 'granted';
    }
    if (settings.status === lib.PermissionStatus.UNDETERMINED) return 'undetermined';
    return 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function requestPermission(): Promise<boolean> {
  const lib = notifications();
  if (!lib) return false;
  try {
    installHandler();
    const current = await lib.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await lib.requestPermissionsAsync();
    if (asked.granted) setupNotificationChannel();
    return !!asked.granted;
  } catch {
    return false;
  }
}

export async function cancelIds(ids: string[]): Promise<void> {
  const lib = notifications();
  if (!lib || ids.length === 0) return;
  try {
    await Promise.all(ids.map((id) => lib.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  } catch {
    // no-op
  }
}

/**
 * Schedules the reminders for one IPO and returns the notification ids.
 * The plan itself is always returned, even when nothing could be scheduled, so the UI can
 * still describe what would fire.
 */
export async function scheduleForIpo(
  ipo: IPO,
  prefs: NotifPrefs
): Promise<{ ids: string[]; plans: Reminder[] }> {
  const plans = buildReminders(ipo, prefs);
  const lib = notifications();
  if (!lib) return { ids: [], plans };

  const granted = await getPermissionState();
  if (granted !== 'granted') return { ids: [], plans };
  installHandler();
  setupNotificationChannel();

  const ids: string[] = [];
  for (const plan of plans) {
    try {
      const id = await lib.scheduleNotificationAsync({
        identifier: plan.id,
        content: {
          title: plan.title,
          body: plan.body,
          data: { ipoId: ipo.id, milestone: plan.milestone },
        },
        trigger: {
          type: lib.SchedulableTriggerInputTypes.DATE,
          date: plan.date,
          // routes the reminder through the high-importance channel above on Android
          ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
        },
      });
      ids.push(id);
    } catch {
      // ignore individual failures (e.g. platform not ready)
    }
  }
  return { ids, plans };
}

/** Subscribes to delivered notifications so the in-app log stays in sync. */
export function subscribeToDelivered(
  onDelivered: (payload: { ipoId?: string; title: string; body: string }) => void
): () => void {
  const lib = notifications();
  if (!lib) return () => undefined;
  try {
    const subscription = lib.addNotificationReceivedListener((notification) => {
      onDelivered({
        ipoId: (notification.request.content.data?.ipoId as string) ?? '-',
        title: notification.request.content.title ?? 'IPO reminder',
        body: notification.request.content.body ?? '',
      });
    });
    return () => subscription.remove();
  } catch {
    return () => undefined;
  }
}

export { buildReminders, reminderPlanFor, watchlistPlan } from './reminders';
export type { Reminder } from './reminders';
