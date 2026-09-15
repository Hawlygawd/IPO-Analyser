import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, Theme, ThemeMode } from '../theme';
import { useStore } from '../lib/store';
import { formatIstTime, quoteAge, timeAgo } from '../lib/format';
import { dataAge } from '../lib/analysis';
import Constants from 'expo-constants';
import { Button, KeyValueRow, SectionCard } from '../components/ui';
import { AiKeyCard } from '../components/AiKeyCard';
import { ScreenHeader } from '../components/ScreenHeader';

const MODES: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const NOTIF_ROWS: { key: 'openDay' | 'lastDay' | 'allotment' | 'listing'; label: string; hint: string }[] = [
  { key: 'openDay', label: 'Bidding opens', hint: 'Opening morning + the evening before' },
  { key: 'lastDay', label: 'Last day to apply', hint: 'Before 5 PM close' },
  { key: 'allotment', label: 'Allotment day', hint: 'Basis of allotment finalised' },
  { key: 'listing', label: 'Listing day', hint: 'Shares debut' },
];

/** Where the published figures come from - one tap each, kept to a single row. */
const SOURCES = [
  { label: 'IPO Ji', url: 'https://www.ipoji.com/ipo-gmp' },
  { label: 'NSE', url: 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo' },
  { label: 'BSE', url: 'https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx' },
  { label: 'SEBI', url: 'https://www.sebi.gov.in/filings/public-issues.html' },
];

export function SettingsScreen({ theme }: { theme: Theme }) {
  const {
    themeMode,
    setThemeMode,
    prefs,
    setPref,
    permission,
    enableNotifications,
    watchlist,
    scheduledCount,
    rescheduleAll,
    refresh,
    refreshing,
    alerts,
    clearAlerts,
    showToast,
    ipos,
    live,
    boardAsOfLabel,
  } = useStore();

  const age = dataAge(new Date(), live.asOf ?? undefined);

  const permLabel =
    permission === 'granted'
      ? `Allowed • ${scheduledCount} reminder${scheduledCount === 1 ? '' : 's'} queued`
      : permission === 'denied'
        ? 'Blocked in system settings'
        : permission === 'unsupported'
          ? 'Needs the iOS or Android build'
          : 'Not enabled yet';

  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      showToast('Could not open that link', 'down');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="Settings"
        subtitle={`${watchlist.length} tracked • ${ipos.length} mainboard issues`}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionCard theme={theme} title="Appearance">
          <View style={styles.modeRow}>
            {MODES.map((mode) => {
              const active = themeMode === mode.key;
              return (
                <Pressable
                  key={mode.key}
                  onPress={() => setThemeMode(mode.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${mode.label} theme`}
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: active ? theme.primarySoft : theme.cardAlt,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Ionicons name={mode.icon} size={17} color={active ? theme.primary : theme.textSub} />
                  <Text
                    style={{ fontSize: 12.5, fontWeight: '700', color: active ? theme.primary : theme.textSub }}
                  >
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SectionCard>

        <SectionCard theme={theme} title="Reminders" style={{ marginTop: 12 }}>
          <View style={[styles.permRow, { backgroundColor: theme.cardAlt }]}>
            <Ionicons
              name={permission === 'granted' ? 'notifications' : 'notifications-off-outline'}
              size={17}
              color={permission === 'granted' ? theme.up : theme.warn}
            />
            <Text style={{ flex: 1, fontSize: 12.5, color: theme.textSub, fontWeight: '600' }}>{permLabel}</Text>
            {permission === 'granted' || permission === 'unsupported' ? null : (
              <Pressable
                onPress={enableNotifications}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Enable notifications"
              >
                <Text style={{ color: theme.primary, fontWeight: '800', fontSize: 12.5 }}>Enable</Text>
              </Pressable>
            )}
          </View>

          <View style={{ marginTop: 4 }}>
            {NOTIF_ROWS.map((row, i) => (
              <View
                key={row.key}
                style={[styles.switchRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}
              >
                <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: theme.text }}>{row.label}</Text>
                <Text style={{ fontSize: 11, color: theme.textMuted, marginRight: 8 }}>{row.hint}</Text>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => setPref(row.key, v)}
                  trackColor={{ true: theme.primary, false: theme.border }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel={row.label}
                />
              </View>
            ))}
          </View>

          {permission === 'unsupported' ? (
            <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 8, lineHeight: 16 }}>
              Reminders fire on the phone builds; this browser preview writes them to the reminder log instead.
            </Text>
          ) : (
            <Button
              theme={theme}
              label={refreshing ? 'Rescheduling…' : 'Reschedule reminders'}
              variant="ghost"
              icon="sync-outline"
              loading={refreshing}
              onPress={async () => {
                const count = await rescheduleAll();
                showToast(
                  count > 0
                    ? `${count} reminder${count === 1 ? '' : 's'} queued`
                    : 'Nothing to schedule - every date has passed',
                  'up'
                );
              }}
              style={{ marginTop: 6 }}
            />
          )}
        </SectionCard>

        <SectionCard
          theme={theme}
          title="Live data & sources"
          subtitle={
            live.fetchedAt
              ? `Checked ${timeAgo(live.fetchedAt)} • newest quote ${boardAsOfLabel}${
                  quoteAge(live.asOf, live.fetchedAt) ? ` (${quoteAge(live.asOf, live.fetchedAt)} old)` : ''
                }`
              : age.stale
                ? `Bundled snapshot ${age.label} - figures may have moved`
                : `Bundled snapshot ${age.label}`
          }
          style={{ marginTop: 12 }}
        >
          {live.sources.length > 0
            ? live.sources.map((source) => (
                <KeyValueRow
                  key={source.key}
                  theme={theme}
                  label={source.label}
                  value={
                    source.ok
                      ? `${source.rows ?? 0} rows${source.asOf ? ` • ${formatIstTime(source.asOf)}` : ''}${
                          source.note ? ` • ${source.note}` : ''
                        }`
                      : source.error
                        ? `unavailable (${source.error})`
                        : 'unavailable'
                  }
                  multiline
                />
              ))
            : null}

          <Button
            theme={theme}
            label={refreshing ? 'Checking…' : 'Re-check the board'}
            variant="soft"
            icon="refresh"
            loading={refreshing}
            onPress={refresh}
            style={{ marginTop: 10 }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: theme.textMuted }}>Official sources</Text>
            {SOURCES.map((source) => (
              <Pressable
                key={source.url}
                onPress={() => openLink(source.url)}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel={`Open ${source.label}`}
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: theme.cardAlt,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: theme.primary }}>{source.label}</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>

        <AiKeyCard theme={theme} />

        <SectionCard theme={theme} title="About" style={{ marginTop: 12 }}>
          <Text style={{ fontSize: 12.5, color: theme.textSub, lineHeight: 19 }}>
            Grey market quotes and subscription multiples for mainboard IPOs - never a listing-price prediction.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <Ionicons name="shield-checkmark-outline" size={15} color={theme.primary} />
            <Text style={{ flex: 1, fontSize: 11, color: theme.textMuted, lineHeight: 16 }}>
              Unofficial and unregulated; not investment advice.
            </Text>
            <Text style={{ fontSize: 11, color: theme.textMuted }}>
              v{appVersion()}
              {live.ai?.used ? ' • AI' : ''}
            </Text>
          </View>
          <Button
            theme={theme}
            label={alerts.length > 0 ? `Clear the reminder log (${alerts.length})` : 'Clear the reminder log'}
            variant="ghost"
            icon="trash-outline"
            disabled={alerts.length === 0}
            onPress={async () => {
              await clearAlerts();
              showToast('Reminder log cleared', 'info');
            }}
            style={{ marginTop: 6 }}
          />
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 4 }}>
            Watchlist, preferences and log stay on this device. No account, no analytics, no background calls.
          </Text>
        </SectionCard>
      </ScrollView>
    </View>
  );
}

/** The running version, straight from app.json - it must never drift from the build again. */
function appVersion(): string {
  try {
    return Constants.expoConfig?.version ?? '1.5.0';
  } catch {
    return '1.5.0';
  }
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 9 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  aboutPill: {
    flexDirection: 'row',
    gap: 9,
    padding: 11,
    borderRadius: radius.md,
    marginTop: 14,
    alignItems: 'flex-start',
  },
});
