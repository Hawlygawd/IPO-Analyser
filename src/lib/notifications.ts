import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { IPO, NotifPrefs } from './types';
import { parseISO, addDays, startOfToday } from './format';

let handlerInstalled = false;
let channelInstalled = false;

/** Android needs an explicit notification channel (best-effort). */
export function setupNotificationChannel(): void {
  if (Platform.OS !== 'android' || channelInstalled) return;
  channelInstalled = true;
  try {
    Notifications.setNotificationChannelAsync('reminders', {
      name: 'IPO reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#00A870',
    }).catch(() => undefined);
  } catch {
    // web / unsupported - ignore
  }
}

function installHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  try {
    Notifications.setNotificationHandler({
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

export function notificationsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function getPermissionState(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (!notificationsSupported()) return 'undetermined';
  try {
    installHandler();
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return 'granted';
    if (settings.status === Notifications.PermissionStatus.UNDETERMINED) return 'undetermined';
    return 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function requestPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    installHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return !!asked.granted;
  } catch {
    return false;
  }
}

function atHour(iso: string, hour: number, minute = 30): Date {
  const d = parseISO(iso);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function isFuture(date: Date): boolean {
  return date.getTime() > Date.now() + 5 * 60 * 1000;
}

interface ScheduledPlan {
  id: string;
  title: string;
  body: string;
  date: Date;
}

/** Builds the reminder set for a watched IPO based on the user's preferences. */
export function planForIpo(ipo: IPO, prefs: NotifPrefs): ScheduledPlan[] {
  const plans: ScheduledPlan[] = [];
  const today = startOfToday();

  if (prefs.openDay) {
    const openAt = atHour(ipo.openDate, 8, 45);
    if (isFuture(openAt)) {
      plans.push({
        id: `${ipo.id}-open`,
        title: `${ipo.name} opens today`,
        body: `Bidding starts now \u2022 price band ${
          ipo.priceBandHigh ? `\u20B9${ipo.priceBandLow}\u2013\u20B9${ipo.priceBandHigh}` : 'to be announced'
        }.`,
        date: openAt,
      });
    }
    const eveAt = new Date(atHour(ipo.openDate, 18, 0).getTime());
    eveAt.setDate(eveAt.getDate() - 1);
    if (isFuture(eveAt) && eveAt.getTime() > today.getTime()) {
      plans.push({
        id: `${ipo.id}-open-eve`,
        title: `${ipo.name} opens tomorrow`,
        body: 'Keep your UPI mandate ready to apply.',
        date: eveAt,
      });
    }
  }

  if (prefs.lastDay) {
    const lastAt = atHour(ipo.closeDate, 9, 15);
    if (isFuture(lastAt)) {
      plans.push({
        id: `${ipo.id}-close`,
        title: `Last day to apply \u2013 ${ipo.name}`,
        body: `Bidding closes at 5 PM on ${parseISO(ipo.closeDate).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        })}.`,
        date: lastAt,
      });
    }
  }

  if (prefs.allotment) {
    const allotAt = atHour(ipo.allotmentDate, 11, 0);
    if (isFuture(allotAt)) {
      plans.push({
        id: `${ipo.id}-allot`,
        title: `${ipo.name}: allotment day`,
        body: 'Basis of allotment is expected to be finalised today. Check your ASBA account.',
        date: allotAt,
      });
    }
  }

  if (prefs.listing) {
    const listAt = atHour(ipo.listingDate, 9, 15);
    if (isFuture(listAt)) {
      plans.push({
        id: `${ipo.id}-list`,
        title: `${ipo.name} lists today`,
        body: `Shares are expected to debut on ${ipo.exchanges.join(' & ')}.`,
        date: listAt,
      });
    }
  }

  return plans.slice(0, 6);
}

/** Schedules local notifications and returns their ids (empty on web). */
export async function scheduleForIpo(ipo: IPO, prefs: NotifPrefs): Promise<string[]> {
  if (!notificationsSupported()) return [];
  const granted = await getPermissionState();
  if (granted !== 'granted') return [];
  installHandler();
  const plans = planForIpo(ipo, prefs);
  const ids: string[] = [];
  for (const plan of plans) {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        identifier: plan.id,
        content: { title: plan.title, body: plan.body, data: { ipoId: ipo.id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.date },
      });
      ids.push(id);
    } catch {
      // ignore individual failures (e.g. platform not ready)
    }
  }
  return ids;
}

export async function cancelIds(ids: string[]): Promise<void> {
  if (!notificationsSupported() || ids.length === 0) return;
  try {
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  } catch {
    // no-op
  }
}

export async function cancelAll(): Promise<void> {
  if (!notificationsSupported()) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // no-op
  }
}
