import { IPO } from './types';

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export function diffDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

export function formatCr(value?: number): string {
  if (value == null) return 'TBA';
  return `\u20B9${value.toLocaleString('en-IN')} Cr`;
}

export function formatRupees(value: number): string {
  return `\u20B9${value.toLocaleString('en-IN')}`;
}

export function formatDec(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** 12 Sep / 12 Sep 2025 */
export function formatDay(iso: string, withYear = false): string {
  const d = parseISO(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (withYear) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

export function formatDayDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDay(iso: string): string {
  const today = startOfToday();
  const diff = diffDays(today, parseISO(iso));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

/** GMP as a percentage of the upper price band, or null when the band is TBA. */
export function gmpPercent(ipo: IPO): number | null {
  if (ipo.gmp == null || !ipo.priceBandHigh) return null;
  return (ipo.gmp / ipo.priceBandHigh) * 100;
}

export function lotInvestment(ipo: IPO): number | null {
  if (ipo.lotSize == null || ipo.priceBandHigh == null) return null;
  return ipo.lotSize * ipo.priceBandHigh;
}

export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'IP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function colorFromString(input: string, palette: string[]): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return palette[Math.abs(h) % palette.length];
}
