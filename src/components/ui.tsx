import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AVATAR_COLORS, cardShadow, radius, Theme } from '../theme';
import { colorFromString, initials } from '../lib/format';

/* ------------------------------------------------------------------ Avatar */

export function Avatar({ name, size = 44, theme }: { name: string; size?: number; theme: Theme }) {
  const bg = colorFromString(name, AVATAR_COLORS);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.36, fontWeight: '700', letterSpacing: 0.3 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------- Chips */

export type ChipTone = 'up' | 'down' | 'warn' | 'info' | 'neutral' | 'primary';

const TONE_BG: Record<ChipTone, keyof Theme> = {
  up: 'upSoft',
  down: 'downSoft',
  warn: 'warnSoft',
  info: 'infoSoft',
  neutral: 'neutralSoft',
  primary: 'primarySoft',
};
const TONE_FG: Record<ChipTone, keyof Theme> = {
  up: 'up',
  down: 'down',
  warn: 'warn',
  info: 'info',
  neutral: 'neutral',
  primary: 'primary',
};

export function Chip({
  label,
  tone = 'neutral',
  theme,
  small,
  icon,
}: {
  label: string;
  tone?: ChipTone;
  theme: Theme;
  small?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const bg = theme[TONE_BG[tone]] as string;
  const fg = theme[TONE_FG[tone]] as string;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: bg,
        paddingHorizontal: small ? 7 : 9,
        paddingVertical: small ? 3 : 4.5,
        borderRadius: radius.pill,
      }}
    >
      {icon ? <Ionicons name={icon} size={small ? 10 : 12} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: small ? 10.5 : 11.5, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------ Section card */

export function SectionCard({
  theme,
  title,
  right,
  children,
  style,
}: {
  theme: Theme;
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        { backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: 14 },
        cardShadow(theme.mode),
        style,
      ]}
    >
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/* ---------------------------------------------------------------- Stat cell */

export function StatCell({
  label,
  value,
  sub,
  tone,
  theme,
  align = 'flex-start',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: ChipTone;
  theme: Theme;
  align?: ViewStyle['alignItems'];
}) {
  const color = tone ? (theme[TONE_FG[tone]] as string) : theme.text;
  return (
    <View style={{ flex: 1, alignItems: align }}>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={[styles.statSub, { color: theme.textMuted }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ Buttons */

export function Button({
  label,
  onPress,
  theme,
  variant = 'primary',
  icon,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  variant?: 'primary' | 'ghost' | 'soft';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === 'primary' ? theme.primary : variant === 'soft' ? theme.primarySoft : 'transparent';
  const fg = variant === 'primary' ? theme.onPrimary : theme.primary;
  const border: ViewStyle = variant === 'ghost' ? { borderWidth: 1, borderColor: theme.border } : {};
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingVertical: 12,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        border,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------- Empty state */

export function EmptyState({
  theme,
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View
        style={{
          width: 68,
          height: 68,
          borderRadius: 34,
          backgroundColor: theme.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <Ionicons name={icon} size={30} color={theme.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.emptyMsg, { color: theme.textSub }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} theme={theme} style={{ marginTop: 18, minWidth: 190 }} />
      ) : null}
    </View>
  );
}

/* ----------------------------------------------------------------- Skeleton */

function Pulse({ children, theme }: { children: React.ReactNode; theme: Theme }) {
  const value = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return (
    <Animated.View style={{ opacity: value, backgroundColor: theme.card, borderRadius: radius.lg }}>
      {children}
    </Animated.View>
  );
}

export function CardSkeleton({ theme }: { theme: Theme }) {
  return (
    <Pulse theme={theme}>
      <View style={[styles.skeletonCard, { borderColor: theme.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.neutralSoft }} />
          <View style={{ flex: 1, gap: 7 }}>
            <View style={{ height: 12, width: '58%', borderRadius: 6, backgroundColor: theme.neutralSoft }} />
            <View style={{ height: 9, width: '38%', borderRadius: 5, backgroundColor: theme.neutralSoft }} />
          </View>
          <View style={{ width: 56, height: 20, borderRadius: 10, backgroundColor: theme.neutralSoft }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 14 }}>
          <View style={{ height: 26, width: 74, borderRadius: 6, backgroundColor: theme.neutralSoft }} />
          <View style={{ height: 26, width: 74, borderRadius: 6, backgroundColor: theme.neutralSoft }} />
          <View style={{ height: 26, width: 74, borderRadius: 6, backgroundColor: theme.neutralSoft }} />
        </View>
      </View>
    </Pulse>
  );
}

export function Spinner({ theme, label }: { theme: Theme; label?: string }) {
  return (
    <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={theme.primary} />
      {label ? <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{label}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ Helpers */

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function Divider({ theme }: { theme: Theme }) {
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

export function textVariants(theme: Theme) {
  const h1: TextStyle = { fontSize: 26, fontWeight: '800', color: theme.text, letterSpacing: -0.4 };
  const h2: TextStyle = { fontSize: 18, fontWeight: '800', color: theme.text, letterSpacing: -0.2 };
  const sub: TextStyle = { fontSize: 13, color: theme.textSub, lineHeight: 19 };
  return { h1, h2, sub };
}

const styles = StyleSheet.create({
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.1 },
  statLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  statValue: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  statSub: { fontSize: 10.5, marginTop: 1 },
  empty: { alignItems: 'center', paddingHorizontal: 30, paddingVertical: 44 },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  emptyMsg: { fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  skeletonCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
});
