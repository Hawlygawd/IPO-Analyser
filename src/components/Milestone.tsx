import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Theme } from '../theme';
import { DateKey, IPO } from '../lib/types';
import { diffDays, formatDay, parseISO, startOfToday } from '../lib/format';
import { isUnconfirmed, phaseOf } from '../lib/analysis';

interface Step {
  key: DateKey;
  label: string;
  date: string;
  tentative: boolean;
  passed: boolean;
}

export function MilestoneTimeline({ ipo, theme }: { ipo: IPO; theme: Theme }) {
  const today = startOfToday();
  // If the opening was never confirmed and its indicative date has gone by, none of the
  // milestones can be shown as completed (previously they all got a green tick).
  const awaiting = phaseOf(ipo, today).key === 'awaiting';
  const raw: Omit<Step, 'tentative' | 'passed'>[] = [
    { key: 'open', label: 'Opens for bidding', date: ipo.openDate },
    { key: 'close', label: 'Closes', date: ipo.closeDate },
    { key: 'allotment', label: 'Allotment finalised', date: ipo.allotmentDate },
    { key: 'listing', label: `Lists on ${ipo.exchanges.join(' & ')}`, date: ipo.listingDate },
  ];
  const steps: Step[] = raw.map((s) => ({
    ...s,
    tentative: isUnconfirmed(ipo, s.key),
    passed: diffDays(today, parseISO(s.date)) < 0,
  }));
  const isDone = (s: Step) => s.passed && !awaiting;

  return (
    <View>
      {steps.map((step, i) => {
        const done = isDone(step);
        const isNext = !done && steps.slice(0, i).every(isDone);
        const lapsed = step.passed && awaiting;
        const accent = awaiting ? theme.warn : theme.primary;
        const color = done ? theme.up : isNext ? accent : theme.textMuted;
        return (
          <View key={step.key} style={styles.row}>
            <View style={{ alignItems: 'center', width: 24 }}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? theme.up : isNext ? accent : theme.card,
                    borderColor: done || isNext ? color : theme.border,
                  },
                ]}
              >
                {done ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
              </View>
              {i < steps.length - 1 ? (
                <View style={[styles.line, { backgroundColor: done ? theme.up : theme.border }]} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 18 : 0 }}>
              <Text style={[styles.label, { color: theme.text }]}>{step.label}</Text>
              <Text style={[styles.date, { color: theme.textMuted }]}>
                {formatDay(step.date, true)}
                {lapsed ? (
                  <Text style={{ color: theme.warn }}>{'  (was expected \u2022 not confirmed)'}</Text>
                ) : step.tentative ? (
                  '  (tentative)'
                ) : (
                  ''
                )}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { width: 2, flex: 1, marginTop: 2, borderRadius: 1 },
  label: { fontSize: 13.5, fontWeight: '700' },
  date: { fontSize: 12, marginTop: 2, fontWeight: '600' },
});
