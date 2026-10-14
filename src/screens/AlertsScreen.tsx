import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { Button, EmptyState } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';

function timeAgo(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function AlertsScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation();
  const { alerts, clearAlerts, permission, enableNotifications } = useStore();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        title="Alerts"
        subtitle="Reminder log for your watchlist"
        onBack={() => navigation.goBack()}
        right={
          alerts.length > 0 ? (
            <Pressable onPress={clearAlerts} hitSlop={10}>
              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 13 }}>Clear</Text>
            </Pressable>
          ) : undefined
        }
      />

      {permission !== 'granted' ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={[styles.permCard, { backgroundColor: theme.infoSoft }]}>
            <Ionicons name="notifications-outline" size={20} color={theme.info} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.text }}>
                {permission === 'denied' ? 'Notifications are blocked' : permission === 'unsupported' ? 'Mobile app reminders' : 'Turn on push reminders'}
              </Text>
              <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 3, lineHeight: 17 }}>
                {permission === 'unsupported'
                  ? 'Local push alerts fire on the iOS and Android builds. The web preview logs every reminder here instead.'
                  : 'Get a nudge on open day, the last day to apply, allotment and listing.'}
              </Text>
            </View>
            {permission === 'unsupported' ? null : (
              <Button theme={theme} label="Enable" onPress={enableNotifications} variant="primary" style={{ paddingHorizontal: 14, paddingVertical: 9 }} />
            )}
          </View>
        </View>
      ) : null}

      {alerts.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="notifications-outline"
          title="No alerts yet"
          message="Add an IPO to your watchlist and its key dates \u2014 open, close, allotment and listing \u2014 will be queued here."
        />
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: 34 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const icon =
              item.kind === 'watch'
                ? 'star'
                : item.kind === 'unwatch'
                  ? 'star-outline'
                  : item.kind === 'system'
                    ? 'sync-outline'
                    : 'alarm-outline';
            const color = item.kind === 'unwatch' ? theme.textMuted : theme.primary;
            return (
              <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 35)}>
                <View style={[styles.item, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.text }}>{item.title}</Text>
                    <Text style={{ fontSize: 12, color: theme.textSub, marginTop: 3, lineHeight: 17 }}>{item.body}</Text>
                    <Text style={{ fontSize: 10.5, color: theme.textMuted, marginTop: 5, fontWeight: '600' }}>{timeAgo(item.at)}</Text>
                  </View>
                </View>
              </Animated.View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  permCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
  },
  item: {
    flexDirection: 'row',
    gap: 11,
    padding: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: 9,
  },
});
