import { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, Theme } from '../theme';

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  count?: number;
}

const PAD = 4;
const GAP = 4;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * Pill segmented control with a sliding indicator. The indicator is positioned in pixels
 * (measured with onLayout) so it animates reliably on native and on web.
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  theme,
  accessibilityLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
  theme: Theme;
  accessibilityLabel?: string;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const translateX = useRef(new Animated.Value(0)).current;
  const segment = width > 0 ? (width - PAD * 2 - GAP * (options.length - 1)) / options.length : 0;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: index * (segment + GAP),
      useNativeDriver: USE_NATIVE_DRIVER,
      damping: 20,
      stiffness: 220,
      mass: 0.7,
    }).start();
  }, [index, segment, translateX]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel ?? 'Filter'}
      style={[styles.wrap, { backgroundColor: theme.mode === 'dark' ? theme.cardAlt : theme.neutralSoft }]}
    >
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              width: segment,
              backgroundColor: theme.card,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${opt.label}${opt.count != null ? `, ${opt.count} IPOs` : ''}`}
            style={styles.seg}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, { color: active ? theme.text : theme.textSub }]}
            >
              {opt.label}
              {opt.count != null ? <Text style={{ color: active ? theme.primary : theme.textMuted }}>{`  ${opt.count}`}</Text> : null}
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
    padding: PAD,
    borderRadius: radius.pill,
    gap: GAP,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: radius.pill,
    shadowColor: '#0B1B33',
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  seg: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 12.5, fontWeight: '700' },
});
