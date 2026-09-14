import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { AlertLogItem } from '../lib/types';
import { formatDayShort, timeAgo } from '../lib/format';
import { watchlistPlan } from '../lib/reminders';
import { Button, Chip, EmptyState } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';

export function AlertsScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation();
  const { alerts, clearAlerts, permission, enableNotifications, watchedIpos, prefs } = useStore();

  const upcomingPlans = useMemo(() => watchlistPlan(watchedIpos, prefs).slice(0, 6), [watchedIpos, prefs]);

  const grouped = useMemo(() => {
    const today: AlertLogItem[] = [];
    const earlier: AlertLogItem[] = [];
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    for (const item of alerts) (item.at >= startOfDay ? today : earlier).push(item);
    return { today, earlier };
  }, [alerts]);

  const sections: { title: string; data: AlertLogItem[] }[] = [
    { title: 'Today', data: grouped.today },
    { title: 'Earlier', data: grouped.earlier },
  ].filter((section) => section.data.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        title="Reminder log"
        subtitle="Everything this app queued or logged for your watchlist"
        onBack={() => navigation.goBack()}
        right={
          alerts.length > 0 ? (
            <Pressable
              onPress={clearAlerts}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear the reminder log"
            >
              <Text style={{ color: theme.primary, fontWeight: '800', fontSize: 13 }}>Clear</Text>
            </Pressable>
          ) : undefined
        }
      />

      <FlatList
        data={sections}
        keyExtractor={(section) => section.title}
        contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            {permission !== 'granted' ? (
              <View style={[styles.permCard, { backgroundColor: theme.infoSoft, borderColor: theme.border }]}>
                <Ionicons name="notifications-outline" size={20} color={theme.info} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.text }}>
                    {permission === 'denied'
                      ? 'Notifications are blocked by the system'
                      : permission === 'unsupported'
                        ? 'Reminders need the iOS or Android build'
                        : 'Turn on push reminders'}
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 3, lineHeight: 17 }}>
                    {permission === 'unsupported'
                      ? 'This preview cannot post system notifications, so every reminder below is written to this log instead.'
                      : permission === 'denied'
                        ? 'Allow notifications for this app in your phone settings, then reschedule from Settings.'
                        : 'Get a nudge on the opening day, the last day to apply, allotment and listing.'}
                  </Text>
                </View>
                {permission === 'unsupported' || permission === 'denied' ? null : (
                  <Button
                    theme={theme}
                    label="Enable"
                    onPress={enableNotifications}
                    style={{ paddingHorizontal: 14, paddingVertical: 9 }}
                  />
                )}
              </View>
            ) : null}

            {upcomingPlans.length > 0 ? (
              <View style={[styles.planCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Ionicons name="alarm-outline" size={16} color={theme.primary} />
                  <Text style={{ fontSize: 13, fontWeight: '800', color: theme.text }}>Next in the plan</Text>
                  <View style={{ flex: 1 }} />
                  <Chip label={`${upcomingPlans.length} queued`} tone="primary" theme={theme} small />
                </View>
                {upcomingPlans.map((plan) => (
                  <View key={plan.id} style={styles.planRow}>
                    <Text style={{ fontSize: 11.5, color: theme.textMuted, fontWeight: '700', width: 96 }}>
                      {formatDayShort(plan.date)}
                    </Text>
                    <Text style={{ flex: 1, fontSize: 12, color: theme.textSub }} numberOfLines={2}>
                      {plan.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item: section }) => (
          <View>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '800',
                letterSpacing: 0.7,
                color: theme.textMuted,
                marginTop: 14,
                marginBottom: 8,
                textTransform: 'uppercase',
              }}
            >
              {section.title}
            </Text>
            {section.data.map((item, index) => (
              <LogRow key={item.id} item={item} theme={theme} index={index} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            theme={theme}
            icon="notifications-outline"
            title="Nothing logged yet"
            message="Star an IPO and every reminder this app queues for it - opening day, last day to apply, allotment and listing - shows up here."
            actionLabel="Back to the board"
            onAction={() => navigation.goBack()}
          />
        }
      />
    </View>
  );
}

function LogRow({ item, theme, index }: { item: AlertLogItem; theme: Theme; index: number }) {
  const icon =
    item.kind === 'watch'
      ? 'star'
      : item.kind === 'unwatch'
        ? 'star-outline'
        : item.kind === 'system'
          ? 'sync-outline'
          : 'alarm-outline';
  const color =
    item.kind === 'unwatch' ? theme.textMuted : item.kind === 'system' ? theme.info : theme.primary;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 30)}>
      <View style={[styles.item, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.text }} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 3, lineHeight: 17 }}>{item.body}</Text>
          <Text style={{ fontSize: 10.5, color: theme.textMuted, marginTop: 5, fontWeight: '600' }}>
            {timeAgo(item.at)}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  permCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  planCard: { padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  planRow: { flexDirection: 'row', gap: 8, paddingVertical: 5, alignItems: 'flex-start' },
  item: {
    flexDirection: 'row',
    gap: 11,
    padding: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: 9,
  },
});
