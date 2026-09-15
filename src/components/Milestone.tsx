import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Theme } from '../theme';
import { IPO } from '../lib/types';
import { milestones, nextMilestone } from '../lib/analysis';
import { countdownLabel, formatDay } from '../lib/format';
import { Chip } from './ui';

/** Vertical key-date timeline: done / next / pending, with provisional dates flagged. */
export function MilestoneTimeline({ ipo, theme }: { ipo: IPO; theme: Theme }) {
  const steps = milestones(ipo);
  const next = nextMilestone(ipo);

  return (
    <View>
      {steps.map((step, i) => {
        const color = step.done ? theme.up : step.isNext ? theme.primary : theme.textMuted;
        const last = i === steps.length - 1;
        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: step.done ? theme.up : step.isNext ? theme.primary : theme.card,
                    borderColor: step.done || step.isNext ? color : theme.border,
                  },
                ]}
              >
                {step.done ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                {step.isNext ? <View style={[styles.dotInner, { backgroundColor: '#fff' }]} /> : null}
              </View>
              {!last ? (
                <View style={[styles.line, { backgroundColor: step.done ? theme.up : theme.border }]} />
              ) : null}
            </View>

            <View style={[styles.body, { paddingBottom: last ? 0 : 16 }]}>
              <View style={styles.titleRow}>
                <Text style={[styles.label, { color: step.done ? theme.textSub : theme.text }]} numberOfLines={1}>
                  {step.label}
                </Text>
                {step.isNext ? <Chip label={countdownLabel(step.date)} tone="primary" theme={theme} small /> : null}
              </View>
              <View style={styles.metaRow}>
                <Text style={[styles.date, { color: theme.textMuted }]}>{formatDay(step.date, true)}</Text>
                {step.tentative ? (
                  <View style={styles.tentative}>
                    <Ionicons name="alert-circle-outline" size={11} color={theme.warn} />
                    <Text style={{ fontSize: 10, color: theme.warn, fontWeight: '700' }}>tentative</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}

      {next ? (
        <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 14, fontWeight: '600' }}>
          Next up: {next.label.toLowerCase()} on {formatDay(next.date, true)}.
        </Text>
      ) : (
        <Text style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 14, fontWeight: '600' }}>
          All key dates for this issue are in the past.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 24 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: { width: 6, height: 6, borderRadius: 3 },
  line: { width: 2, flex: 1, marginTop: 2, borderRadius: 1 },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  label: { fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  date: { fontSize: 12, fontWeight: '600' },
  tentative: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
