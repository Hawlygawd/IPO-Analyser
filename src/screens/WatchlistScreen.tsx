import React, { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Theme } from '../theme';
import { useStore } from '../lib/store';
import { DATA_AS_OF_LABEL } from '../lib/ipoData';
import { diffDays, formatDay, parseISO, startOfToday } from '../lib/format';
import { nextMilestone } from '../lib/analysis';
import { IPOCard } from '../components/IPOCard';
import { EmptyState } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';
import { RootStackParamList } from '../navigation/types';

export function WatchlistScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { watchedIpos, isWatched, refresh, refreshing, permission, enableNotifications } = useStore();
  const today = startOfToday();

  const nextEvent = useMemo(() => {
    const upcoming = watchedIpos
      .map((ipo) => ({ ipo, step: nextMilestone(ipo) }))
      .filter((x) => diffDays(today, parseISO(x.step.date)) >= 0)
      .sort((a, b) => a.step.date.localeCompare(b.step.date));
    return upcoming[0] ?? null;
  }, [watchedIpos, today]);

  const showPermBanner = permission === 'denied' || permission === 'undetermined';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="Watchlist"
        subtitle={
          watchedIpos.length > 0
            ? `${watchedIpos.length} IPO${watchedIpos.length === 1 ? '' : 's'} \u2022 board as of ${DATA_AS_OF_LABEL}`
            : `Board as of ${DATA_AS_OF_LABEL}`
        }
      />

      {watchedIpos.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="star-outline"
          title="Nothing on your watchlist yet"
          message="Star an IPO to track its GMP, subscription and key dates in one place \u2014 and get a reminder on open, allotment and listing days."
          actionLabel="Browse live IPOs"
          onAction={() => navigation.navigate('Tabs', { screen: 'IPOs' })}
        />
      ) : (
        <FlatList
          data={watchedIpos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: 34 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primary} colors={[theme.primary]} />
          }
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {showPermBanner ? (
                <Pressable
                  onPress={enableNotifications}
                  style={({ pressed }) => [
                    styles.banner,
                    { backgroundColor: theme.warnSoft, borderColor: theme.mode === 'dark' ? theme.border : 'transparent' },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="notifications-off-outline" size={19} color={theme.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: theme.text }}>Reminders are switched off</Text>
                    <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 2 }}>
                      Tap to allow push alerts for open day, allotment and listing.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSub} />
                </Pressable>
              ) : null}

              {nextEvent ? (
                <View style={[styles.nextCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="alarm-outline" size={18} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: theme.textMuted }}>NEXT EVENT</Text>
                    <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.text, marginTop: 3 }} numberOfLines={1}>
                      {nextEvent.ipo.name} \u2022 {nextEvent.step.label.toLowerCase()}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: theme.textSub, marginTop: 2 }}>
                      {formatDay(nextEvent.step.date, true)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <IPOCard
              ipo={item}
              theme={theme}
              index={index}
              watched={isWatched(item.id)}
              onPress={() => navigation.navigate('IPODetail', { id: item.id })}
            />
          )}
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
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
});
