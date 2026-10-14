import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { radius, Theme } from '../theme';
import { useStore } from '../lib/store';
import { IPOT, DATA_AS_OF_LABEL } from '../lib/ipoData';
import { gmpPercent } from '../lib/format';
import { computeTrend, gmpSeries } from '../lib/analysis';
import { Avatar, EmptyState } from '../components/ui';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { ScreenHeader } from '../components/ScreenHeader';
import { RootStackParamList } from '../navigation/types';

type Filter = 'all' | 'mainboard' | 'sme' | 'gainers';

export function GmpBoardScreen({ theme }: { theme: Theme }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isWatched } = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = IPOT.map((ipo) => {
      const pct = gmpPercent(ipo);
      const series = gmpSeries(ipo);
      const delta = series[series.length - 1] - series[0];
      return { ipo, pct, delta, trend: computeTrend(ipo) };
    });
    const filtered = scored.filter((row) => {
      if (q && !row.ipo.name.toLowerCase().includes(q) && !row.ipo.sector.toLowerCase().includes(q)) return false;
      if (filter === 'mainboard') return row.ipo.segment === 'Mainboard';
      if (filter === 'sme') return row.ipo.segment === 'SME';
      if (filter === 'gainers') return (row.pct ?? -999) >= 12;
      return true;
    });
    filtered.sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999));
    return filtered;
  }, [query, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScreenHeader
        theme={theme}
        large
        title="GMP board"
        subtitle={`Grey market premium \u2022 as of ${DATA_AS_OF_LABEL}`}
      />

      <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 12 }}>
        <View style={[styles.search, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Ionicons name="search" size={16} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search company or sector"
            placeholderTextColor={theme.textMuted}
            style={[styles.searchInput, { color: theme.text }]}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <SegmentedTabs<Filter>
          theme={theme}
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'All' },
            { key: 'mainboard', label: 'Mainboard' },
            { key: 'sme', label: 'SME' },
            { key: 'gainers', label: 'Top' },
          ]}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.ipo.id}
        contentContainerStyle={{ paddingBottom: 34 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => {
          const { ipo, pct, trend } = item;
          const tone = pct == null ? 'neutral' : pct >= 12 ? 'up' : pct >= 0 ? 'warn' : 'down';
          const fg = tone === 'up' ? theme.up : tone === 'warn' ? theme.warn : tone === 'down' ? theme.down : theme.textMuted;
          return (
            <Animated.View entering={FadeIn.delay(Math.min(index, 8) * 30)}>
              <Pressable
                onPress={() => navigation.navigate('IPODetail', { id: ipo.id })}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.card, borderColor: theme.border },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.rank, { color: theme.textMuted }]}>{index + 1}</Text>
                <Avatar name={ipo.name} theme={theme} size={38} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '800', color: theme.text, letterSpacing: -0.2 }}>
                    {ipo.name}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: theme.textMuted, marginTop: 2, fontWeight: '600' }}>
                    {ipo.segment} \u2022 {ipo.gmp != null ? `GMP ${ipo.gmp > 0 ? '+' : ''}\u20B9${ipo.gmp}` : 'No quote'}
                  </Text>
                </View>
                {isWatched(ipo.id) ? <Ionicons name="star" size={13} color={theme.warn} /> : null}
                <View style={{ alignItems: 'flex-end', minWidth: 66 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '800', color: fg }}>
                    {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : 'TBA'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
                    <Ionicons
                      name={trend.dir === 'up' ? 'trending-up' : trend.dir === 'down' ? 'trending-down' : 'remove'}
                      size={11}
                      color={theme.textMuted}
                    />
                    <Text style={{ fontSize: 10.5, color: theme.textMuted, fontWeight: '700' }}>{trend.label}</Text>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            theme={theme}
            icon="search-outline"
            title="No matching IPOs"
            message="Try a different company name, or switch the filter above."
          />
        }
        ListFooterComponent={
          <Text style={{ fontSize: 11, color: theme.textMuted, textAlign: 'center', paddingHorizontal: 30, marginTop: 12, lineHeight: 16 }}>
            GMP % is premium over the upper price band \u2022 shown as TBA when the band is not yet announced.
          </Text>
        }
      />
    </View>
  );
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rank: { fontSize: 11, fontWeight: '800', width: 16, textAlign: 'center' },
});
