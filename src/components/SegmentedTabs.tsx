import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { radius, Theme } from '../theme';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  count?: number;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
  theme: Theme;
}) {
  return (
    <View style={[styles.wrap, { backgroundColor: theme.mode === 'dark' ? theme.cardAlt : theme.neutralSoft }]}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.seg, active && { backgroundColor: theme.mode === 'dark' ? theme.card : '#FFFFFF' }]}
          >
            {active ? (
              <Animated.View
                entering={FadeIn.duration(180)}
                style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, backgroundColor: theme.card }]}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? theme.text : theme.textSub },
                active && { color: theme.text },
              ]}
            >
              {opt.label}
              {opt.count != null ? ` ${opt.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    gap: 4,
  },
  seg: {
    flex: 1,
    paddingVertical: 8.5,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: { fontSize: 13, fontWeight: '700' },
});
