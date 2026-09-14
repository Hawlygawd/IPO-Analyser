import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { DATA_AS_OF_LABEL, DATA_SOURCE_LABEL } from '../lib/ipoData';
import { IPO } from '../lib/types';
import { daysUntil, formatIstTime } from '../lib/format';
import { dataAge } from '../lib/analysis';
import { BoardTab, SortKey, bucketBoard, boardStats, sortIpos } from '../lib/board';
import { IPOCard } from '../components/IPOCard';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { IconButton, Row } from '../components/ui';
import { SummaryTile } from '../components/Charts';
import { ScreenHeader } from '../components/ScreenHeader';
import { LiveChip } from '../components/LiveChip';
import { RootStackParamList } from '../navigation/types';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'closing', label: 'Closing next' },
  { key: 'premium', label: 'Top premium' },
  { key: 'size', label: 'Issue size' },
  { key: 'name', label: 'A–Z' },
];

export function HomeScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { refreshing, refresh, isWatched, toggleWatch, alerts, boardVersion, ipos, live, boardAsOfLabel } = useStore();
  const [tab, setTab] = useState<BoardTab>('open');
  const [sort, setSort] = useState<SortKey>('closing');

  const board = useMemo(() => bucketBoard(ipos), [boardVersion, ipos]);
  const stats = useMemo(() => boardStats(ipos), [boardVersion, ipos]);
  const age = useMemo(() => dataAge(new Date(), live.asOf ?? undefined), [boardVersion, live.asOf]);

  const list: IPO[] = useMemo(() => {
    const bucket = tab === 'open' ? board.open : tab === 'soon' ? board.soon : board.closed;
    return sortIpos(bucket, sort);
  }, [board, tab, sort]);

  const openingSoonBanner =
    tab === 'open' && stats.live === 0 && stats.nextToOpen ? stats.nextToOpen : null;
  const closingToday = tab === 'open' ? stats.closingToday : undefined;

  const header = (
    <View style={{ gap: 12 }}>
      {live.state === 'live' && live.fetchedAt ? (
        <Animated.View
          entering={FadeIn.duration(240)}
          style={[styles.callout, { backgroundColor: theme.upSoft, borderColor: theme.border }]}
        >
          <Ionicons name="pulse-outline" size={17} color={theme.up} />
          <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 16 }}>
            <Text style={{ fontWeight: '800', color: theme.text }}>Live from {DATA_SOURCE_LABEL}. </Text>
            Newest upstream stamp {boardAsOfLabel}
            {live.updated > 0 ? ` • ${live.updated} figure${live.updated === 1 ? '' : 's'} updated` : ''}
            {live.added > 0 ? ` • ${live.added} new issue${live.added === 1 ? '' : 's'}` : ''}. Pull down to refresh.
          </Text>
          <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="Refresh from the live boards">
            <Text style={{ fontSize: 11.5, fontWeight: '800', color: theme.primary }}>Refresh</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {live.state === 'ai' && live.fetchedAt ? (
        <Animated.View
          entering={FadeIn.duration(240)}
          style={[styles.callout, { backgroundColor: theme.infoSoft, borderColor: theme.border }]}
        >
          <Ionicons name="sparkles-outline" size={17} color={theme.info} />
          <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 16 }}>
            <Text style={{ fontWeight: '800', color: theme.text }}>
              Live web search{live.ai ? ` by ${live.ai.providerLabel} • ${live.ai.model}` : ''}.{' '}
            </Text>
            The IPO Ji boards could not be read on this network, so your saved key searched the web for the
            latest figures{live.ai?.used ? ` (${live.ai.rows} rows` : ' ('}
            {live.updated > 0 ? `, ${live.updated} figure${live.updated === 1 ? '' : 's'} updated` : ''}). Newest
            reported stamp {boardAsOfLabel}. AI-found figures are labelled throughout - double-check them on the
            source page before you bid.
          </Text>
          <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="Search the web again">
            <Text style={{ fontSize: 11.5, fontWeight: '800', color: theme.primary }}>Again</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {live.state !== 'live' && live.state !== 'ai' && age.stale ? (
        <Animated.View
          entering={FadeIn.duration(240)}
          style={[styles.callout, { backgroundColor: theme.warnSoft, borderColor: theme.border }]}
        >
          <Ionicons name="time-outline" size={17} color={theme.warn} />
          <Text style={{ flex: 1, fontSize: 11.5, color: theme.textSub, lineHeight: 16 }}>
            <Text style={{ fontWeight: '800', color: theme.text }}>Snapshot {age.label}. </Text>
            {live.error
              ? `The live boards could not be reached (${live.error}), so these are exactly the figures ${DATA_SOURCE_LABEL} recorded on ${DATA_AS_OF_LABEL}.`
              : `Figures are exactly as ${DATA_SOURCE_LABEL} recorded them on ${DATA_AS_OF_LABEL}.`}{' '}
            Check the exchange or registrar before bidding.
          </Text>
          <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="Try the live boards again">
            <Text style={{ fontSize: 11.5, fontWeight: '800', color: theme.primary }}>Retry</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {openingSoonBanner ? (
        <Pressable
          onPress={() => navigation.navigate('IPODetail', { id: openingSoonBanner.id })}
          accessibilityRole="button"
          accessibilityLabel={`${openingSoonBanner.name} opens in ${daysUntil(
            openingSoonBanner.openDate
          )} days. Open the IPO.`}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: theme.card, borderColor: theme.border },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={[styles.bannerIcon, { backgroundColor: theme.warnSoft }]}>
            <Ionicons name="moon-outline" size={17} color={theme.warn} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800' }}>No IPO is accepting bids today</Text>
            <Text style={{ color: theme.textSub, fontSize: 11.5, marginTop: 2, lineHeight: 16 }}>
              {openingSoonBanner.name} opens in {daysUntil(openingSoonBanner.openDate)} days. Tap to see the price band
              and reminders.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        </Pressable>
      ) : null}

      {closingToday ? (
        <Pressable
          onPress={() => navigation.navigate('IPODetail', { id: closingToday.id })}
          accessibilityRole="button"
          accessibilityLabel={`${closingToday.name} closes for bidding today`}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: theme.upSoft, borderColor: theme.border },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={[styles.bannerIcon, { backgroundColor: theme.card }]}>
            <Ionicons name="alarm-outline" size={17} color={theme.up} />
          </View>
          <Text style={{ flex: 1, color: theme.textSub, fontSize: 11.5, lineHeight: 16 }}>
            <Text style={{ fontWeight: '800', color: theme.text }}>Closes today: </Text>
            {closingToday.name} stops accepting bids at 5 PM IST.
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        </Pressable>
      ) : null}

      <View style={{ paddingHorizontal: 16 }}>
        <SegmentedTabs<BoardTab>
          theme={theme}
          value={tab}
          onChange={setTab}
          accessibilityLabel="IPO board sections"
          options={[
            { key: 'open', label: 'Open', count: board.open.length },
            { key: 'soon', label: 'Soon', count: board.soon.length },
            { key: 'closed', label: 'Closed', count: board.closed.length },
          ]}
        />
      </View>

      {list.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setSort(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Sort by ${option.label}`}
                style={[
                  styles.sortChip,
                  {
                    backgroundColor: active ? theme.primary : theme.card,
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 11.5,
                    fontWeight: '700',
                    color: active ? theme.onPrimary : theme.textSub,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="IPO Pulse"
        subtitle={
          live.fetchedAt
            ? `${ipos.length} issues • live ${boardAsOfLabel}`
            : `${ipos.length} issues • snapshot ${DATA_AS_OF_LABEL}`
        }
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <LiveChip theme={theme} live={live} asOfLabel={boardAsOfLabel} onPress={refresh} />
            <IconButton
              icon="notifications-outline"
              onPress={() => navigation.navigate('Alerts')}
              theme={theme}
              accessibilityLabel={`Reminder log${alerts.length > 0 ? `, ${alerts.length} entries` : ', empty'}`}
              badge={alerts.length > 0}
            />
          </View>
        }
      />

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <Row style={styles.tiles} gap={9}>
              <SummaryTile theme={theme} icon="radio-button-on" tone="up" label="Bidding now" value={String(stats.live)} />
              <SummaryTile
                theme={theme}
                icon="time-outline"
                tone="info"
                label="Opening soon"
                value={String(stats.openingSoon)}
              />
              <SummaryTile
                theme={theme}
                icon="trending-up"
                tone="warn"
                label="Premium ≥ 12%"
                value={String(stats.healthyPremium)}
              />
            </Row>
            {header}
            <View style={{ height: 10 }} />
          </View>
        }
        contentContainerStyle={{ paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
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
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32 }}>
            <Ionicons
              name={tab === 'open' ? 'pause-circle-outline' : 'file-tray-outline'}
              size={34}
              color={theme.textMuted}
            />
            <Text style={{ color: theme.text, fontWeight: '800', marginTop: 12, fontSize: 15.5 }}>
              {tab === 'open' ? 'No issue is open right now' : 'Nothing in this list'}
            </Text>
            <Text style={{ color: theme.textSub, fontSize: 13, textAlign: 'center', marginTop: 5, lineHeight: 19 }}>
              {tab === 'open'
                ? 'Check the Soon tab for the next opening, or the Closed tab for allotment and listing updates.'
                : tab === 'soon'
                  ? 'Upcoming issues appear here as soon as dates are announced.'
                  : 'Issues move here once bidding closes, until they list.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          <Text style={[styles.footer, { color: theme.textMuted }]}>
            {live.fetchedAt
              ? `${live.state === 'ai' ? 'Filled by an AI web search' : 'Fetched from IPO Ji'} at ${formatIstTime(
                  live.fetchedAt
                )} IST - figures move intraday.`
              : 'Indicative data from public trackers'}{' '}
            • grey market premiums are unofficial • not investment advice.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { paddingHorizontal: 16, paddingBottom: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 11,
  },
  bannerIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    paddingHorizontal: 30,
    marginTop: 18,
    lineHeight: 16,
  },
});
