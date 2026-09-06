import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Theme, ThemeMode } from '../theme';
import { useStore } from '../lib/store';
import { DATA_AS_OF_LABEL, IPOT } from '../lib/ipoData';
import { Button, SectionCard } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';

const MODES: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const NOTIF_ROWS: { key: 'openDay' | 'lastDay' | 'allotment' | 'listing'; label: string; hint: string }[] = [
  { key: 'openDay', label: 'IPO opens', hint: 'Morning of the opening day' },
  { key: 'lastDay', label: 'Last day to apply', hint: 'Before bidding closes at 5 PM' },
  { key: 'allotment', label: 'Allotment result', hint: 'When the basis is finalised' },
  { key: 'listing', label: 'Listing day', hint: 'When shares debut on exchange' },
];

export function SettingsScreen({ theme }: { theme: Theme }) {
  const { themeMode, setThemeMode, prefs, setPref, permission, enableNotifications, watchlist, rescheduleAll, refresh } = useStore();

  const permLabel =
    permission === 'granted'
      ? 'Allowed'
      : permission === 'denied'
        ? 'Blocked in system settings'
        : permission === 'unsupported'
          ? 'Mobile app only'
          : 'Not enabled yet';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader theme={theme} large title="Settings" subtitle={`${watchlist.length} watched \u2022 ${IPOT.length} IPOs tracked`} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <SectionCard theme={theme} title="Appearance">
          <View style={styles.modeRow}>
            {MODES.map((mode) => {
              const active = themeMode === mode.key;
              return (
                <Pressable
                  key={mode.key}
                  onPress={() => setThemeMode(mode.key)}
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: active ? theme.primarySoft : theme.cardAlt,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Ionicons name={mode.icon} size={17} color={active ? theme.primary : theme.textSub} />
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: active ? theme.primary : theme.textSub }}>{mode.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </SectionCard>

        <SectionCard theme={theme} title="Push reminders" style={{ marginTop: 14 }}>
          <View style={[styles.permRow, { backgroundColor: theme.cardAlt }]}>
            <Ionicons
              name={permission === 'granted' ? 'notifications' : 'notifications-off-outline'}
              size={17}
              color={permission === 'granted' ? theme.up : theme.warn}
            />
            <Text style={{ flex: 1, fontSize: 12.5, color: theme.textSub, fontWeight: '600' }}>Permission: {permLabel}</Text>
            {permission === 'granted' || permission === 'unsupported' ? null : (
              <Pressable onPress={enableNotifications} hitSlop={8}>
                <Text style={{ color: theme.primary, fontWeight: '800', fontSize: 12.5 }}>Enable</Text>
              </Pressable>
            )}
          </View>

          <View style={{ marginTop: 6 }}>
            {NOTIF_ROWS.map((row, i) => (
              <View key={row.key} style={[styles.switchRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.text }}>{row.label}</Text>
                  <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 2 }}>{row.hint}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => setPref(row.key, v)}
                  trackColor={{ true: theme.primary, false: theme.border }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))}
          </View>

          {permission === 'unsupported' ? (
            <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 10, lineHeight: 17 }}>
              Local push notifications fire on the iOS and Android builds. On this preview, every scheduled
              reminder is logged in the Alerts tab instead.
            </Text>
          ) : (
            <Button
              theme={theme}
              label="Reschedule my reminders"
              variant="soft"
              icon="sync-outline"
              onPress={rescheduleAll}
              style={{ marginTop: 14 }}
            />
          )}
        </SectionCard>

        <SectionCard theme={theme} title="Data" style={{ marginTop: 14 }}>
          <RowLine theme={theme} label="Board updated" value={DATA_AS_OF_LABEL} />
          <RowLine theme={theme} label="IPOs tracked" value={String(IPOT.length)} />
          <RowLine theme={theme} label="Sources" value="IPO Ji \u2022 IPO Watch \u2022 IPO Central \u2022 ET Now \u2022 NDTV Profit" />
          <Button theme={theme} label="Refresh board" variant="ghost" icon="refresh" onPress={refresh} style={{ marginTop: 12 }} />
        </SectionCard>

        <SectionCard theme={theme} title="About" style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 13, color: theme.textSub, lineHeight: 20 }}>
            IPO Pulse keeps the season simple: grey market premium, subscription, trend and the four dates
            that matter. Tap any IPO for a plain-language take \u2014 no charts you need a finance degree for.
          </Text>
          <View style={[styles.aboutPill, { backgroundColor: theme.cardAlt }]}>
            <Ionicons name="shield-checkmark-outline" size={15} color={theme.primary} />
            <Text style={{ flex: 1, fontSize: 12, color: theme.textSub, lineHeight: 17 }}>
              Grey market data is unofficial and indicative. Nothing here is investment advice \u2014 always
              read the RHP before applying.
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 12 }}>Version 1.0.0</Text>
        </SectionCard>
      </ScrollView>
    </View>
  );
}

function RowLine({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={{ fontSize: 12.5, color: theme.textMuted, fontWeight: '600', flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 12.5, color: theme.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
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
    borderRadius: 12,
    borderWidth: 1.5,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 12,
    marginBottom: 4,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  dataRow: { flexDirection: 'row', paddingVertical: 6 },
  aboutPill: {
    flexDirection: 'row',
    gap: 9,
    padding: 11,
    borderRadius: 12,
    marginTop: 14,
    alignItems: 'flex-start',
  },
});
