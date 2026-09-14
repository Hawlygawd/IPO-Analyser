import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, Theme, ThemeMode } from '../theme';
import { useStore } from '../lib/store';
import { DATA_AS_OF_LABEL, DATA_SOURCE_LABEL, IPOT } from '../lib/ipoData';
import { formatIstTime, timeAgo } from '../lib/format';
import { dataAge } from '../lib/analysis';
import { Button, KeyValueRow, SectionCard } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';

const MODES: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const NOTIF_ROWS: { key: 'openDay' | 'lastDay' | 'allotment' | 'listing'; label: string; hint: string }[] = [
  { key: 'openDay', label: 'Bidding opens', hint: 'Morning of the opening day, plus a heads-up the evening before' },
  { key: 'lastDay', label: 'Last day to apply', hint: 'Before bidding closes at 5 PM' },
  { key: 'allotment', label: 'Allotment day', hint: 'When the basis of allotment is finalised' },
  { key: 'listing', label: 'Listing day', hint: 'When the shares debut on the exchange' },
];

const SOURCES = [
  { label: 'IPO Ji - GMP board, subscription & calendar', url: 'https://www.ipoji.com/ipo-gmp' },
  { label: 'NSE - current issues', url: 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo' },
  { label: 'BSE - public issues', url: 'https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx' },
  { label: 'SEBI - filings', url: 'https://www.sebi.gov.in/filings/public-issues.html' },
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
    lastChecked,
    alerts,
    clearAlerts,
    showToast,
  } = useStore();

  const age = dataAge();

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
        subtitle={`${watchlist.length} tracked • ${IPOT.length} issues in the snapshot`}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionCard theme={theme} title="Appearance" subtitle="Applies instantly across every screen">
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

        <SectionCard theme={theme} title="Reminders" style={{ marginTop: 14 }}>
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

          <View style={{ marginTop: 6 }}>
            {NOTIF_ROWS.map((row, i) => (
              <View
                key={row.key}
                style={[styles.switchRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.text }}>{row.label}</Text>
                  <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 2, lineHeight: 16 }}>
                    {row.hint}
                  </Text>
                </View>
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
            <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 12, lineHeight: 17 }}>
              Local reminders fire on the iOS and Android builds. In this browser preview every planned reminder is
              written to the reminder log instead, so you can see exactly what would be sent.
            </Text>
          ) : (
            <Button
              theme={theme}
              label={refreshing ? 'Rescheduling…' : 'Reschedule my reminders'}
              variant="soft"
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
              style={{ marginTop: 14 }}
            />
          )}
        </SectionCard>

        <SectionCard
          theme={theme}
          title="Data"
          subtitle={age.stale ? `Snapshot is ${age.label} - figures may have moved` : `Snapshot ${age.label}`}
          style={{ marginTop: 14 }}
        >
          <KeyValueRow theme={theme} label="Board snapshot" value={DATA_AS_OF_LABEL} />
          <KeyValueRow theme={theme} label="Snapshot source" value={DATA_SOURCE_LABEL} multiline />
          <KeyValueRow theme={theme} label="Issues tracked" value={String(IPOT.length)} />
          <KeyValueRow theme={theme} label="Last checked in app" value={`${timeAgo(lastChecked)} (${formatIstTime(lastChecked)})`} />
          <KeyValueRow theme={theme} label="Logged reminders" value={String(alerts.length)} />

          <Button
            theme={theme}
            label="Re-check the board"
            variant="ghost"
            icon="refresh"
            loading={refreshing}
            onPress={refresh}
            style={{ marginTop: 12 }}
          />
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 10, lineHeight: 16 }}>
            The board ships with the app as a verified snapshot - there is no live feed to poll, so re-checking
            recomputes every date-dependent value and stamps the time it ran.
          </Text>
        </SectionCard>

        <SectionCard theme={theme} title="Sources" style={{ marginTop: 14 }}>
          {SOURCES.map((source) => (
            <KeyValueRow
              key={source.url}
              theme={theme}
              label={source.label}
              value="Open"
              tone="primary"
              icon="open-outline"
              onPress={() => openLink(source.url)}
            />
          ))}
        </SectionCard>

        <SectionCard theme={theme} title="Privacy & data" style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>
            Your watchlist, reminder preferences, theme and reminder log are stored only on this device. The app has
            no account, sends no analytics and makes no network requests in the background.
          </Text>
          <Button
            theme={theme}
            label="Clear the reminder log"
            variant="danger"
            icon="trash-outline"
            disabled={alerts.length === 0}
            onPress={async () => {
              await clearAlerts();
              showToast('Reminder log cleared', 'info');
            }}
            style={{ marginTop: 14 }}
          />
        </SectionCard>

        <SectionCard theme={theme} title="About" style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>
            IPO Pulse keeps the primary market readable: the grey market quote, category-wise subscription, a derived
            demand signal and the four dates that decide everything - in plain language, without pretending to
            predict listing prices.
          </Text>
          <View style={[styles.aboutPill, { backgroundColor: theme.cardAlt }]}>
            <Ionicons name="shield-checkmark-outline" size={15} color={theme.primary} />
            <Text style={{ flex: 1, fontSize: 12, color: theme.textSub, lineHeight: 17 }}>
              Grey market premiums are unofficial and unregulated. Nothing here is investment advice - read the RHP
              and consider a SEBI-registered adviser.
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 12 }}>Version 1.1.0</Text>
        </SectionCard>
      </ScrollView>
    </View>
  );
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
