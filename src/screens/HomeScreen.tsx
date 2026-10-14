import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Theme } from '../theme';
import { useStore } from '../lib/store';
import { IPOT, DATA_AS_OF_DATE, DATA_AS_OF_LABEL } from '../lib/ipoData';
import { IPO, IpoPhase } from '../lib/types';
import { diffDays, formatDay, formatWeekday, gmpPercent, parseISO, pluralDays, startOfToday } from '../lib/format';
import { isUnconfirmed, phaseOf } from '../lib/analysis';
import { IPOCard } from '../components/IPOCard';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { CardSkeleton } from '../components/ui';
import { ScreenHeader } from '../components/ScreenHeader';
import { RootStackParamList } from '../navigation/types';

type Tab = 'open' | 'upcoming' | 'closed';

export function HomeScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { refreshing, refresh, lastRefresh, isWatched, alerts } = useStore();
  const [tab, setTab] = useState<Tab>('open');
  const [booted, setBooted] = useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setBooted(true), 550);
    return () => clearTimeout(t);
  }, []);

  // Re-evaluated on every render (cheap), memoised per calendar day so lists roll over at midnight.
  const todayKey = startOfToday().getTime();

  const board = useMemo(() => {
    const today = new Date(todayKey);
    const phases = new Map<string, IpoPhase>(IPOT.map((ipo) => [ipo.id, phaseOf(ipo, today).key]));
    const open: IPO[] = [];
    const upcoming: IPO[] = [];
    const closed: IPO[] = [];
    let liveCount = 0;
    let soonCount = 0;
    let awaitingCount = 0;
    for (const ipo of IPOT) {
      const phase = phases.get(ipo.id);
      if (phase === 'open') {
        open.push(ipo);
        liveCount += 1;
      } else if (phase === 'upcoming') {
        const inWindow = diffDays(today, parseISO(ipo.openDate)) <= 6;
        if (inWindow) soonCount += 1;
        (inWindow ? open : upcoming).push(ipo);
      } else if (phase === 'awaiting') {
        // Indicative dates lapsed without confirmation: still "upcoming", never "closed/listed".
        upcoming.push(ipo);
        awaitingCount += 1;
      } else closed.push(ipo);
    }
    open.sort((a, b) => a.closeDate.localeCompare(b.closeDate));
    // Dated issues first, then the ones still waiting for confirmed dates.
    upcoming.sort(
      (a, b) =>
        Number(phases.get(a.id) === 'awaiting') - Number(phases.get(b.id) === 'awaiting') ||
        a.openDate.localeCompare(b.openDate)
    );
    closed.sort((a, b) => b.listingDate.localeCompare(a.listingDate));

    const nextUp = [...IPOT]
      .sort((a, b) => a.openDate.localeCompare(b.openDate))
      .find((i) => phases.get(i.id) === 'upcoming');
    // GMP stops mattering once shares list - only count issues that haven't listed yet.
    const strongCount = IPOT.filter((i) => {
      const pct = gmpPercent(i);
      return phases.get(i.id) !== 'listed' && pct != null && pct >= 25;
    }).length;

    return { open, upcoming, closed, liveCount, soonCount, awaitingCount, nextUp, strongCount };
  }, [todayKey]);

  const today = new Date(todayKey);
  const { nextUp } = board;
  const nextUpIn = nextUp ? diffDays(today, parseISO(nextUp.openDate)) : 0;
  const boardAgeDays = diffDays(parseISO(DATA_AS_OF_DATE), today);
  const showStaleNotice = boardAgeDays >= 7;

  const data = tab === 'open' ? board.open : tab === 'upcoming' ? board.upcoming : board.closed;
  const updatedTime = new Date(lastRefresh).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  const SummaryStrip = (
    <View style={styles.summaryRow}>
      <SummaryBox theme={theme} icon="radio-button-on" tone="up" label="Live now" value={String(board.liveCount)} />
      {/* Only issues that haven't opened yet - live ones are already counted in "Live now". */}
      <SummaryBox
        theme={theme}
        icon="time-outline"
        tone="info"
        label="Opening ≤ 6 days"
        value={String(board.soonCount)}
      />
      <SummaryBox theme={theme} icon="trending-up" tone="warn" label="Strong GMP" value={String(board.strongCount)} />
    </View>
  );

  const header = (
    <View style={{ gap: 14, paddingHorizontal: 0 }}>
      {SummaryStrip}
      {showStaleNotice ? (
        <View style={[styles.banner, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.infoSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="hourglass-outline" size={17} color={theme.info} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800' }}>
                {`Board last updated ${pluralDays(boardAgeDays)} ago`}
              </Text>
              <Text style={{ color: theme.textSub, fontSize: 11.5, marginTop: 2, lineHeight: 16 }}>
                {`Figures are as of ${formatDay(DATA_AS_OF_DATE, true)}.${
                  board.awaitingCount > 0
                    ? ' Issues whose dates weren\u2019t confirmed by then are marked \u201CDates awaited\u201D under Upcoming.'
                    : ''
                }`}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
      {tab === 'open' && board.liveCount === 0 && nextUp ? (
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
                {`${nextUp.name} opens ${nextUpIn === 1 ? 'tomorrow' : `in ${pluralDays(nextUpIn)}`} on ${formatWeekday(nextUp.openDate)}${
                  isUnconfirmed(nextUp, 'open') ? ' (tentative)' : ''
                }.`}
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
            { key: 'open', label: 'Open', count: board.open.length },
            { key: 'upcoming', label: 'Upcoming', count: board.upcoming.length },
            { key: 'closed', label: 'Closed', count: board.closed.length },
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
        subtitle={`Updated ${updatedTime} \u2022 board as of ${DATA_AS_OF_LABEL}`}
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
            <View style={{ alignItems: 'center', paddingVertical: 46, paddingHorizontal: 32 }}>
              <Ionicons name="file-tray-outline" size={34} color={theme.textMuted} />
              <Text style={{ color: theme.text, fontWeight: '800', marginTop: 12, fontSize: 15.5 }}>
                Nothing in this list
              </Text>
              <Text style={{ color: theme.textSub, fontSize: 13, textAlign: 'center', marginTop: 5, lineHeight: 19 }}>
                {tab === 'closed'
                  ? 'Closed issues with allotment or listing status will appear here.'
                  : 'Check the other tabs for the full season calendar.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            <Text style={[styles.footer, { color: theme.textMuted }]}>
              Indicative data from public trackers • not investment advice.
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
