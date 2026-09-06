import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../theme';

export function ScreenHeader({
  theme,
  title,
  subtitle,
  onBack,
  right,
  large,
}: {
  theme: Theme;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + 10,
          backgroundColor: theme.bg,
          borderBottomColor: theme.border,
          borderBottomWidth: large ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            { backgroundColor: theme.card, borderColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="arrow-back" size={19} color={theme.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={[
            large ? styles.titleLarge : styles.title,
            { color: theme.text },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  titleLarge: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },
});
