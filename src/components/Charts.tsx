import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, Theme } from '../theme';
import { IPO } from '../lib/types';
import { formatRupees } from '../lib/format';
import { MicroLabel, numeric } from './ui';

/**
 * Where the grey market quote sits relative to the price band. Everything drawn here is
 * a number the source published - no modelled history.
 */
export function PriceLadder({ ipo, theme }: { ipo: IPO; theme: Theme }) {
  const low = ipo.priceBandLow;
  const high = ipo.priceBandHigh;
  if (low == null || high == null) return null;

  const gmp = ipo.gmp ?? 0;
  const listing = high + gmp;
  const min = Math.min(low, listing);
  const max = Math.max(high, listing);
  const span = max - min || 1;
  const at = (value: number) => ((value - min) / span) * 100;

  const bandLeft = at(low);
  const bandWidth = Math.max(2, at(high) - at(low));
  const premiumLeft = Math.min(at(high), at(listing));
  const premiumWidth = Math.abs(at(listing) - at(high));
  const positive = listing >= high;

  return (
    <View>
      <View style={styles.ladderRow}>
        <MicroLabel theme={theme}>Price band</MicroLabel>
        <MicroLabel theme={theme}>Indicative listing</MicroLabel>
      </View>

      <View style={[styles.ladderTrack, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
        <View
          style={[
            styles.ladderZone,
            {
              left: `${premiumLeft}%`,
              width: `${Math.max(premiumWidth, 0.8)}%`,
              backgroundColor: positive ? theme.up : theme.down,
              opacity: 0.28,
            },
          ]}
        />
        <View
          style={[
            styles.ladderZone,
            { left: `${bandLeft}%`, width: `${bandWidth}%`, backgroundColor: theme.primary, opacity: 0.55 },
          ]}
        />
        <View style={[styles.ladderMarker, { left: `${at(high)}%`, backgroundColor: theme.text }]} />
        {ipo.gmp != null ? (
          <View
            style={[
              styles.ladderDot,
              { left: `${at(listing)}%`, backgroundColor: positive ? theme.up : theme.down, borderColor: theme.card },
            ]}
          />
        ) : null}
      </View>

      <View style={[styles.ladderRow, { marginTop: 7 }]}>
        <Text style={[styles.axis, numeric, { color: theme.textSub }]}>
          {formatRupees(low)}
          {low !== high ? `–${formatRupees(high)}` : ''}
        </Text>
        {ipo.gmp != null ? (
          <Text style={[styles.axisStrong, numeric, { color: positive ? theme.up : theme.down }]}>
            {formatRupees(listing)} ({formatRupees(ipo.gmp)})
          </Text>
        ) : (
          <Text style={[styles.axis, { color: theme.textMuted }]}>No grey market quote</Text>
        )}
      </View>
    </View>
  );
}

export interface BarRow {
  key?: string;
  label: string;
  value: number;
  display: string;
  tone?: 'up' | 'down' | 'warn' | 'info';
}

/** Category-wise subscription with a 1.00x reference marker (the "fully subscribed" line). */
export function SubscriptionBars({ rows, theme }: { rows: BarRow[]; theme: Theme }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const oneX = (1 / max) * 100;
  return (
    <View style={{ gap: 14 }}>
      {rows.map((row) => {
        const color =
          row.tone === 'down'
            ? theme.down
            : row.tone === 'warn'
              ? theme.warn
              : row.tone === 'info'
                ? theme.info
                : theme.primary;
        return (
          <View key={row.key ?? row.label}>
            <View style={styles.barHead}>
              <Text style={[styles.barLabel, { color: theme.textSub }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={[styles.barValue, numeric, { color: row.value >= 1 ? theme.text : theme.textMuted }]}>
                {row.display}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: theme.neutralSoft }]}>
              <View
                style={{
                  width: `${Math.min(100, Math.max(3, (row.value / max) * 100))}%`,
                  height: '100%',
                  borderRadius: radius.pill,
                  backgroundColor: color,
                }}
              />
              {max > 1 ? (
                <View
                  style={[
                    styles.oneX,
                    { left: `${Math.min(97, Math.max(1, oneX))}%`, backgroundColor: theme.textMuted },
                  ]}
                />
              ) : null}
            </View>
          </View>
        );
      })}
      {max > 1 ? (
        <View style={styles.legend}>
          <View style={[styles.legendTick, { backgroundColor: theme.textMuted }]} />
          <Text style={{ fontSize: 10.5, color: theme.textMuted, fontWeight: '600' }}>
            1.00x = the portion reserved for that category is fully bid for
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Compact horizontal premium bar used on the GMP board rows. */
export function PremiumBar({
  pct,
  theme,
  width = 58,
  height = 6,
  maxPct = 60,
}: {
  pct: number | null;
  theme: Theme;
  width?: number;
  height?: number;
  maxPct?: number;
}) {
  if (pct == null) {
    return <View style={[styles.premiumTrack, { width, height, backgroundColor: theme.neutralSoft }]} />;
  }
  const clamped = Math.max(-maxPct, Math.min(maxPct, pct));
  const ratio = Math.abs(clamped) / maxPct;
  const positive = pct >= 0;
  return (
    <View style={[styles.premiumTrack, { width, height, backgroundColor: theme.neutralSoft }]}>
      <View
        style={{
          position: 'absolute',
          left: positive ? '50%' : `${50 - ratio * 50}%`,
          width: `${Math.max(ratio * 50, 3)}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: positive ? theme.up : theme.down,
        }}
      />
      <View style={[styles.zeroTick, { backgroundColor: theme.border }]} />
    </View>
  );
}

/** Small stat block with an icon - used in the header summary strips. */
export function SummaryTile({
  theme,
  icon,
  label,
  value,
  tone = 'primary',
  onPress,
}: {
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: 'primary' | 'up' | 'info' | 'warn' | 'neutral';
  onPress?: () => void;
}) {
  const fg = theme[tone] as string;
  const bg = theme[`${tone}Soft` as keyof Theme] as string;
  return (
    <View
      accessibilityRole={onPress ? 'button' : undefined}
      style={[styles.tile, { backgroundColor: theme.card, borderColor: theme.border }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={12} color={fg} />
      </View>
      <Text style={[styles.tileValue, numeric, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ fontSize: 9.5, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.3 }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export function premiumTone(pct: number | null): 'up' | 'warn' | 'down' | 'neutral' {
  if (pct == null) return 'neutral';
  if (pct >= 12) return 'up';
  if (pct > 0) return 'warn';
  if (pct === 0) return 'neutral';
  return 'down';
}

const styles = StyleSheet.create({
  ladderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ladderTrack: {
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 6,
    overflow: 'hidden',
  },
  ladderZone: { position: 'absolute', top: 0, bottom: 0 },
  ladderMarker: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.7 },
  ladderDot: {
    position: 'absolute',
    top: '25%',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    marginLeft: -6,
  },
  axis: { fontSize: 10.5, fontWeight: '600' },
  axisStrong: { fontSize: 11.5, fontWeight: '800' },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5, gap: 8 },
  barLabel: { fontSize: 12.5, fontWeight: '600', flex: 1 },
  barValue: { fontSize: 12.5, fontWeight: '800' },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center' },
  oneX: { position: 'absolute', top: -2, bottom: -2, width: 1.5, opacity: 0.55 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  legendTick: { width: 1.5, height: 9, borderRadius: 1 },
  premiumTrack: { borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center' },
  zeroTick: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1 },
  tile: { flex: 1, borderRadius: radius.md, borderWidth: 1, padding: 10, gap: 5 },
  tileIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tileValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
});
