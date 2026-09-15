import { Platform } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Theme {
  mode: 'light' | 'dark';
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  textSub: string;
  textMuted: string;
  border: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  up: string;
  upSoft: string;
  down: string;
  downSoft: string;
  warn: string;
  warnSoft: string;
  info: string;
  infoSoft: string;
  neutral: string;
  neutralSoft: string;
  shadow: string;
}

/**
 * Light palette. Every foreground colour below was picked to clear WCAG AA (4.5:1) on
 * both the card and its own soft tint - gains, losses and labels are readable at 11-13px.
 */
export const lightTheme: Theme = {
  mode: 'light',
  bg: '#F4F6F9',
  card: '#FFFFFF',
  cardAlt: '#F7F9FC',
  text: '#12161C',
  textSub: '#5A6472',
  textMuted: '#67707F',
  border: '#DCE2EA',
  primary: '#0B7A54',
  primarySoft: '#E3F7EF',
  onPrimary: '#FFFFFF',
  up: '#0B7A54',
  upSoft: '#E3F7EF',
  down: '#C81E1E',
  downSoft: '#FDE7E7',
  warn: '#B45309',
  warnSoft: '#FEF3E2',
  info: '#1D4ED8',
  infoSoft: '#E6EEFE',
  neutral: '#4B5563',
  neutralSoft: '#EEF1F5',
  shadow: '#0B1B33',
};

export const darkTheme: Theme = {
  mode: 'dark',
  bg: '#0D1015',
  card: '#161B23',
  cardAlt: '#1D232D',
  text: '#F1F4F8',
  textSub: '#B7C0CD',
  textMuted: '#8B96A8',
  border: '#242B36',
  primary: '#12C98C',
  primarySoft: '#0E2A22',
  onPrimary: '#04140F',
  up: '#22C58B',
  upSoft: '#0E2A22',
  down: '#F05555',
  downSoft: '#2E1618',
  warn: '#F2B24C',
  warnSoft: '#2B2113',
  info: '#6698FF',
  infoSoft: '#141E33',
  neutral: '#98A2B3',
  neutralSoft: '#1E242D',
  shadow: '#000000',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };

export const space = (n: number) => n * 4;

type ShadowStyle = {
  elevation?: number;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: { width: number; height: number };
  boxShadow?: string;
};

const IS_WEB = Platform.OS === 'web';

/**
 * Soft elevated card shadow.
 *
 * react-native-web deprecated the `shadow*` props in favour of CSS `boxShadow`, so the
 * web branch must never emit them - otherwise every shadowed surface logs a deprecation
 * warning. Native keeps the elevation/shadow-props pair.
 */
export function cardShadow(mode: 'light' | 'dark'): ShadowStyle {
  if (IS_WEB) {
    return {
      boxShadow:
        mode === 'dark'
          ? '0 1px 3px rgba(0,0,0,0.5)'
          : '0 1px 2px rgba(11,27,51,0.06), 0 6px 16px rgba(11,27,51,0.05)',
    };
  }
  return mode === 'dark'
    ? {
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }
    : {
        elevation: 2,
        shadowColor: '#0B1B33',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      };
}

/** Floating surface shadow (toasts, popovers) - same web/native split as cardShadow. */
export function floatingShadow(mode: 'light' | 'dark'): ShadowStyle {
  if (IS_WEB) {
    return {
      boxShadow:
        mode === 'dark'
          ? '0 10px 30px rgba(0,0,0,0.55)'
          : '0 10px 30px rgba(11,27,51,0.18)',
    };
  }
  return {
    elevation: 6,
    shadowColor: mode === 'dark' ? '#000' : '#0B1B33',
    shadowOpacity: mode === 'dark' ? 0.5 : 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  };
}

export const AVATAR_COLORS = [
  '#0B5FFF',
  '#0B7A54',
  '#7C3AED',
  '#DB2777',
  '#EA580C',
  '#0891B2',
  '#4F46E5',
  '#57534E',
];
