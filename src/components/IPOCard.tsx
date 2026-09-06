import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { cardShadow, radius, Theme } from '../theme';
import { IPO } from '../lib/types';
import { dateLine, gmpSeries, phaseOf } from '../lib/analysis';
import { formatRupees, gmpPercent } from '../lib/format';
import { Avatar, Chip, ChipTone } from './ui';

export function phaseTone(phase: string): ChipTone {
  if (phase === 'open') return 'up';
  if (phase === 'upcoming') return 'info';
  if (phase === 'allotment') return 'warn';
  return 'neutral';
}

function subscriptionStat(ipo: IPO): { value: string; sub: string } {
  const s = ipo.subscription;
  if (s?.total != null) return { value: `${s.total.toFixed(2)}x`, sub: 'Overall' };
  if (s?.retail != null) return { value: `${s.retail.toFixed(2)}x`, sub: 'Retail' };
  if (s?.qib != null) return { value: `${s.qib.toFixed(2)}x`, sub: 'QIB' };
  return { value: '\u2014', sub: phaseOf(ipo).key === 'upcoming' ? 'Not open' : 'Awaiting' };
}

function gmpStat(ipo: IPO): { value: string; sub: string; tone: ChipTone } {
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
  const series = gmpSeries(ipo);
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
            <Text style={[styles.statValue, { color: theme.text }]}>{sub.value}</Text>
            <Text style={[styles.statSub, { color: theme.textMuted }]}>{sub.sub}</Text>
          </View>
          <View style={[styles.statCell, { borderLeftWidth: 1, borderLeftColor: theme.border }]}>
            <Text style={[styles.statLabel, { color: theme.textMuted }]}>Trend</Text>
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
              {phase.key === 'upcoming' ? 'Pre-market' : '7 sessions'}
            </Text>
          </View>
        </View>
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
  statSub: { fontSize: 10.5, marginTop: 1.5, fontWeight: '600' },
});
