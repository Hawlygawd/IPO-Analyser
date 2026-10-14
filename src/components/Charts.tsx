import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, Theme } from '../theme';

/** Compact bar chart of source-reported grey-market premium observations. */
export function GmpBarChart({
  values,
  labels,
  theme,
  height = 74,
}: {
  values: number[];
  labels?: string[];
  theme: Theme;
  height?: number;
}) {
  const plotHeight = Math.max(20, height - 24);
  const maxPositive = Math.max(0, ...values.filter((value) => value > 0));
  const maxNegative = Math.max(0, ...values.map((value) => Math.abs(Math.min(0, value))));
  const baseline =
    maxNegative === 0
      ? plotHeight
      : maxPositive === 0
        ? 0
        : (plotHeight * maxPositive) / (maxPositive + maxNegative);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, height }}>
        {values.map((value, index) => {
          const positive = value >= 0;
          const scale = positive ? maxPositive : maxNegative;
          const availableHeight = positive ? baseline : plotHeight - baseline;
          const barHeight = Math.max(3, scale > 0 ? (Math.abs(value) / scale) * availableHeight : 3);
          const barTop = positive ? Math.max(0, baseline - barHeight) : baseline;
          const labelTop = positive ? Math.max(0, barTop - 14) : Math.min(plotHeight - 12, baseline + barHeight + 1);
          const isLast = index === values.length - 1;
          const barColor = isLast ? theme.primary : theme.mode === 'dark' ? theme.primarySoft : '#BFE9D8';

          return (
            <View key={`${index}-${value}`} style={{ flex: 1, height: plotHeight, position: 'relative', alignItems: 'center' }}>
              {maxPositive > 0 && maxNegative > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: baseline,
                    left: 0,
                    right: 0,
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: theme.border,
                  }}
                />
              ) : null}
              <Text
                style={{
                  position: 'absolute',
                  top: labelTop,
                  fontSize: 9,
                  fontWeight: '700',
                  color: isLast ? theme.primary : theme.textMuted,
                }}
              >
                {value}
              </Text>
              <View
                style={{
                  position: 'absolute',
                  top: barTop,
                  width: '100%',
                  height: Math.min(availableHeight || 3, barHeight),
                  borderRadius: radius.sm - 3,
                  backgroundColor: barColor,
                }}
              />
            </View>
          );
        })}
      </View>
      {labels ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
          <Text style={[styles.axis, { color: theme.textMuted }]}>{labels[0]}</Text>
          <Text style={[styles.axis, { color: theme.textMuted }]}>{labels[labels.length - 1]}</Text>
        </View>
      ) : null}
    </View>
  );
}

export interface BarRow {
  label: string;
  value: number;
  display: string;
  tone?: 'up' | 'down' | 'warn' | 'info';
}

export function SubscriptionBars({ rows, theme }: { rows: BarRow[]; theme: Theme }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View style={{ gap: 12 }}>
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
          <View key={row.label}>
            <View style={styles.barHead}>
              <Text style={[styles.barLabel, { color: theme.textSub }]}>{row.label}</Text>
              <Text style={[styles.barValue, { color: theme.text }]}>{row.display}</Text>
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
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { fontSize: 10, fontWeight: '600' },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barLabel: { fontSize: 12.5, fontWeight: '600' },
  barValue: { fontSize: 12.5, fontWeight: '800' },
  track: { height: 7, borderRadius: radius.pill, overflow: 'hidden' },
});
