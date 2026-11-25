/** Money + date formatting. Money is integer cents everywhere; display only here. */
import type { Currency, DateFormat } from './types';

const CURRENCY_LOCALES: Record<Currency, { locale: string; currency: Currency }> = {
  USD: { locale: 'en-US', currency: 'USD' },
  EUR: { locale: 'de-DE', currency: 'EUR' },
  GBP: { locale: 'en-GB', currency: 'GBP' },
};

export function formatMoney(cents: number, currency: Currency = 'USD'): string {
  const { locale } = CURRENCY_LOCALES[currency];
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/** "$7,281.16" → dollars with a separate cents span is a UI concern; this is the plain form. */
export function formatMoneyParts(
  cents: number,
  currency: Currency = 'USD',
): { dollars: string; cents: string } {
  const formatted = formatMoney(cents, currency);
  const match = formatted.match(/^(.*?)(\.\d{2})$/);
  if (!match) return { dollars: formatted, cents: '' };
  return { dollars: match[1], cents: match[2] };
}

/** "12.34" / "$12.34" → 1234 cents. Returns null when unparseable. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

export function formatDate(isoDate: string, format: DateFormat = 'mdy'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  switch (format) {
    case 'dmy':
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    case 'slash':
      return `${m}/${d}/${y}`;
    case 'iso':
      return isoDate;
    case 'mdy':
    default:
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
}

/** '2026-11-01' → 'November 2026'. */
export function formatMonth(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number);
  if (!y || !m) return monthIso;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** First day of the month containing `date`, as 'YYYY-MM-01'. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Today as a local 'YYYY-MM-DD' date string. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}
