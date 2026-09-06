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

export const lightTheme: Theme = {
  mode: 'light',
  bg: '#F4F6F9',
  card: '#FFFFFF',
  cardAlt: '#F7F9FC',
  text: '#12161C',
  textSub: '#5A6472',
  textMuted: '#8A94A3',
  border: '#E6EAF0',
  primary: '#00A870',
  primarySoft: '#E3F7EF',
  onPrimary: '#FFFFFF',
  up: '#0E9F6E',
  upSoft: '#E3F7EF',
  down: '#E02424',
  downSoft: '#FDE7E7',
  warn: '#B45309',
  warnSoft: '#FEF3E2',
  info: '#2563EB',
  infoSoft: '#E6EEFE',
  neutral: '#6B7280',
  neutralSoft: '#EEF1F5',
  shadow: '#0B1B33',
};

export const darkTheme: Theme = {
  mode: 'dark',
  bg: '#0D1015',
  card: '#161B23',
  cardAlt: '#1D232D',
  text: '#F1F4F8',
  textSub: '#A7B0BE',
  textMuted: '#7C8798',
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

/** Soft elevated card shadow - platform aware. */
export function cardShadow(mode: 'light' | 'dark') {
  if (mode === 'dark') {
    return Platform.select({
      web: { boxShadow: '0 1px 3px rgba(0,0,0,0.5)' } as any,
      default: {
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
    }) as any;
  }
  return Platform.select({
    web: { boxShadow: '0 1px 2px rgba(11,27,51,0.06), 0 6px 16px rgba(11,27,51,0.05)' } as any,
    default: {
      elevation: 2,
      shadowColor: '#0B1B33',
      shadowOpacity: 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
  }) as any;
}

export const AVATAR_COLORS = [
  '#0B5FFF',
  '#00A870',
  '#7C3AED',
  '#DB2777',
  '#EA580C',
  '#0891B2',
  '#4F46E5',
  '#57534E',
];
