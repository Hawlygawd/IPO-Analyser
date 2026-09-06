import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Theme } from '../theme';
import { IPO } from '../lib/types';
import { diffDays, formatDay, parseISO, startOfToday } from '../lib/format';

interface Step {
  key: string;
  label: string;
  date: string;
  tentative: boolean;
}

export function MilestoneTimeline({ ipo, theme }: { ipo: IPO; theme: Theme }) {
  const today = startOfToday();
  const steps: Step[] = [
    { key: 'open', label: 'Opens for bidding', date: ipo.openDate, tentative: ipo.tentativeDates.includes('open') },
    { key: 'close', label: 'Closes', date: ipo.closeDate, tentative: ipo.tentativeDates.includes('close') },
    {
      key: 'allotment',
      label: 'Allotment finalised',
      date: ipo.allotmentDate,
      tentative: ipo.tentativeDates.includes('allotment'),
    },
    {
      key: 'listing',
      label: `Lists on ${ipo.exchanges.join(' & ')}`,
      date: ipo.listingDate,
      tentative: ipo.tentativeDates.includes('listing'),
    },
  ];

  return (
    <View>
      {steps.map((step, i) => {
        const done = diffDays(today, parseISO(step.date)) < 0;
        const isNext = !done && steps.slice(0, i).every((s) => diffDays(today, parseISO(s.date)) < 0);
        const color = done ? theme.up : isNext ? theme.primary : theme.textMuted;
        return (
          <View key={step.key} style={styles.row}>
            <View style={{ alignItems: 'center', width: 24 }}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done ? theme.up : isNext ? theme.primary : theme.card,
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
                {step.tentative ? '  (tentative)' : ''}
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
