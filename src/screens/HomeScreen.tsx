import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Theme } from '../theme';
import { useStore } from '../lib/store';
import { DATA_AS_OF_LABEL } from '../lib/ipoData';
import { IPO } from '../lib/types';
import { diffDays, formatUpdatedAt, gmpPercent, parseISO, startOfToday } from '../lib/format';
import { phaseOf } from '../lib/analysis';
import { IPOCard } from '../components/IPOCard';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { CardSkeleton, EmptyState } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';
import { RootStackParamList } from '../navigation/types';

type Tab = 'open' | 'upcoming' | 'closed';

export function HomeScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { refreshing, refresh, lastRefresh, dataMode, dataWarning, ipos, isWatched, alerts } = useStore();
  const [tab, setTab] = useState<Tab>('open');
  const [booted, setBooted] = useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setBooted(true), 550);
    return () => clearTimeout(t);
  }, []);

  const today = startOfToday();
  const dayKey = today.getTime();

  const buckets = useMemo(() => {
    const open: IPO[] = [];
    const upcoming: IPO[] = [];
    const closed: IPO[] = [];
    for (const ipo of ipos) {
      const phase = phaseOf(ipo, today);
      if (phase.key === 'open') open.push(ipo);
      else if (phase.key === 'upcoming') upcoming.push(ipo);
      else closed.push(ipo);
    }
    open.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    upcoming.sort((a, b) => a.openDate.localeCompare(b.openDate));
    closed.sort((a, b) => b.listingDate.localeCompare(a.listingDate));
    return { open, upcoming, closed };
  }, [ipos, dayKey]);

  const openingSoon = buckets.upcoming.filter((ipo) => {
    const days = diffDays(today, parseISO(ipo.openDate));
    return days >= 0 && days <= 6;
  });
  const nextUp = buckets.upcoming[0];
  const strongCount = ipos.filter((ipo) => {
    const pct = gmpPercent(ipo);
    const phase = phaseOf(ipo, today).key;
    return (phase === 'open' || phase === 'upcoming') && pct != null && pct >= 25;
  }).length;

  const data = tab === 'open' ? buckets.open : tab === 'upcoming' ? buckets.upcoming : buckets.closed;
  const statusLabel =
    dataMode === 'live'
      ? `Live · ${formatUpdatedAt(lastRefresh)}`
      : dataMode === 'limited'
        ? `Live · best-effort coverage · ${formatUpdatedAt(lastRefresh)}`
        : dataMode === 'cached'
          ? `Cached · ${formatUpdatedAt(lastRefresh)}`
          : dataMode === 'offline'
            ? `Offline snapshot · ${DATA_AS_OF_LABEL}`
            : 'Checking live sources…';

  const SummaryStrip = (
    <View style={styles.summaryRow}>
      <SummaryBox theme={theme} icon="radio-button-on" tone="up" label="Live now" value={String(buckets.open.length)} />
      <SummaryBox
        theme={theme}
        icon="time-outline"
        tone="info"
        label="Opening ≤ 6 days"
        value={String(openingSoon.length)}
      />
      <SummaryBox theme={theme} icon="trending-up" tone="warn" label="Strong GMP" value={String(strongCount)} />
    </View>
  );

  const header = (
    <View style={{ gap: 14, paddingHorizontal: 0 }}>
      {SummaryStrip}
      {dataMode === 'limited' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 16, padding: 10, borderRadius: 11, backgroundColor: theme.warnSoft }}>
          <Ionicons name="information-circle-outline" size={15} color={theme.warn} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, color: theme.textSub, fontSize: 11, lineHeight: 16 }}>
            Best-effort live coverage may be incomplete. Check Settings or the issue detail's source links for verification.
          </Text>
        </View>
      ) : null}
      {tab === 'open' && buckets.open.length === 0 && nextUp ? (
        <Animated.View entering={FadeIn.duration(260)} style={[styles.banner, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="moon-outline" size={17} color={theme.warn} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800' }}>
                No IPO is accepting bids today
              </Text>
              <Text style={{ color: theme.textSub, fontSize: 11.5, marginTop: 2 }}>
                {nextUp.name} opens in {diffDays(today, parseISO(nextUp.openDate))} days on {new Date(parseISO(nextUp.openDate)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}.
              </Text>
            </View>
          </View>
        </Animated.View>
      ) : null}
      <View style={{ paddingHorizontal: 16 }}>
        <SegmentedTabs
          theme={theme}
          value={tab}
          onChange={setTab}
          options={[
            { key: 'open', label: 'Open', count: buckets.open.length },
            { key: 'upcoming', label: 'Upcoming', count: buckets.upcoming.length },
            { key: 'closed', label: 'Closed', count: buckets.closed.length },
          ]}
        />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="IPO Pulse"
        subtitle={`${statusLabel} \u2022 ${ipos.length} IPOs tracked`}
        right={
          <Pressable
            onPress={() => navigation.navigate('Alerts')}
            style={({ pressed }) => [
              styles.bell,
              { backgroundColor: theme.card, borderColor: theme.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="notifications-outline" size={19} color={theme.text} />
            {alerts.length > 0 ? <View style={[styles.bellDot, { backgroundColor: theme.down }]} /> : null}
          </Pressable>
        }
      />

      {!booted ? (
        <View style={{ paddingTop: 4 }}>
          <CardSkeleton theme={theme} />
          <CardSkeleton theme={theme} />
          <CardSkeleton theme={theme} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 34 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primary} colors={[theme.primary]} />
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
          ListEmptyComponent={
            <EmptyState
              theme={theme}
              icon={tab === 'closed' ? 'checkmark-done-outline' : 'file-tray-outline'}
              title={tab === 'closed' ? 'No closed IPOs found' : tab === 'open' ? 'No IPOs open right now' : 'No upcoming IPOs found'}
              message={
                dataWarning ??
                (tab === 'closed'
                  ? 'Recently closed, allotment-stage and listed IPOs will appear here when a source reports them.'
                  : tab === 'open'
                    ? 'There are no IPOs accepting bids today. Pull down to check the live sources.'
                    : 'Upcoming issues will appear here as their dates are announced by a source.')
              }
              actionLabel={refreshing ? 'Refreshing…' : 'Refresh board'}
              onAction={refresh}
            />
          }
          ListFooterComponent={
            <Text style={[styles.footer, { color: theme.textMuted }]}>
              NSE/BSE public exchange pages, with optional IPOAlerts and IPO Guru cross-checks; availability and coverage can vary. \u2022 GMP is unofficial and not investment advice.
            </Text>
          }
        />
      )}
    </View>
  );
}

function SummaryBox({
  theme,
  icon,
  label,
  value,
  tone,
}: {
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: 'up' | 'info' | 'warn';
}) {
  const fg = tone === 'up' ? theme.up : tone === 'info' ? theme.info : theme.warn;
  const bg = tone === 'up' ? theme.upSoft : tone === 'info' ? theme.infoSoft : theme.warnSoft;
  return (
    <View style={[styles.summaryBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={11} color={fg} />
        </View>
        <Text numberOfLines={1} style={{ fontSize: 9.5, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.3, flex: 1 }}>
          {label}
        </Text>
      </View>
      <Text style={{ fontSize: 19, fontWeight: '800', color: theme.text, letterSpacing: -0.4 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 16 },
  summaryBox: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 11 },
  banner: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4 },
  footer: { textAlign: 'center', fontSize: 11, paddingHorizontal: 30, marginTop: 18, lineHeight: 16 },
});
