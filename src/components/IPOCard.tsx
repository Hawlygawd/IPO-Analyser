import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { cardShadow, radius, Theme } from '../theme';
import { IPO } from '../lib/types';
import { dateLine, gmpSeries, phaseOf } from '../lib/analysis';
import { formatRupees, gmpPercent, subscriptionCategoryRows } from '../lib/format';
import { Avatar, Chip, ChipTone } from './ui';

export function phaseTone(phase: string): ChipTone {
  if (phase === 'open') return 'up';
  if (phase === 'upcoming') return 'info';
  if (phase === 'allotment') return 'warn';
  return 'neutral';
}

function subscriptionStat(ipo: IPO) {
  const categories = subscriptionCategoryRows(ipo.subscription);
  if (categories.length) return { categories, overall: undefined, emptyLabel: undefined };
  if (ipo.subscription?.total != null) {
    return {
      categories: [],
      overall: `${ipo.subscription.total.toFixed(2)}x`,
      emptyLabel: 'Overall',
    };
  }
  return {
    categories: [],
    overall: '\u2014',
    emptyLabel: phaseOf(ipo).key === 'upcoming' ? 'Not open' : 'Awaiting',
  };
}

function gmpStat(ipo: IPO): { value: string; sub: string; tone: ChipTone } {
  if (phaseOf(ipo).key === 'listed') return { value: '\u2014', sub: 'Already listed', tone: 'neutral' };
  if (ipo.gmp == null) return { value: '\u2014', sub: 'No quote', tone: 'neutral' };
  const pct = gmpPercent(ipo);
  const tone: ChipTone = ipo.gmp > 0 ? 'up' : ipo.gmp < 0 ? 'down' : 'neutral';
  const sign = ipo.gmp > 0 ? '+' : '';
  return {
    value: `${sign}${formatRupees(ipo.gmp)}`,
    sub: pct != null ? `${sign}${pct.toFixed(1)}%` : 'Band TBA',
    tone,
  };
}

function trendStat(ipo: IPO): { dir: 'up' | 'down' | 'flat'; label: string; tone: ChipTone } {
  if (phaseOf(ipo).key === 'listed') return { dir: 'flat', label: 'Listed', tone: 'neutral' };
  const series = gmpSeries(ipo);
  if (series.length < 2) {
    return { dir: 'flat', label: ipo.gmp == null ? 'Awaiting' : 'Latest', tone: 'neutral' };
  }
  const delta = series[series.length - 1] - series[0];
  const pct = gmpPercent(ipo);
  if (pct != null && pct >= 25 && delta >= 0) return { dir: 'up', label: 'Strong', tone: 'up' };
  if (delta > 2) return { dir: 'up', label: 'Rising', tone: 'up' };
  if (delta < -2) return { dir: 'down', label: 'Soft', tone: 'down' };
  return { dir: 'flat', label: 'Steady', tone: 'neutral' };
}

export function IPOCard({
  ipo,
  theme,
  onPress,
  watched,
  index = 0,
}: {
  ipo: IPO;
  theme: Theme;
  onPress: () => void;
  watched?: boolean;
  index?: number;
}) {
  const phase = phaseOf(ipo);
  const gmp = gmpStat(ipo);
  const sub = subscriptionStat(ipo);
  const trend = trendStat(ipo);
  const guruSource = ipo.sources?.find((source) => source.name.toLowerCase().includes('ipo guru'));
  const sourceLabel = ipo.sources
    ?.map((source) => {
      const name = source.name.toLowerCase();
      if (name.includes('nse india')) return 'NSE';
      if (name.includes('bse india')) return 'BSE';
      if (name.includes('ipoalerts')) return 'IPOAlerts';
      if (name.includes('ipo guru')) return 'IPO Guru';
      return source.name;
    })
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' · ');

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 7) * 45).duration(320)}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
          cardShadow(theme.mode),
          pressed && { opacity: 0.9, transform: [{ scale: 0.995 }] },
        ]}
      >
        <View style={styles.topRow}>
          <Avatar name={ipo.name} theme={theme} size={42} />
          <View style={styles.titleCol}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {ipo.name}
            </Text>
            <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
              {ipo.segment} \u2022 {dateLine(ipo)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 5 }}>
            <Chip label={phase.label} tone={phaseTone(phase.key)} theme={theme} small />
            {watched ? <Ionicons name="star" size={13} color={theme.warn} /> : null}
          </View>
        </View>

        <View style={[styles.statRow, { borderTopColor: theme.border }]}>
          <View style={styles.statCell}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>GMP</Text>
            <Text style={[styles.statValue, { color: theme[gmp.tone === 'up' ? 'up' : gmp.tone === 'down' ? 'down' : 'text'] }]}>
              {gmp.value}
            </Text>
            <Text style={[styles.statSub, { color: theme.textMuted }]}>{gmp.sub}</Text>
          </View>
          <View style={[styles.statCell, { borderLeftWidth: 1, borderLeftColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Subscription</Text>
            {sub.categories.length ? (
              <View style={{ gap: 1 }}>
                {sub.categories.slice(0, 4).map((row) => (
                  <Text key={row.key} numberOfLines={1} style={[styles.categoryValue, { color: theme.text }]}>
                    {row.label} <Text style={{ color: theme.primary, fontWeight: '800' }}>{row.value.toFixed(2)}x</Text>
                  </Text>
                ))}
                {sub.categories.length > 4 ? (
                  <Text style={[styles.categoryValue, { color: theme.textMuted }]}>+{sub.categories.length - 4} more in details</Text>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.statValue, { color: theme.text }]}>{sub.overall}</Text>
            )}
            <Text style={[styles.statSub, { color: theme.textMuted }]}>
              {sub.categories.length ? 'By investor category' : sub.emptyLabel}
            </Text>
          </View>
          <View style={[styles.statCell, { borderLeftWidth: 1, borderLeftColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>{phase.key === 'listed' ? 'Status' : 'Trend'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons
                name={trend.dir === 'up' ? 'trending-up' : trend.dir === 'down' ? 'trending-down' : 'remove'}
                size={14}
                color={theme[trend.tone === 'up' ? 'up' : trend.tone === 'down' ? 'down' : 'neutral']}
              />
              <Text
                style={[
                  styles.statValue,
                  { color: theme[trend.tone === 'up' ? 'up' : trend.tone === 'down' ? 'down' : 'text'] },
                ]}
              >
                {trend.label}
              </Text>
            </View>
            <Text style={[styles.statSub, { color: theme.textMuted }]}>
              {phase.key === 'listed'
                ? 'Post-listing'
                : phase.key === 'upcoming'
                  ? 'Pre-market'
                  : (ipo.gmpHistory?.length ?? 0) > 1
                    ? `${ipo.gmpHistory?.length} observations`
                    : 'No history'}
            </Text>
          </View>
        </View>
        {ipo.sourceConflicts?.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 }}>
            <Ionicons name="warning-outline" size={12} color={theme.warn} />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.warn, fontSize: 10, fontWeight: '700' }}>
              Sources disagree · check issue details
            </Text>
          </View>
        ) : null}
        {sourceLabel ? (
          <Text numberOfLines={1} style={[styles.attribution, { color: theme.textMuted, textDecorationLine: 'none' }]}>Sources: {sourceLabel}</Text>
        ) : null}
        {guruSource ? (
          <Text
            accessibilityRole="link"
            onPress={(event) => {
              event.stopPropagation();
              void Linking.openURL(guruSource.url ?? 'https://www.ipoguru.in/').catch(() => undefined);
            }}
            style={[styles.attribution, { color: theme.primary }]}
          >
            Data by IPO Guru
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  titleCol: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  meta: { fontSize: 11.5, fontWeight: '600' },
  statRow: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
  },
  statCell: { flex: 1, paddingHorizontal: 2 },
  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  statValue: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  categoryValue: { fontSize: 9.5, fontWeight: '700', lineHeight: 13 },
  attribution: { fontSize: 9, fontWeight: '700', textAlign: 'right', marginTop: 4, textDecorationLine: 'underline' },
  statSub: { fontSize: 10.5, marginTop: 1.5, fontWeight: '600' },
});
