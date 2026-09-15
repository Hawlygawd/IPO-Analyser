import { IPO } from './types';

const IST = 'Asia/Kolkata';

/** Parses a YYYY-MM-DD string as a local-midnight date (no UTC drift). */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
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

/** Whole days between two dates, normalised to UTC so DST can never skew it. */
export function diffDays(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** Days from today until an ISO date (negative when it is in the past). */
export function daysUntil(iso: string): number {
  return diffDays(startOfToday(), parseISO(iso));
}

/* --------------------------------------------------------------- money / % */

export function formatCr(value?: number): string {
  if (value == null) return 'TBA';
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
}

export function formatRupees(value: number, decimals = 0): string {
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatSignedRupees(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatRupees(Math.abs(value))}`;
}

export function formatPct(value: number, digits = 1): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%`;
}

export function formatMultiple(value: number): string {
  return `${value.toFixed(2)}x`;
}

/* ------------------------------------------------------------------ dates */

/** 12 Sep / 12 Sep 2025 */
export function formatDay(iso: string, withYear = false): string {
  const d = parseISO(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (withYear) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

/** Mon, 12 Sep */
export function formatWeekday(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatDayShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatDayDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 14 Sep, 2:15 PM - always shown in IST, which is how trackers publish quotes. */
export function formatIstTime(isoOrMs: string | number, withDate = true): string {
  const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: IST,
  };
  if (withDate) {
    opts.day = 'numeric';
    opts.month = 'short';
  }
  return d.toLocaleString('en-GB', opts).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}

export function relativeDay(iso: string): string {
  const diff = daysUntil(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

export function timeAgo(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDayDate(new Date(at));
}

/** Countdown label such as "closes in 1 day" / "closed". */
/**
 * How far a source's own stamp sits behind the moment we asked for it, in words.
 *
 * This is the difference a reader cares about when a board says "5:54 PM" at 8:46 PM: not
 * "when did the app fetch" but "how old is the number the source is publishing".
 */
export function quoteAge(asOf: string | null | undefined, at: number | null | undefined): string | null {
  if (!asOf || !at) return null;
  const stamp = new Date(asOf).getTime();
  if (!Number.isFinite(stamp)) return null;
  const minutes = Math.round((at - stamp) / 60000);
  if (minutes < 3) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function countdownLabel(iso: string): string {
  const d = daysUntil(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d > 1) return `in ${d} days`;
  if (d === -1) return 'yesterday';
  return `${Math.abs(d)} days ago`;
}

/* ------------------------------------------------------------ IPO numbers */

/** GMP as a percentage of the upper price band, or null when the band is TBA. */
export function gmpPercent(ipo: IPO): number | null {
  if (ipo.gmp == null || !ipo.priceBandHigh) return null;
  return (ipo.gmp / ipo.priceBandHigh) * 100;
}

/** Indicative listing price = upper price band + GMP. */
export function indicativeListing(ipo: IPO): number | null {
  if (ipo.priceBandHigh == null || ipo.gmp == null) return null;
  return ipo.priceBandHigh + ipo.gmp;
}

export function lotInvestment(ipo: IPO, lots = 1): number | null {
  if (ipo.lotSize == null || ipo.priceBandHigh == null) return null;
  return ipo.lotSize * ipo.priceBandHigh * lots;
}

export function priceBandLabel(ipo: IPO): string {
  if (ipo.priceBandLow == null || ipo.priceBandHigh == null) return 'Band TBA';
  if (ipo.priceBandLow === ipo.priceBandHigh) return formatRupees(ipo.priceBandLow);
  return `${formatRupees(ipo.priceBandLow)}–${formatRupees(ipo.priceBandHigh)}`;
}

/* ------------------------------------------------------------------ misc */

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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
