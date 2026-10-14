import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { DateKey, IPO, NotifPrefs } from './types';
import { parseISO, startOfToday, formatDay } from './format';
import { isUnconfirmed, phaseOf } from './analysis';

/** Android channel for reminders. Scheduled notifications must reference it via `trigger.channelId`. */
const CHANNEL_ID = 'reminders';

let handlerInstalled = false;
let channelInstalled = false;

/** Android needs an explicit notification channel (best-effort). */
export function setupNotificationChannel(): void {
  if (Platform.OS !== 'android' || channelInstalled) return;
  channelInstalled = true;
  try {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
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

type ReminderKind = 'open-eve' | 'open' | 'close' | 'allot' | 'list';

const KIND_ORDER: ReminderKind[] = ['open-eve', 'open', 'close', 'allot', 'list'];

const KIND_LABEL: Record<ReminderKind, string> = {
  'open-eve': 'day before opening',
  open: 'opening day',
  close: 'last day to apply',
  allot: 'allotment',
  list: 'listing',
};

/** Every identifier this app may have scheduled for an IPO (identifiers are deterministic). */
export function reminderIdsFor(ipoId: string): string[] {
  return KIND_ORDER.map((kind) => `${ipoId}-${kind}`);
}

interface ScheduledPlan {
  id: string;
  kind: ReminderKind;
  title: string;
  body: string;
  date: Date;
}

function tentativeNote(ipo: IPO, key: DateKey): string {
  return isUnconfirmed(ipo, key) ? ' Date is tentative \u2013 confirm before you bid.' : '';
}

/** Builds the reminder set for a watched IPO based on the user's preferences. */
export function planForIpo(ipo: IPO, prefs: NotifPrefs): ScheduledPlan[] {
  // The indicative opening date has already lapsed without confirmation, so any later
  // dates on the board are unreliable too - don't schedule reminders for them.
  if (phaseOf(ipo).key === 'awaiting') return [];

  const plans: ScheduledPlan[] = [];
  const today = startOfToday();

  if (prefs.openDay) {
    const eveAt = new Date(atHour(ipo.openDate, 18, 0).getTime());
    eveAt.setDate(eveAt.getDate() - 1);
    if (isFuture(eveAt) && eveAt.getTime() > today.getTime()) {
      plans.push({
        id: `${ipo.id}-open-eve`,
        kind: 'open-eve',
        title: `${ipo.name} opens tomorrow`,
        body: `Keep your UPI mandate ready to apply.${tentativeNote(ipo, 'open')}`,
        date: eveAt,
      });
    }
    const openAt = atHour(ipo.openDate, 8, 45);
    if (isFuture(openAt)) {
      plans.push({
        id: `${ipo.id}-open`,
        kind: 'open',
        title: `${ipo.name} opens today`,
        body: `Bidding starts now \u2022 price band ${
          ipo.priceBandHigh ? `\u20B9${ipo.priceBandLow}\u2013\u20B9${ipo.priceBandHigh}` : 'to be announced'
        }.${tentativeNote(ipo, 'open')}`,
        date: openAt,
      });
    }
  }

  if (prefs.lastDay) {
    const lastAt = atHour(ipo.closeDate, 9, 15);
    if (isFuture(lastAt)) {
      plans.push({
        id: `${ipo.id}-close`,
        kind: 'close',
        title: `Last day to apply \u2013 ${ipo.name}`,
        body: `Bidding closes at 5 PM on ${formatDay(ipo.closeDate)}.${tentativeNote(ipo, 'close')}`,
        date: lastAt,
      });
    }
  }

  if (prefs.allotment) {
    const allotAt = atHour(ipo.allotmentDate, 11, 0);
    if (isFuture(allotAt)) {
      plans.push({
        id: `${ipo.id}-allot`,
        kind: 'allot',
        title: `${ipo.name}: allotment day`,
        body: `Basis of allotment is expected to be finalised today. Check your ASBA account.${tentativeNote(ipo, 'allotment')}`,
        date: allotAt,
      });
    }
  }

  if (prefs.listing) {
    const listAt = atHour(ipo.listingDate, 9, 15);
    if (isFuture(listAt)) {
      plans.push({
        id: `${ipo.id}-list`,
        kind: 'list',
        title: `${ipo.name} lists today`,
        body: `Shares are expected to debut on ${ipo.exchanges.join(' & ')}.${tentativeNote(ipo, 'listing')}`,
        date: listAt,
      });
    }
  }

  return plans.slice(0, 6);
}

export interface ScheduleResult {
  /** identifiers of the notifications that were scheduled */
  ids: string[];
  /** human-readable reminder kinds that were scheduled, in chronological order */
  labels: string[];
  /** set when there *were* future reminders to schedule but the platform/permission blocked them */
  blocked?: 'unsupported' | 'permission';
}

/** Schedules local notifications for an IPO (nothing on web). */
export async function scheduleForIpo(ipo: IPO, prefs: NotifPrefs): Promise<ScheduleResult> {
  const plans = planForIpo(ipo, prefs);
  if (plans.length === 0) return { ids: [], labels: [] };
  if (!notificationsSupported()) return { ids: [], labels: [], blocked: 'unsupported' };
  const granted = await getPermissionState();
  if (granted !== 'granted') return { ids: [], labels: [], blocked: 'permission' };
  installHandler();
  const ids: string[] = [];
  const labels: string[] = [];
  for (const plan of plans) {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        identifier: plan.id,
        content: { title: plan.title, body: plan.body, data: { ipoId: ipo.id } },
        // Without `channelId`, Android 8+ posts to the default channel instead of "IPO reminders".
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.date, channelId: CHANNEL_ID },
      });
      ids.push(id);
      labels.push(KIND_LABEL[plan.kind]);
    } catch {
      // ignore individual failures (e.g. platform not ready)
    }
  }
  return { ids, labels };
}

export async function cancelIds(ids: string[]): Promise<void> {
  if (!notificationsSupported() || ids.length === 0) return;
  try {
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  } catch {
    // no-op
  }
}

/**
 * Cancels every reminder for an IPO: the ids we remember *and* all deterministic identifiers, so a
 * reminder type that was switched off (or ids lost from storage) can't keep firing.
 */
export async function cancelRemindersFor(ipoId: string, knownIds: string[] = []): Promise<void> {
  await cancelIds([...new Set([...knownIds, ...reminderIdsFor(ipoId)])]);
}

export async function cancelAll(): Promise<void> {
  if (!notificationsSupported()) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // no-op
  }
}

/** "a, b and c" */
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
