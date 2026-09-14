import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { IPOT, DATA_AS_OF_LABEL } from '../lib/ipoData';
import { formatIstTime, formatPct, formatRupees, gmpPercent } from '../lib/format';
import {
  GmpToggles,
  SegmentFilter,
  SortKey,
  gmpBoardStats,
  matchesQuery,
  matchesSegment,
  matchesToggles,
  sortIpos,
} from '../lib/board';
import { Avatar, EmptyState } from '../components/ui';
import { PremiumBar, SummaryTile, premiumTone } from '../components/Charts';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { ScreenHeader } from '../components/ScreenHeader';
import { RootStackParamList } from '../navigation/types';

const SORT_LABELS: { key: SortKey; label: string }[] = [
  { key: 'premium', label: 'Top premium' },
  { key: 'size', label: 'Issue size' },
  { key: 'closing', label: 'Closing next' },
  { key: 'name', label: 'A–Z' },
];

export function GmpBoardScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isWatched, toggleWatch, refresh, refreshing } = useStore();
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<SegmentFilter>('all');
  const [toggles, setToggles] = useState<GmpToggles>({ quotedOnly: false, strongOnly: false });
  const [sort, setSort] = useState<SortKey>('premium');

  const stats = useMemo(() => gmpBoardStats(IPOT), []);
  const mainboardCount = useMemo(() => IPOT.filter((i) => i.segment === 'Mainboard').length, []);

  const rows = useMemo(() => {
    const filtered = IPOT.filter(
      (ipo) => matchesQuery(ipo, query) && matchesSegment(ipo, segment) && matchesToggles(ipo, toggles)
    );
    return sortIpos(filtered, sort);
  }, [query, segment, toggles, sort]);

  const toggle = (key: keyof GmpToggles) => setToggles((prev) => ({ ...prev, [key]: !prev[key] }));

  const quotedCount = rows.filter((r) => r.gmp != null).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="GMP board"
        subtitle={`Unofficial grey market quotes • snapshot ${DATA_AS_OF_LABEL}`}
      />

      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 9 }}>
          <SummaryTile
            theme={theme}
            icon="pricetag-outline"
            tone="info"
            label="Quotes recorded"
            value={`${stats.quoted}/${stats.total}`}
          />
          <SummaryTile
            theme={theme}
            icon="analytics-outline"
            tone="primary"
            label="Average premium"
            value={stats.avg != null ? fmtPct(stats.avg) : '—'}
          />
          <SummaryTile
            theme={theme}
            icon="trending-up"
            tone="up"
            label="Best premium"
            value={stats.best ? fmtPct(gmpPercent(stats.best) ?? 0) : '—'}
          />
        </View>

        <View style={[styles.search, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Ionicons name="search" size={16} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search company, sector or exchange"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="Search IPOs by company, sector or exchange"
            style={[styles.searchInput, { color: theme.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={17} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <SegmentedTabs<SegmentFilter>
          theme={theme}
          value={segment}
          onChange={setSegment}
          accessibilityLabel="Filter the GMP board by segment"
          options={[
            { key: 'all', label: 'All', count: IPOT.length },
            { key: 'mainboard', label: 'Mainboard', count: mainboardCount },
            { key: 'sme', label: 'SME', count: IPOT.length - mainboardCount },
          ]}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ToggleChip
            theme={theme}
            label="Quoted only"
            active={toggles.quotedOnly}
            onPress={() => toggle('quotedOnly')}
          />
          <ToggleChip
            theme={theme}
            label="Premium ≥ 12%"
            active={toggles.strongOnly}
            onPress={() => toggle('strongOnly')}
          />
          {toggles.quotedOnly || toggles.strongOnly ? (
            <Pressable
              onPress={() => setToggles({ quotedOnly: false, strongOnly: false })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear the premium filters"
            >
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: theme.primary }}>Reset</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 11, color: theme.textMuted, fontWeight: '700' }}>
            {rows.length} shown • {quotedCount} with a quote
          </Text>
          <View style={{ flex: 1 }} />
          {SORT_LABELS.map((option) => {
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
                    backgroundColor: active ? theme.primary : 'transparent',
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: active ? theme.onPrimary : theme.textSub }}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
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
        renderItem={({ item, index }) => {
          const pct = gmpPercent(item);
          const tone = premiumTone(pct);
          const fg =
            tone === 'up' ? theme.up : tone === 'warn' ? theme.warn : tone === 'down' ? theme.down : theme.textMuted;
          return (
            <Animated.View entering={FadeIn.delay(Math.min(index, 8) * 25)}>
              <Pressable
                onPress={() => navigation.navigate('IPODetail', { id: item.id })}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}. ${
                  item.gmp != null ? `Grey market premium ${formatRupees(item.gmp)}, ${formatPct(pct ?? 0)}` : 'No grey market quote'
                }. Ranked ${index + 1} of ${rows.length}.`}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.card, borderColor: theme.border },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={[styles.rank, { color: theme.textMuted }]}>{index + 1}</Text>
                <Avatar name={item.name} theme={theme} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '800', color: theme.text, letterSpacing: -0.2 }}>
                    {item.name}
                  </Text>
                  <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted }]}>
                    {item.platform}
                    {item.sector ? ` • ${item.sector}` : ''}
                  </Text>
                  <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, marginTop: 2 }]}>
                    {item.gmpUpdated ? `quote ${formatIstTime(item.gmpUpdated)} IST` : 'no quote recorded'}
                  </Text>
                </View>

                <View style={{ alignItems: 'flex-end', gap: 5 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '800', color: fg }}>
                    {pct != null ? formatPct(pct) : item.gmp != null ? formatRupees(item.gmp) : 'TBA'}
                  </Text>
                  <PremiumBar pct={pct} theme={theme} width={56} />
                </View>

                <Pressable
                  onPress={() => toggleWatch(item)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isWatched(item.id) ? `Remove ${item.name} from watchlist` : `Add ${item.name} to watchlist`
                  }
                  accessibilityState={{ selected: isWatched(item.id) }}
                  style={{ padding: 4 }}
                >
                  <Ionicons
                    name={isWatched(item.id) ? 'star' : 'star-outline'}
                    size={16}
                    color={isWatched(item.id) ? theme.warn : theme.textMuted}
                  />
                </Pressable>
              </Pressable>
            </Animated.View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            theme={theme}
            icon="search-outline"
            title="No matching IPOs"
            message="Try another company name or sector, or loosen the filter above."
            actionLabel="Clear filters"
            onAction={() => {
              setQuery('');
              setSegment('all');
              setToggles({ quotedOnly: false, strongOnly: false });
            }}
          />
        }
        ListFooterComponent={
          <Text style={{ fontSize: 11, color: theme.textMuted, textAlign: 'center', paddingHorizontal: 30, marginTop: 14, lineHeight: 16 }}>
            Premium % is the grey market quote over the upper price band, computed from the figures the tracker
            last recorded. Rows without a quote show TBA.
          </Text>
        }
      />
    </View>
  );
}

function ToggleChip({
  theme,
  label,
  active,
  onPress,
}: {
  theme: Theme;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      style={[
        styles.sortChip,
        {
          backgroundColor: active ? theme.primarySoft : 'transparent',
          borderColor: active ? theme.primary : theme.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
        },
      ]}
    >
      <Ionicons
        name={active ? 'checkmark-circle' : 'ellipse-outline'}
        size={12}
        color={active ? theme.primary : theme.textMuted}
      />
      <Text style={{ fontSize: 11, fontWeight: '700', color: active ? theme.primary : theme.textSub }}>{label}</Text>
    </Pressable>
  );
}

function fmtPct(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`;
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rank: { fontSize: 11, fontWeight: '800', width: 16, textAlign: 'center' },
  meta: { fontSize: 10.5, marginTop: 1, fontWeight: '600' },
});
