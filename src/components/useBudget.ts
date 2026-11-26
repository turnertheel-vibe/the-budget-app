/**
 * Shared budget-data helpers for screens.
 *
 * - useHousehold(): the signed-in user's (first) household + preferences.
 *   v1 assumes one household per user. Everything is loaded from Supabase
 *   at runtime; no names or amounts are hardcoded here.
 * - computeMonthSummary(): the single derivation Home / Plan / Year share,
 *   mirroring the prototype's bucket math: a bucket-paid expense still
 *   counts toward its label's Needs/Wants category, and reduces the
 *   Savings figure by the same amount (it is not double-counted).
 * - resultError(): defensive check for the { data, error } shape the data
 *   layer returns, so screens work whether a mutation returns a result
 *   object or void.
 */
import { useCallback, useEffect, useState } from 'react';
import { getHouseholdPreferences, listMyHouseholds } from '../lib/queries';
import { monthKey } from '../lib/money';
import type {
  Currency,
  DateFormat,
  HouseholdPreferences,
  Label,
  Projection,
  Transaction,
} from '../lib/types';

export interface HouseholdContext {
  householdId: string | null;
  prefs: HouseholdPreferences | null;
  currency: Currency;
  dateFormat: DateFormat;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useHousehold(): HouseholdContext {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<HouseholdPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data: members, error: membersError } = await listMyHouseholds();
        if (!mounted) return;
        if (membersError) {
          setError(membersError);
          setLoading(false);
          return;
        }
        const first = members && members.length > 0 ? members[0] : null;
        if (!first) {
          setError('No household found for this account yet.');
          setLoading(false);
          return;
        }
        setHouseholdId(first.household_id);
        const { data: p, error: prefsError } = await getHouseholdPreferences(first.household_id);
        if (!mounted) return;
        if (prefsError) setError(prefsError);
        else setPrefs(p);
        setLoading(false);
      } catch (err) {
        // A network-level failure throws instead of resolving with an
        // error — without this the app would spin on Loading… forever.
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Could not load your household.');
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return {
    householdId,
    prefs,
    currency: prefs?.currency ?? 'USD',
    dateFormat: prefs?.date_format ?? 'mdy',
    loading,
    error,
    refresh,
  };
}

/** '2026-11-01' shifted by `delta` months. */
export function shiftMonth(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Fraction of the month elapsed, for the pace tick (0–1). Past months = 1, future = 0. */
export function monthPace(monthIso: string): number {
  const now = new Date();
  const current = monthKey(now);
  if (monthIso < current) return 1;
  if (monthIso > current) return 0;
  const [y, m] = monthIso.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.min(1, now.getDate() / daysInMonth);
}

export interface MonthSummary {
  projectedIncome: number;
  incomeActual: number;
  needsActual: number;
  wantsActual: number;
  savingsActual: number;
  out: number;
  leftToSpend: number;
  perSource: { name: string; projected: number; actual: number }[];
  perLabelSpent: Map<string, number>;
}

export function computeMonthSummary(
  transactions: Transaction[],
  labels: Label[],
  projections: Projection[],
  bucketPaidTxnIds: Set<string>,
): MonthSummary {
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const projectedIncome = projections.reduce((s, p) => s + p.projected_cents, 0);
  let incomeActual = 0;
  let needsActual = 0;
  let wantsActual = 0;
  let savingsActual = 0;
  const perLabelSpent = new Map<string, number>();
  const actualByLabelName = new Map<string, number>();

  for (const t of transactions) {
    const label = t.label ?? labelById.get(t.label_id);
    if (!label) continue;
    perLabelSpent.set(t.label_id, (perLabelSpent.get(t.label_id) ?? 0) + t.amount_cents);
    if (label.section === 'Income') {
      incomeActual += t.amount_cents;
      actualByLabelName.set(label.label, (actualByLabelName.get(label.label) ?? 0) + t.amount_cents);
    } else if (label.section === 'Savings') {
      savingsActual += t.amount_cents;
    } else if (label.section === 'Expense') {
      const spent = t.amount_cents; // positive = spend; negatives (reimb/refund) net against it
      if (label.needs_wants === 'Needs') needsActual += spent;
      else wantsActual += spent;
      if (bucketPaidTxnIds.has(t.id)) savingsActual -= spent;
    }
  }

  const perSource = projections.map((p) => ({
    name: p.category,
    projected: p.projected_cents,
    actual: actualByLabelName.get(p.category) ?? 0,
  }));

  const out = needsActual + wantsActual + savingsActual;
  return {
    projectedIncome,
    incomeActual,
    needsActual,
    wantsActual,
    savingsActual,
    out,
    leftToSpend: projectedIncome - out,
    perSource,
    perLabelSpent,
  };
}

/** Extract the error string from a data-layer result ({ data, error } or void). */
export function resultError(result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    const err = (result as { error?: unknown }).error;
    return typeof err === 'string' && err ? err : null;
  }
  return null;
}

/** Extract the data payload from a data-layer result, or null. */
export function resultData<T>(result: unknown): T | null {
  if (result && typeof result === 'object' && 'data' in result) {
    return (result as { data?: T | null }).data ?? null;
  }
  return null;
}
