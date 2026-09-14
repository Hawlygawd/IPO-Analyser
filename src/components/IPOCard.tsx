import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { cardShadow, radius, Theme } from '../theme';
import { IPO } from '../lib/types';
import { dateLine, gmpSignal, phaseOf, phaseTone, sentiment, sentimentTone, subscriptionRows } from '../lib/analysis';
import { formatMultiple, formatRupees, gmpPercent, indicativeListing, lotInvestment, priceBandLabel } from '../lib/format';
import { Avatar, Chip, MicroLabel, numeric } from './ui';
import { PremiumBar, premiumTone } from './Charts';

export interface IPOCardProps {
  ipo: IPO;
  theme: Theme;
  onPress: () => void;
  watched?: boolean;
  onToggleWatch?: (ipo: IPO) => void;
  index?: number;
}

function subscriptionStat(ipo: IPO): { value: string; sub: string } {
  const s = ipo.subscription;
  if (s?.total != null) return { value: formatMultiple(s.total), sub: 'Overall' };
  if (s?.retail != null) return { value: formatMultiple(s.retail), sub: ipo.segment === 'SME' ? 'Individual' : 'Retail' };
  if (s?.qib != null) return { value: formatMultiple(s.qib), sub: 'QIB' };
  return { value: '—', sub: phaseOf(ipo).key === 'upcoming' ? 'Not opened' : 'Not published' };
}

function gmpStat(ipo: IPO): { value: string; sub: string; tone: ReturnType<typeof premiumTone> } {
  if (ipo.gmp == null) return { value: '—', sub: 'No quote', tone: 'neutral' };
  const pct = gmpPercent(ipo);
  const tone = premiumTone(pct);
  return {
    value: `${ipo.gmp > 0 ? '+' : ipo.gmp < 0 ? '−' : ''}${formatRupees(Math.abs(ipo.gmp))}`,
    sub: pct != null ? `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%` : 'Band TBA',
    tone,
  };
}

export function IPOCard({ ipo, theme, onPress, watched, onToggleWatch, index = 0 }: IPOCardProps) {
  const phase = phaseOf(ipo);
  const gmp = gmpStat(ipo);
  const sub = subscriptionStat(ipo);
  const rows = subscriptionRows(ipo);
  const retail = ipo.subscription?.retail ?? ipo.subscription?.total ?? null;
  const investment = lotInvestment(ipo);
  const listing = indicativeListing(ipo);
  const signal = gmpSignal(ipo);
  const mood = sentiment(ipo);
  const moodTone = sentimentTone(mood.score);
  const pct = gmpPercent(ipo);

  const toneColor =
    gmp.tone === 'up' ? theme.up : gmp.tone === 'down' ? theme.down : gmp.tone === 'warn' ? theme.warn : theme.text;

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 7) * 40).duration(300)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${ipo.name}, ${ipo.platform} ${ipo.segment} IPO. ${phase.label}. ${
          ipo.gmp != null ? `Grey market premium ${formatRupees(ipo.gmp)}` : 'No grey market quote'
        }. ${dateLine(ipo)}.`}
        accessibilityHint="Opens the full analysis for this IPO"
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
          cardShadow(theme.mode),
          pressed && { opacity: 0.92 },
        ]}
      >
        <View style={styles.topRow}>
          <Avatar name={ipo.name} theme={theme} size={42} />
          <View style={styles.titleCol}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {ipo.name}
            </Text>
            <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
              {[ipo.platform, ipo.sector].filter(Boolean).join(' • ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Chip label={phase.label} tone={phaseTone(phase.key)} theme={theme} small />
            {onToggleWatch ? (
              <Pressable
                onPress={() => onToggleWatch(ipo)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={watched ? `Remove ${ipo.name} from watchlist` : `Add ${ipo.name} to watchlist`}
                accessibilityState={{ selected: !!watched }}
                style={styles.star}
              >
                <Ionicons
                  name={watched ? 'star' : 'star-outline'}
                  size={16}
                  color={watched ? theme.warn : theme.textMuted}
                />
              </Pressable>
            ) : watched ? (
              <Ionicons name="star" size={14} color={theme.warn} />
            ) : null}
          </View>
        </View>

        <View style={[styles.dateRow, { borderTopColor: theme.border }]}>
          <Ionicons name="calendar-outline" size={13} color={theme.textMuted} />
          <Text style={[styles.dateText, { color: theme.textSub }]} numberOfLines={1}>
            {dateLine(ipo)}
          </Text>
          <View style={{ flex: 1 }} />
          <MicroLabel theme={theme}>{signal.label}</MicroLabel>
        </View>

        {retail != null ? (
          <View style={styles.barRow}>
            <PremiumBar pct={pct} theme={theme} width={64} />
            <Text style={{ fontSize: 11, color: theme.textMuted, fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {rankHint(rows)}
            </Text>
          </View>
        ) : null}

        <View style={[styles.statRow, { borderTopColor: theme.border }]}>
          <View style={styles.statCell}>
            <MicroLabel theme={theme}>GMP / premium</MicroLabel>
            <Text style={[styles.statValue, numeric, { color: toneColor }]}>{gmp.value}</Text>
            <Text style={[styles.statSub, { color: theme.textMuted }]} numberOfLines={1}>
              {listing != null ? `≈ ${formatRupees(listing)} listing` : gmp.sub}
            </Text>
          </View>
          <View style={[styles.statCell, styles.statCellDivider, { borderLeftColor: theme.border }]}>
            <MicroLabel theme={theme}>Subscription</MicroLabel>
            <Text style={[styles.statValue, numeric, { color: theme.text }]}>{sub.value}</Text>
            <Text style={[styles.statSub, { color: theme.textMuted }]} numberOfLines={1}>
              {sub.sub}
            </Text>
          </View>
          <View style={[styles.statCell, styles.statCellDivider, { borderLeftColor: theme.border }]}>
            <MicroLabel theme={theme}>{investment != null ? 'Min. lot' : 'Price band'}</MicroLabel>
            <Text style={[styles.statValue, numeric, { color: theme.text }]} numberOfLines={1}>
              {investment != null
                ? formatRupees(Math.round(investment))
                : ipo.priceBandHigh != null
                  ? priceBandLabel(ipo)
                  : 'TBA'}
            </Text>
            <Text style={[styles.statSub, { color: theme.textMuted }]} numberOfLines={1}>
              {investment != null
                ? `${ipo.lotSize} shares`
                : ipo.priceBandHigh != null
                  ? 'lot size not published'
                  : 'awaiting RHP'}
            </Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <Chip
            label={`Demand ${mood.label}`}
            tone={moodTone}
            theme={theme}
            small
            accessibilityLabel={`Derived demand signal: ${mood.label}, score ${mood.score} of 100`}
          />
          {ipo.gmp === 0 ? <Chip label="Flat quote" tone="neutral" theme={theme} small /> : null}
          {ipo.tentativeDates.length > 0 ? (
            <Chip label="Dates tentative" tone="warn" theme={theme} small icon="alert-circle-outline" />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function rankHint(rows: { key: string; label: string; display: string }[]): string {
  if (rows.length === 0) return '';
  const best = [...rows].sort((a, b) => Number(b.display.replace('x', '')) - Number(a.display.replace('x', '')))[0];
  return `Strongest category: ${best.label} at ${best.display}`;
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
  star: { padding: 2 },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dateText: { fontSize: 11.5, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 9 },
  statRow: { flexDirection: 'row', marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  statCell: { flex: 1, paddingHorizontal: 2 },
  statCellDivider: { borderLeftWidth: StyleSheet.hairlineWidth, paddingLeft: 10 },
  statValue: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  statSub: { fontSize: 10.5, marginTop: 2, fontWeight: '600' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' },
});
