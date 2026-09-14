import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../theme';
import { IconButton } from './ui';

export function ScreenHeader({
  theme,
  title,
  subtitle,
  onBack,
  right,
  large,
  backLabel = 'Go back',
}: {
  theme: Theme;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  large?: boolean;
  backLabel?: string;
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
        <IconButton
          icon="arrow-back"
          onPress={onBack}
          theme={theme}
          accessibilityLabel={backLabel}
          size={38}
        />
      ) : null}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[large ? styles.titleLarge : styles.title, { color: theme.text }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={[styles.subtitle, { color: theme.textMuted }]}>
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
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  titleLarge: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 11.5, fontWeight: '600', marginTop: 3, lineHeight: 16 },
});
