import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AVATAR_COLORS, cardShadow, radius, Theme } from '../theme';
import { colorFromString, initials } from '../lib/format';

/** Figures line up in columns when the platform font supports tabular numerals. */
export const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/* ------------------------------------------------------------------ layout */

export function Row({
  children,
  style,
  gap,
  align = 'center',
  justify,
  wrap,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small uppercase label used above figures and in section headers. */
export function MicroLabel({
  children,
  theme,
  style,
}: {
  children: React.ReactNode;
  theme: Theme;
  style?: TextStyle;
}) {
  return (
    <Text style={[styles.micro, { color: theme.textMuted }, style]} numberOfLines={1}>
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({ name, size = 44 }: { name: string; size?: number; theme?: Theme }) {
  const bg = colorFromString(name, AVATAR_COLORS);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
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

/* ------------------------------------------------------------------- chips */

export type ChipTone = 'up' | 'down' | 'warn' | 'info' | 'neutral' | 'primary';
export type ChipSize = 'sm' | 'md';

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

export function chipColors(theme: Theme, tone: ChipTone) {
  return { bg: theme[TONE_BG[tone]] as string, fg: theme[TONE_FG[tone]] as string };
}

export function Chip({
  label,
  tone = 'neutral',
  theme,
  small,
  size,
  icon,
  accessibilityLabel,
}: {
  label: string;
  tone?: ChipTone;
  theme: Theme;
  small?: boolean;
  size?: ChipSize;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
}) {
  const s: ChipSize = size ?? (small ? 'sm' : 'md');
  const { bg, fg } = chipColors(theme, tone);
  return (
    <View
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: bg,
        paddingHorizontal: s === 'sm' ? 7 : 9,
        paddingVertical: s === 'sm' ? 3 : 4.5,
        borderRadius: radius.pill,
        alignSelf: 'flex-start',
      }}
    >
      {icon ? <Ionicons name={icon} size={s === 'sm' ? 10 : 12} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: s === 'sm' ? 10.5 : 11.5, fontWeight: '700' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------- section card */

export function SectionCard({
  theme,
  title,
  subtitle,
  right,
  children,
  style,
  contentStyle,
}: {
  theme: Theme;
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  contentStyle?: ViewStyle;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
        cardShadow(theme.mode),
        style,
      ]}
    >
      {title ? (
        <View style={styles.sectionHead}>
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: theme.text }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={{ fontSize: 11.5, color: theme.textMuted, marginTop: 2, fontWeight: '600' }}
                numberOfLines={2}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

export function KeyValueRow({
  theme,
  label,
  value,
  tone,
  onPress,
  icon,
  multiline,
}: {
  theme: Theme;
  label: string;
  value: string;
  tone?: 'text' | 'up' | 'down' | 'warn' | 'info' | 'primary';
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  multiline?: boolean;
}) {
  const content = (
    <Row style={styles.kvRow} gap={12} align="flex-start">
      <Text style={{ flex: 1, fontSize: 12.5, color: theme.textMuted, fontWeight: '600' }}>{label}</Text>
      <Text
        numberOfLines={multiline ? 3 : 1}
        style={{
          flexShrink: 1,
          maxWidth: '62%',
          fontSize: 12.5,
          fontWeight: '700',
          color: (theme[tone ?? 'text'] as string) ?? theme.text,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
      {icon ? <Ionicons name={icon} size={14} color={theme.textMuted} /> : null}
    </Row>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
    >
      {content}
    </Pressable>
  );
}

/* ----------------------------------------------------------------- buttons */

export function Button({
  label,
  onPress,
  theme,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  variant?: 'primary' | 'ghost' | 'soft' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle | ViewStyle[];
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const bg =
    variant === 'primary'
      ? theme.primary
      : variant === 'soft'
        ? theme.primarySoft
        : variant === 'danger'
          ? theme.downSoft
          : 'transparent';
  const fg =
    variant === 'primary' ? theme.onPrimary : variant === 'danger' ? theme.down : theme.primary;
  const border: ViewStyle = variant === 'ghost' ? { borderWidth: 1, borderColor: theme.border } : {};
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingVertical: 12,
          paddingHorizontal: 18,
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        border,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  theme,
  accessibilityLabel,
  size = 38,
  tone = 'text',
  badge,
  active,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  theme: Theme;
  accessibilityLabel: string;
  size?: number;
  tone?: 'text' | 'primary' | 'warn' | 'down';
  badge?: boolean;
  active?: boolean;
  style?: ViewStyle;
}) {
  const fg = theme[tone] as string;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? theme.primarySoft : theme.card,
          borderColor: active ? theme.primary : theme.border,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.5} color={active ? theme.primary : fg} />
      {badge ? (
        <View style={[styles.badgeDot, { backgroundColor: theme.down, borderColor: theme.card }]} />
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ meter */

export function ProgressMeter({
  value,
  theme,
  tone = 'primary',
  height = 8,
  accessibilityLabel,
}: {
  value: number;
  theme: Theme;
  tone?: 'primary' | 'up' | 'warn' | 'down' | 'info';
  height?: number;
  accessibilityLabel?: string;
}) {
  const pct = Math.max(2, Math.min(100, value));
  const color = theme[tone] as string;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={[styles.meterTrack, { backgroundColor: theme.neutralSoft, height }]}
    >
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: radius.pill, backgroundColor: color }} />
    </View>
  );
}

/* ------------------------------------------------------------- empty state */

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
      <Text accessibilityRole="header" style={[styles.emptyTitle, { color: theme.text }]}>
        {title}
      </Text>
      <Text style={[styles.emptyMsg, { color: theme.textSub }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          theme={theme}
          style={{ marginTop: 18, minWidth: 190 }}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ toast */

export function ToastHost({
  message,
  tone = 'info',
  theme,
  onDismiss,
}: {
  message: string;
  tone?: 'info' | 'up' | 'down' | 'warn';
  theme: Theme;
  onDismiss: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: USE_NATIVE_DRIVER,
      damping: 18,
      stiffness: 220,
    }).start();
  }, [anim]);

  const { bg, fg } = chipColors(theme, tone);
  const icon =
    tone === 'up' ? 'checkmark-circle' : tone === 'down' ? 'alert-circle' : 'information-circle';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastWrap,
        {
          // anchored to the top so it can never cover the sticky action bar
          top: insets.top + 10,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
        },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${message}. Dismiss.`}
        style={[styles.toast, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={15} color={fg} />
        </View>
        <Text
          style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: theme.text, lineHeight: 17 }}
          numberOfLines={3}
        >
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 14 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.1 },
  micro: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  kvRow: { paddingVertical: 6 },
  meterTrack: { borderRadius: radius.pill, overflow: 'hidden' },
  empty: { alignItems: 'center', paddingHorizontal: 30, paddingVertical: 44 },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  emptyMsg: { fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.5,
  },
  toastWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    alignItems: 'center',
    zIndex: 40,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 12,
    maxWidth: 520,
    width: '100%',
    shadowColor: '#0B1B33',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
