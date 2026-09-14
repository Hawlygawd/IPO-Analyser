import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';

import { countdownLabel, daysUntil, formatDay } from '../lib/format';
import { nextMilestone, phaseOf } from '../lib/analysis';
import { watchlistPlan } from '../lib/reminders';
import { IPOCard } from '../components/IPOCard';
import { Button, Chip, EmptyState } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';
import { LiveChip } from '../components/LiveChip';
import { RootStackParamList } from '../navigation/types';

export function WatchlistScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    watchedIpos,
    isWatched,
    toggleWatch,
    refresh,
    refreshing,
    permission,
    enableNotifications,
    scheduledCount,
    prefs,
    live,
    boardAsOfLabel,
  } = useStore();

  const remindersOff = prefs.openDay === false && prefs.lastDay === false && prefs.allotment === false && prefs.listing === false;

  /** On web nothing can be queued, so count what would fire instead of showing a bare zero. */
  const plannedCount = useMemo(() => watchlistPlan(watchedIpos, prefs).length, [watchedIpos, prefs]);
  const reminderSummary =
    permission === 'granted'
      ? `${scheduledCount} reminder${scheduledCount === 1 ? '' : 's'} queued`
      : `${plannedCount} reminder${plannedCount === 1 ? '' : 's'} planned`;

  const ordered = useMemo(() => {
    const withMilestone = watchedIpos.map((ipo) => ({ ipo, milestone: nextMilestone(ipo) }));
    return withMilestone
      .sort((a, b) => {
        const aDate = a.milestone?.date ?? '9999-12-31';
        const bDate = b.milestone?.date ?? '9999-12-31';
        return aDate.localeCompare(bDate);
      })
      .map((x) => x.ipo);
  }, [watchedIpos]);

  const nextEvent = useMemo(() => {
    const upcoming = watchedIpos
      .map((ipo) => ({ ipo, step: nextMilestone(ipo) }))
      .filter((x): x is { ipo: (typeof watchedIpos)[number]; step: NonNullable<ReturnType<typeof nextMilestone>> } =>
        Boolean(x.step) && daysUntil(x.step!.date) >= 0
      )
      .sort((a, b) => a.step.date.localeCompare(b.step.date));
    return upcoming[0] ?? null;
  }, [watchedIpos]);

  const showPermBanner = permission === 'denied' || permission === 'undetermined';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="Watchlist"
        subtitle={
          watchedIpos.length > 0
            ? `${watchedIpos.length} tracked • ${reminderSummary} • ${live.fetchedAt ? 'live' : 'snapshot'} ${boardAsOfLabel}`
            : `${live.fetchedAt ? 'Live' : 'Board snapshot'} ${boardAsOfLabel}`
        }
        right={<LiveChip theme={theme} live={live} asOfLabel={boardAsOfLabel} onPress={refresh} />}
      />

      {watchedIpos.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="star-outline"
          title="Nothing on your watchlist yet"
          message="Star an IPO to follow its premium, subscription and key dates in one place, and to queue reminders for the opening, allotment and listing days."
          actionLabel="Browse the board"
          onAction={() => navigation.navigate('Tabs', { screen: 'IPOs' })}
        />
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: 36 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          }
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {showPermBanner ? (
                <Pressable
                  onPress={enableNotifications}
                  accessibilityRole="button"
                  accessibilityLabel="Notifications are switched off. Tap to allow reminders."
                  style={({ pressed }) => [
                    styles.banner,
                    { backgroundColor: theme.warnSoft, borderColor: theme.border },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Ionicons name="notifications-off-outline" size={19} color={theme.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: theme.text }}>
                      Reminders are switched off
                    </Text>
                    <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 2, lineHeight: 16 }}>
                      Tap to allow alerts on the opening day, the last day to apply, allotment and listing.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSub} />
                </Pressable>
              ) : remindersOff ? (
                <Pressable
                  onPress={() => navigation.navigate('Tabs', { screen: 'Settings' })}
                  accessibilityRole="button"
                  accessibilityLabel="All reminder types are turned off. Open settings."
                  style={({ pressed }) => [
                    styles.banner,
                    { backgroundColor: theme.infoSoft, borderColor: theme.border },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Ionicons name="notifications-outline" size={19} color={theme.info} />
                  <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 16 }}>
                    <Text style={{ fontWeight: '800', color: theme.text }}>Every reminder type is off. </Text>
                    Turn at least one back on in Settings to be nudged about these IPOs.
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSub} />
                </Pressable>
              ) : null}

              {nextEvent ? (
                <Pressable
                  onPress={() => navigation.navigate('IPODetail', { id: nextEvent.ipo.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Next event: ${nextEvent.ipo.name}, ${nextEvent.step.label} on ${formatDay(
                    nextEvent.step.date,
                    true
                  )}`}
                  style={({ pressed }) => [
                    styles.nextCard,
                    { backgroundColor: theme.card, borderColor: theme.border },
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: theme.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="alarm-outline" size={18} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: theme.textMuted }}>
                      NEXT EVENT
                    </Text>
                    <Text
                      style={{ fontSize: 13.5, fontWeight: '800', color: theme.text, marginTop: 3 }}
                      numberOfLines={1}
                    >
                      {nextEvent.ipo.name} • {nextEvent.step.label.toLowerCase()}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 2 }}>
                      {formatDay(nextEvent.step.date, true)} • {countdownLabel(nextEvent.step.date)}
                    </Text>
                  </View>
                  <Chip
                    label={phaseOf(nextEvent.ipo).label}
                    tone={phaseOf(nextEvent.ipo).key === 'open' ? 'up' : 'info'}
                    theme={theme}
                    small
                  />
                </Pressable>
              ) : (
                <View style={[styles.banner, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                  <Ionicons name="checkmark-done-outline" size={18} color={theme.textMuted} />
                  <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 16 }}>
                    Every key date for these issues has passed. Star the next opening from the IPO board.
                  </Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item, index }) => (
            <IPOCard
              ipo={item}
              theme={theme}
              index={index}
              watched={isWatched(item.id)}
              onToggleWatch={toggleWatch}
              onPress={() => navigation.navigate('IPODetail', { id: item.id })}
            />
          )}
          ListFooterComponent={
            <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
              <Button
                theme={theme}
                label="Manage reminder settings"
                variant="ghost"
                icon="options-outline"
                onPress={() => navigation.navigate('Tabs', { screen: 'Settings' })}
              />
              <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 16 }}>
                Reminders fire on the iOS and Android builds. On web every scheduled reminder is listed in the
                reminder log.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
