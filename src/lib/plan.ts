/**
 * Plan / Year / Preferences (spec §2.3, §2.6, §2.7; schema v3 D4–D6).
 *
 * - Per-label monthly budgets: one row per label per month (unique
 *   month+label); no row means no plan for that label that month.
 * - Yearly goals: goal year field; the January reminder clears when at
 *   least one active goal exists for that year (no separate flag — the
 *   screens check `listYearlyGoals(year)` for active goals).
 * - Household preferences: default account, currency, date format,
 *   January reminder timing. Theme/appearance stay per-device in
 *   AsyncStorage and are NEVER stored here (v3 D6).
 * All writes carry an audit_log row.
 */
import { supabase } from './supabase';
import { resolveHouseholdId } from './auth';
import { logAudit } from './audit';
import { ensureMonth, type QueryResult } from './queries';
import { insertLabel } from './reference';
import type {
  Currency,
  DateFormat,
  HouseholdPreferences,
  JanuaryReminderTiming,
  LabelBudget,
  Projection,
  YearlyGoal,
} from './types';

function planErr<T>(message: string): QueryResult<T> {
  return { data: null, error: message };
}

/* --- Per-label budgets (Plan tab "Budget by label") --- */

export interface InsertLabelBudgetInput {
  household_id?: string | null;
  /** Month row id (from getMonth), not a 'YYYY-MM-01' key. */
  month_id: string;
  label_id: string;
  planned_cents: number;
}

export async function insertLabelBudget(
  input: InsertLabelBudgetInput,
): Promise<QueryResult<LabelBudget>> {
  const plannedCents = input.planned_cents;
  if (!Number.isInteger(plannedCents) || plannedCents < 0) {
    return planErr('Planned amount must be a non-negative whole number of cents.');
  }
  const resolved = await resolveHouseholdId(input.household_id ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  const monthId = input.month_id;
  const labelId = input.label_id;
  const { data: existing } = await supabase
    .from('label_budgets')
    .select('id')
    .eq('month_id', monthId)
    .eq('label_id', labelId)
    .limit(1);
  if ((existing as { id: string }[] | null)?.length) {
    return planErr('That label already has a budget for this month — update it instead.');
  }
  const { data, error } = await supabase
    .from('label_budgets')
    .insert({
      household_id: resolved.householdId,
      month_id: monthId,
      label_id: labelId,
      planned_cents: plannedCents,
    })
    .select('*')
    .single();
  if (error) return planErr(error.message);
  const budget = (data ?? null) as LabelBudget | null;
  if (budget) {
    await logAudit('insert', 'label_budgets', budget.id, { label_id: labelId, planned_cents: plannedCents }, resolved.householdId);
  }
  return { data: budget, error: null };
}

export async function updateLabelBudget(
  budgetId: string,
  plannedCents: number,
  householdId?: string | null,
): Promise<QueryResult<LabelBudget>> {
  if (!Number.isInteger(plannedCents) || plannedCents < 0) {
    return planErr('Planned amount must be a non-negative whole number of cents.');
  }
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  const { data, error } = await supabase
    .from('label_budgets')
    .update({ planned_cents: plannedCents })
    .eq('household_id', resolved.householdId)
    .eq('id', budgetId)
    .select('*')
    .single();
  if (error) return planErr(error.message);
  const budget = (data ?? null) as LabelBudget | null;
  if (budget) {
    await logAudit('update', 'label_budgets', budget.id, { planned_cents: plannedCents }, resolved.householdId);
  }
  return { data: budget, error: null };
}

/** Create or update the per-label budget for a month (unique month+label). */
export async function upsertLabelBudget(
  month: string,
  labelId: string,
  plannedCents: number,
  householdId?: string | null,
): Promise<QueryResult<LabelBudget>> {
  if (!Number.isInteger(plannedCents) || plannedCents < 0) {
    return planErr('Planned amount must be a non-negative whole number of cents.');
  }
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  const monthResult = await ensureMonth(resolved.householdId, month);
  if (!monthResult.data) return planErr(monthResult.error ?? 'Could not create the month row.');
  const { data, error } = await supabase
    .from('label_budgets')
    .upsert(
      {
        household_id: resolved.householdId,
        month_id: monthResult.data.id,
        label_id: labelId,
        planned_cents: plannedCents,
      },
      { onConflict: 'month_id,label_id' },
    )
    .select('*')
    .single();
  if (error) return planErr(error.message);
  const budget = (data ?? null) as LabelBudget | null;
  if (budget) {
    await logAudit('update', 'label_budgets', budget.id, { label_id: labelId, planned_cents: plannedCents }, resolved.householdId);
  }
  return { data: budget, error: null };
}

/* --- Projected income + month split (Plan tab) --- */

/**
 * Create or update a projected income source for a month. Per spec §2.3,
 * "Add source" also creates an Income label of the same name — call
 * `insertLabel` first (or pass `createLabel: true` here and this function
 * does both, ignoring a duplicate-label error when the label exists).
 */
export async function upsertProjection(
  month: string,
  category: string,
  projectedCents: number,
  opts?: { section?: 'Expense' | 'Income' | 'Savings'; createLabel?: boolean; householdId?: string | null },
): Promise<QueryResult<Projection>> {
  const name = category.trim();
  if (!name) return planErr('Source name is required.');
  if (!Number.isInteger(projectedCents) || projectedCents < 0) {
    return planErr('Projected amount must be a non-negative whole number of cents.');
  }
  const resolved = await resolveHouseholdId(opts?.householdId ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  const section = opts?.section ?? 'Income';
  const monthResult = await ensureMonth(resolved.householdId, month);
  if (!monthResult.data) return planErr(monthResult.error ?? 'Could not create the month row.');
  if (opts?.createLabel && section === 'Income') {
    const labelResult = await insertLabel({
      label: name,
      category: name,
      section: 'Income',
      householdId: resolved.householdId,
    });
    if (labelResult.error && !labelResult.error.includes('already exists')) {
      return planErr(labelResult.error);
    }
  }
  const { data, error } = await supabase
    .from('projections')
    .upsert(
      {
        month_id: monthResult.data.id,
        category: name,
        section,
        projected_cents: projectedCents,
      },
      { onConflict: 'month_id,category,section' },
    )
    .select('*')
    .single();
  if (error) return planErr(error.message);
  const projection = (data ?? null) as Projection | null;
  if (projection) {
    await logAudit('update', 'projections', projection.id, { category: name, projected_cents: projectedCents }, resolved.householdId);
  }
  return { data: projection, error: null };
}

export async function deleteProjection(
  projectionId: string,
  householdId?: string | null,
): Promise<QueryResult<{ id: string }>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  // Projections carry no household_id (scoped via months); delete by id and let RLS enforce membership.
  const { error } = await supabase.from('projections').delete().eq('id', projectionId);
  if (error) return planErr(error.message);
  await logAudit('delete', 'projections', projectionId, {}, resolved.householdId);
  return { data: { id: projectionId }, error: null };
}

/**
 * Update the Needs/Wants/Savings split percentages on a month row.
 * Over 100% total is blocked; under 100% shows as Unallocated (spec §2.3).
 */
export async function updateMonthSplit(
  month: string,
  split: { needsPct: number | null; wantsPct: number | null; savingsPct: number | null },
  householdId?: string | null,
): Promise<QueryResult<{ month: string; needsPct: number | null; wantsPct: number | null; savingsPct: number | null }>> {
  for (const [key, value] of Object.entries(split)) {
    if (value !== null && (typeof value !== 'number' || value < 0 || value > 100)) {
      return planErr(`${key} must be between 0 and 100.`);
    }
  }
  const total = (split.needsPct ?? 0) + (split.wantsPct ?? 0) + (split.savingsPct ?? 0);
  if (total > 100) {
    return planErr(`Split totals ${total}% — over 100% is not allowed.`);
  }
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  const monthResult = await ensureMonth(resolved.householdId, month);
  if (!monthResult.data) return planErr(monthResult.error ?? 'Could not create the month row.');
  const { error } = await supabase
    .from('months')
    .update({
      projected_needs_pct: split.needsPct,
      projected_wants_pct: split.wantsPct,
      projected_savings_pct: split.savingsPct,
    })
    .eq('id', monthResult.data.id);
  if (error) return planErr(error.message);
  await logAudit('update', 'months', monthResult.data.id, { split }, resolved.householdId);
  return { data: { month, ...split }, error: null };
}

/* --- Yearly goals --- */

export interface UpsertYearlyGoalInput {
  /** Omit to create; pass to update. */
  id?: string;
  year: number;
  goal: string;
  target_cents?: number | null;
  fund_id?: string | null;
  household_id?: string | null;
}

export async function upsertYearlyGoal(input: UpsertYearlyGoalInput): Promise<QueryResult<YearlyGoal>> {
  const text = input.goal.trim();
  if (!text) return planErr('Goal text is required.');
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return planErr('Year is invalid.');
  }
  if (input.target_cents !== undefined && input.target_cents !== null &&
      (!Number.isInteger(input.target_cents) || input.target_cents < 0)) {
    return planErr('Target must be a non-negative whole number of cents.');
  }
  const resolved = await resolveHouseholdId(input.household_id ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  if (input.fund_id) {
    const { data: fund } = await supabase
      .from('savings_funds')
      .select('id')
      .eq('household_id', resolved.householdId)
      .eq('id', input.fund_id)
      .maybeSingle();
    if (!fund) return planErr('Savings bucket not found.');
  }
  const row = {
    household_id: resolved.householdId,
    year: input.year,
    goal: text,
    target_cents: input.target_cents ?? null,
    fund_id: input.fund_id ?? null,
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('yearly_goals')
      .update(row)
      .eq('household_id', resolved.householdId)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) return planErr(error.message);
    const goalRow = (data ?? null) as YearlyGoal | null;
    if (goalRow) {
      await logAudit('update', 'yearly_goals', goalRow.id, { goal: text, year: input.year }, resolved.householdId);
    }
    return { data: goalRow, error: null };
  }
  const { data, error } = await supabase.from('yearly_goals').insert(row).select('*').single();
  if (error) return planErr(error.message);
  const goalRow = (data ?? null) as YearlyGoal | null;
  if (goalRow) {
    await logAudit('insert', 'yearly_goals', goalRow.id, { goal: text, year: input.year }, resolved.householdId);
  }
  return { data: goalRow, error: null };
}

export async function deleteYearlyGoal(
  goalId: string,
  householdId?: string | null,
): Promise<QueryResult<{ id: string }>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  const { error } = await supabase
    .from('yearly_goals')
    .delete()
    .eq('household_id', resolved.householdId)
    .eq('id', goalId);
  if (error) return planErr(error.message);
  await logAudit('delete', 'yearly_goals', goalId, {}, resolved.householdId);
  return { data: { id: goalId }, error: null };
}

/* --- Household preferences --- */

export interface SaveHouseholdPreferencesPatch {
  default_account_id?: string | null;
  currency?: Currency;
  date_format?: DateFormat;
  january_reminder_timing?: JanuaryReminderTiming | null;
}

/**
 * Save household preferences (upsert on household_id). Theme/appearance
 * are NOT here — they stay per-device in AsyncStorage (v3 D6).
 */
export async function saveHouseholdPreferences(
  householdId: string,
  patch: SaveHouseholdPreferencesPatch,
): Promise<QueryResult<HouseholdPreferences>> {
  const resolved = await resolveHouseholdId(householdId);
  if (!resolved.householdId) return planErr(resolved.error ?? 'No household found.');
  if (patch.currency !== undefined && !['USD', 'EUR', 'GBP'].includes(patch.currency)) {
    return planErr('Currency must be USD, EUR, or GBP.');
  }
  if (patch.date_format !== undefined && !['mdy', 'dmy', 'slash', 'iso'].includes(patch.date_format)) {
    return planErr('Date format must be mdy, dmy, slash, or iso.');
  }
  if (
    patch.january_reminder_timing !== undefined &&
    patch.january_reminder_timing !== null &&
    !['Jan 1', 'first weekend', 'Jan 15'].includes(patch.january_reminder_timing)
  ) {
    return planErr('January reminder timing must be "Jan 1", "first weekend", or "Jan 15".');
  }
  if (patch.default_account_id) {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('household_id', resolved.householdId)
      .eq('id', patch.default_account_id)
      .maybeSingle();
    if (!account) return planErr('Default account not found.');
  }
  const updates: Record<string, unknown> = {};
  if (patch.default_account_id !== undefined) updates.default_account_id = patch.default_account_id;
  if (patch.currency !== undefined) updates.currency = patch.currency;
  if (patch.date_format !== undefined) updates.date_format = patch.date_format;
  if (patch.january_reminder_timing !== undefined) {
    updates.january_reminder_timing = patch.january_reminder_timing;
  }
  const { data, error } = await supabase
    .from('household_preferences')
    .upsert({ household_id: resolved.householdId, ...updates }, { onConflict: 'household_id' })
    .select('*')
    .single();
  if (error) return planErr(error.message);
  const prefs = (data ?? null) as HouseholdPreferences | null;
  if (prefs) {
    await logAudit('update', 'household_preferences', resolved.householdId, updates, resolved.householdId);
  }
  return { data: prefs, error: null };
}
