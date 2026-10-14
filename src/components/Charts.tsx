import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, Theme } from '../theme';

/** Compact bar chart of the last N grey-market sessions (no SVG dependency). */
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
  const max = Math.max(1, ...values);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height }}>
        {values.map((v, i) => {
          const ratio = Math.max(0.08, v / max);
          const isLast = i === values.length - 1;
          const barColor = isLast ? theme.primary : theme.mode === 'dark' ? theme.primarySoft : '#BFE9D8';
          return (
            <View key={`${i}-${v}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text
                style={{
                  fontSize: 9.5,
                  fontWeight: '700',
                  color: isLast ? theme.primary : theme.textMuted,
                  marginBottom: 3,
                }}
              >
                {v}
              </Text>
              <View
                style={{
                  width: '100%',
                  height: Math.max(6, ratio * (height - 24)),
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
  const max = Math.max(1, ...rows.map((r) => r.value));
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
