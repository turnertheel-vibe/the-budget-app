/**
 * Data layer — thin typed wrappers over Supabase. No business logic here;
 * derived values (left-to-spend, pace, per-label spent-vs-planned, pool
 * balance) are computed by the screens from these rows, or read from the
 * derived views. Every query is household-scoped; RLS enforces it server-side.
 */
import { supabase } from './supabase';
import { getMyHouseholdId } from './auth';
import { logAudit } from './audit';
import type {
  Account,
  AuditLogEntry,
  DescriptorMapping,
  Household,
  HouseholdMember,
  HouseholdPreferences,
  Label,
  LabelBudget,
  Month,
  MonthlyActual,
  OpenItem,
  Projection,
  ReimbursementLogEntry,
  SavingsFund,
  SavingsFundBalance,
  SavingsFundMovement,
  SavingsPoolBalance,
  Transaction,
  YearlyGoal,
} from './types';

export type QueryResult<T> = { data: T | null; error: string | null };

function toResult<T>(data: T | null, error: { message: string } | null): QueryResult<T> {
  return { data, error: error ? error.message : null };
}

/** The signed-in user's household memberships (v1 assumes one household; pick the first). */
export async function listMyHouseholds(): Promise<QueryResult<HouseholdMember[]>> {
  const { data, error } = await supabase
    .from('household_members')
    .select('*, profile:profiles(*)')
    .order('created_at', { ascending: true });
  return toResult((data ?? []) as HouseholdMember[], error);
}

export async function getHousehold(householdId: string): Promise<QueryResult<Household>> {
  const { data, error } = await supabase.from('households').select('*').eq('id', householdId).single();
  return toResult((data ?? null) as Household | null, error);
}

export async function listHouseholdMembers(householdId: string): Promise<QueryResult<HouseholdMember[]>> {
  const { data, error } = await supabase
    .from('household_members')
    .select('*, profile:profiles(*)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  return toResult((data ?? []) as HouseholdMember[], error);
}

/** Month row for a household + 'YYYY-MM-01' key, or null when the month has no row yet. */
export async function getMonth(householdId: string, month: string): Promise<QueryResult<Month>> {
  const { data, error } = await supabase
    .from('months')
    .select('*')
    .eq('household_id', householdId)
    .eq('month', month)
    .maybeSingle();
  return toResult((data ?? null) as Month | null, error);
}

export async function listLabels(householdId: string): Promise<QueryResult<Label[]>> {
  const { data, error } = await supabase
    .from('labels')
    .select('*')
    .eq('household_id', householdId)
    .order('label', { ascending: true });
  return toResult((data ?? []) as Label[], error);
}

export async function listAccounts(householdId: string): Promise<QueryResult<Account[]>> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('household_id', householdId)
    .order('name', { ascending: true });
  return toResult((data ?? []) as Account[], error);
}

export async function listTransactions(
  householdId: string,
  monthId: string,
): Promise<QueryResult<Transaction[]>> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, label:labels(*), account:accounts(*)')
    .eq('household_id', householdId)
    .eq('month_id', monthId)
    .order('txn_date', { ascending: false })
    .order('created_at', { ascending: false });
  return toResult((data ?? []) as Transaction[], error);
}

export async function listMonthlyActuals(
  householdId: string,
  monthId: string,
): Promise<QueryResult<MonthlyActual[]>> {
  const { data, error } = await supabase
    .from('v_monthly_actuals')
    .select('*')
    .eq('household_id', householdId)
    .eq('month_id', monthId);
  return toResult((data ?? []) as MonthlyActual[], error);
}

export async function listProjections(
  householdId: string,
  monthId: string,
): Promise<QueryResult<Projection[]>> {
  // Projections has no household_id column — a projection belongs to a
  // household through its month, and RLS enforces that. Filter by month
  // only. (Filtering by household_id here fails with
  // "column projections.household_id does not exist".)
  void householdId;
  const { data, error } = await supabase
    .from('projections')
    .select('*')
    .eq('month_id', monthId)
    .order('category', { ascending: true });
  return toResult((data ?? []) as Projection[], error);
}

export async function listLabelBudgets(
  householdId: string,
  monthId: string,
): Promise<QueryResult<LabelBudget[]>> {
  const { data, error } = await supabase
    .from('label_budgets')
    .select('*')
    .eq('household_id', householdId)
    .eq('month_id', monthId);
  return toResult((data ?? []) as LabelBudget[], error);
}

export async function listSavingsFunds(householdId: string): Promise<QueryResult<SavingsFund[]>> {
  const { data, error } = await supabase
    .from('savings_funds')
    .select('*')
    .eq('household_id', householdId)
    .order('name', { ascending: true });
  return toResult((data ?? []) as SavingsFund[], error);
}

export async function listSavingsMovements(
  householdId: string,
  fundId?: string,
): Promise<QueryResult<SavingsFundMovement[]>> {
  let query = supabase
    .from('savings_fund_movements')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });
  if (fundId) query = query.eq('fund_id', fundId);
  const { data, error } = await query;
  return toResult((data ?? []) as SavingsFundMovement[], error);
}

export async function getSavingsPoolBalance(
  householdId: string,
): Promise<QueryResult<SavingsPoolBalance>> {
  const { data, error } = await supabase
    .from('v_savings_pool_balance')
    .select('*')
    .eq('household_id', householdId)
    .maybeSingle();
  return toResult((data ?? null) as SavingsPoolBalance | null, error);
}

export async function listSavingsFundBalances(
  householdId: string,
): Promise<QueryResult<SavingsFundBalance[]>> {
  const { data, error } = await supabase
    .from('v_savings_fund_balances')
    .select('*')
    .eq('household_id', householdId);
  return toResult((data ?? []) as SavingsFundBalance[], error);
}

export async function listOpenItems(householdId: string): Promise<QueryResult<OpenItem[]>> {
  const { data, error } = await supabase
    .from('open_items')
    .select('*')
    .eq('household_id', householdId)
    .eq('status', 'open')
    .order('item_date', { ascending: false });
  return toResult((data ?? []) as OpenItem[], error);
}

export async function listReimbursements(
  householdId: string,
): Promise<QueryResult<ReimbursementLogEntry[]>> {
  const { data, error } = await supabase
    .from('reimbursement_log')
    .select('*')
    .eq('household_id', householdId)
    .order('date_received', { ascending: false });
  return toResult((data ?? []) as ReimbursementLogEntry[], error);
}

export async function listYearlyGoals(
  householdId: string,
  year: number,
): Promise<QueryResult<YearlyGoal[]>> {
  const { data, error } = await supabase
    .from('yearly_goals')
    .select('*')
    .eq('household_id', householdId)
    .eq('year', year)
    .order('created_at', { ascending: true });
  return toResult((data ?? []) as YearlyGoal[], error);
}

export async function getHouseholdPreferences(
  householdId: string,
): Promise<QueryResult<HouseholdPreferences>> {
  const { data, error } = await supabase
    .from('household_preferences')
    .select('*')
    .eq('household_id', householdId)
    .maybeSingle();
  return toResult((data ?? null) as HouseholdPreferences | null, error);
}

export async function listDescriptorMappings(
  householdId: string,
): Promise<QueryResult<DescriptorMapping[]>> {
  const { data, error } = await supabase
    .from('descriptor_mappings')
    .select('*')
    .eq('household_id', householdId)
    .order('statement_text', { ascending: true });
  return toResult((data ?? []) as DescriptorMapping[], error);
}

export async function listAuditLog(
  householdId: string,
  limit = 50,
): Promise<QueryResult<AuditLogEntry[]>> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return toResult((data ?? []) as AuditLogEntry[], error);
}

/* ==========================================================================
 * Screen-level reads (one per screen). These resolve the signed-in user's
 * household themselves, so screens call them with just a month/year.
 * `month` is always a 'YYYY-MM-01' first-of-month key. Months are created
 * on demand by ensureMonth when the user moves to a new month.
 * ========================================================================== */

/**
 * Get the months row for a household + month key, creating it (empty split
 * percentages) when the user moves to a month with no row yet. Never throws
 * on the unique-race: a conflict re-reads the row another client created.
 */
export async function ensureMonth(
  householdId: string,
  month: string,
): Promise<QueryResult<Month>> {
  const existing = await getMonth(householdId, month);
  if (existing.data || existing.error) return existing;
  const { data, error } = await supabase
    .from('months')
    .insert({ household_id: householdId, month })
    .select('*')
    .single();
  if (!error) return toResult((data ?? null) as Month | null, null);
  // Another client may have created the row first — re-read instead of failing.
  return getMonth(householdId, month);
}

/** Resolve the current household id, or return the shared "no household" error result. */
async function currentHousehold(): Promise<{ householdId: string | null; error: string | null }> {
  const householdId = await getMyHouseholdId();
  if (!householdId) return { householdId: null, error: 'No household found for this user.' };
  return { householdId, error: null };
}

async function monthIdFor(
  householdId: string,
  month: string,
): Promise<{ monthRow: Month | null; error: string | null }> {
  const { data, error } = await getMonth(householdId, month);
  return { monthRow: data, error };
}

export interface DashboardData {
  monthKey: string;
  month: Month | null;
  labels: Label[];
  projections: Projection[];
  /** v_monthly_actuals: actuals grouped by category + section. */
  actuals: MonthlyActual[];
  transactions: Transaction[];
  labelBudgets: LabelBudget[];
  pool: SavingsPoolBalance | null;
  fundBalances: SavingsFundBalance[];
}

/** Home — projected vs actual for one month. Reads v_monthly_actuals for actuals. */
export async function fetchDashboard(month: string): Promise<QueryResult<DashboardData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const { monthRow } = await monthIdFor(householdId, month);
  const [labels, projections, actuals, transactions, labelBudgets, pool, fundBalances] =
    await Promise.all([
      listLabels(householdId),
      monthRow ? listProjections(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<Projection[]>),
      monthRow ? listMonthlyActuals(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<MonthlyActual[]>),
      monthRow ? listTransactions(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<Transaction[]>),
      monthRow ? listLabelBudgets(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<LabelBudget[]>),
      getSavingsPoolBalance(householdId),
      listSavingsFundBalances(householdId),
    ]);
  const firstError =
    labels.error ?? projections.error ?? actuals.error ?? transactions.error ??
    labelBudgets.error ?? pool.error ?? fundBalances.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      monthKey: month,
      month: monthRow,
      labels: labels.data ?? [],
      projections: projections.data ?? [],
      actuals: actuals.data ?? [],
      transactions: transactions.data ?? [],
      labelBudgets: labelBudgets.data ?? [],
      pool: pool.data,
      fundBalances: fundBalances.data ?? [],
    },
    error: null,
  };
}

export interface ActivityData {
  monthKey: string;
  month: Month | null;
  transactions: Transaction[];
  openItems: OpenItem[];
  labels: Label[];
  accounts: Account[];
}

/** Activity — the month's transaction log plus open items. */
export async function fetchActivity(month: string): Promise<QueryResult<ActivityData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const { monthRow } = await monthIdFor(householdId, month);
  const [transactions, openItems, labels, accounts] = await Promise.all([
    monthRow ? listTransactions(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<Transaction[]>),
    listOpenItems(householdId),
    listLabels(householdId),
    listAccounts(householdId),
  ]);
  const firstError = transactions.error ?? openItems.error ?? labels.error ?? accounts.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      monthKey: month,
      month: monthRow,
      transactions: transactions.data ?? [],
      openItems: openItems.data ?? [],
      labels: labels.data ?? [],
      accounts: accounts.data ?? [],
    },
    error: null,
  };
}

/** Labels screen — the full Chart of Accounts (active + retired; screens filter for pickers). */
export async function fetchLabels(): Promise<QueryResult<Label[]>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  return listLabels(householdId);
}

/** Accounts screen — all accounts (active + inactive; pickers use active ones). */
export async function fetchAccounts(): Promise<QueryResult<Account[]>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  return listAccounts(householdId);
}

/** Accounts screen — statement descriptor mappings. */
export async function fetchDescriptorMappings(): Promise<QueryResult<DescriptorMapping[]>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  return listDescriptorMappings(householdId);
}

export interface PlanData {
  monthKey: string;
  month: Month | null;
  projections: Projection[];
  labelBudgets: LabelBudget[];
  labels: Label[];
  /** Month transactions, for spent-so-far per label. */
  transactions: Transaction[];
  actuals: MonthlyActual[];
}

/** Plan — the single source the dashboard reads from (projections, split %, label budgets). */
export async function fetchPlan(month: string): Promise<QueryResult<PlanData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const { monthRow } = await monthIdFor(householdId, month);
  const [projections, labelBudgets, labels, transactions, actuals] = await Promise.all([
    monthRow ? listProjections(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<Projection[]>),
    monthRow ? listLabelBudgets(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<LabelBudget[]>),
    listLabels(householdId),
    monthRow ? listTransactions(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<Transaction[]>),
    monthRow ? listMonthlyActuals(householdId, monthRow.id) : Promise.resolve({ data: [], error: null } as QueryResult<MonthlyActual[]>),
  ]);
  const firstError =
    projections.error ?? labelBudgets.error ?? labels.error ?? transactions.error ?? actuals.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      monthKey: month,
      month: monthRow,
      projections: projections.data ?? [],
      labelBudgets: labelBudgets.data ?? [],
      labels: labels.data ?? [],
      transactions: transactions.data ?? [],
      actuals: actuals.data ?? [],
    },
    error: null,
  };
}

export interface SavingsData {
  funds: SavingsFund[];
  fundBalances: SavingsFundBalance[];
  /** Derived pool balance (v_savings_pool_balance) — never a stored number. */
  pool: SavingsPoolBalance | null;
  movements: SavingsFundMovement[];
  month: Month | null;
}

/** Savings — buckets, their derived balances, the derived pool, and movement history. */
export async function fetchSavings(month?: string): Promise<QueryResult<SavingsData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const monthKey = month ?? null;
  const [funds, fundBalances, pool, movements, monthRow] = await Promise.all([
    listSavingsFunds(householdId),
    listSavingsFundBalances(householdId),
    getSavingsPoolBalance(householdId),
    listSavingsMovements(householdId),
    monthKey ? getMonth(householdId, monthKey) : Promise.resolve({ data: null, error: null } as QueryResult<Month>),
  ]);
  const firstError = funds.error ?? fundBalances.error ?? pool.error ?? movements.error ?? monthRow.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      funds: funds.data ?? [],
      fundBalances: fundBalances.data ?? [],
      pool: pool.data,
      movements: movements.data ?? [],
      month: monthRow.data,
    },
    error: null,
  };
}

export interface YearData {
  year: number;
  months: Month[];
  transactions: Transaction[];
  projections: Projection[];
  labelBudgets: LabelBudget[];
  goals: YearlyGoal[];
  preferences: HouseholdPreferences | null;
  pool: SavingsPoolBalance | null;
  fundBalances: SavingsFundBalance[];
}

/** Year — yearly overview: all months with data, annualization inputs, goals, pool + buckets. */
export async function fetchYear(year: number): Promise<QueryResult<YearData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const { data: months, error: monthsError } = await supabase
    .from('months')
    .select('*')
    .eq('household_id', householdId)
    .gte('month', start)
    .lt('month', end)
    .order('month', { ascending: true });
  if (monthsError) return { data: null, error: monthsError.message };
  const monthRows = (months ?? []) as Month[];
  const monthIds = monthRows.map((m) => m.id);
  const [transactions, projections, labelBudgets, goals, preferences, pool, fundBalances] =
    await Promise.all([
      monthIds.length
        ? supabase.from('transactions').select('*, label:labels(*), account:accounts(*)').eq('household_id', householdId).in('month_id', monthIds).order('txn_date', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      monthIds.length
        ? supabase.from('projections').select('*').in('month_id', monthIds).order('category', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      monthIds.length
        ? supabase.from('label_budgets').select('*').eq('household_id', householdId).in('month_id', monthIds)
        : Promise.resolve({ data: [], error: null }),
      listYearlyGoals(householdId, year),
      getHouseholdPreferences(householdId),
      getSavingsPoolBalance(householdId),
      listSavingsFundBalances(householdId),
    ]);
  const firstError =
    transactions.error?.message ?? projections.error?.message ?? labelBudgets.error?.message ??
    goals.error ?? preferences.error ?? pool.error ?? fundBalances.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      year,
      months: monthRows,
      transactions: ((transactions.data ?? []) as Transaction[]),
      projections: ((projections.data ?? []) as Projection[]),
      labelBudgets: ((labelBudgets.data ?? []) as LabelBudget[]),
      goals: goals.data ?? [],
      preferences: preferences.data,
      pool: pool.data,
      fundBalances: fundBalances.data ?? [],
    },
    error: null,
  };
}

export interface SettingsData {
  household: Household | null;
  preferences: HouseholdPreferences | null;
  members: HouseholdMember[];
  labels: Label[];
  accounts: Account[];
  descriptorMappings: DescriptorMapping[];
  auditLog: AuditLogEntry[];
}

/** Settings — preferences, household members, reference data, recent agent activity. */
export async function fetchSettings(): Promise<QueryResult<SettingsData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const [household, preferences, members, labels, accounts, descriptorMappings, auditLog] =
    await Promise.all([
      getHousehold(householdId),
      getHouseholdPreferences(householdId),
      listHouseholdMembers(householdId),
      listLabels(householdId),
      listAccounts(householdId),
      listDescriptorMappings(householdId),
      listAuditLog(householdId, 50),
    ]);
  const firstError =
    household.error ?? preferences.error ?? members.error ?? labels.error ??
    accounts.error ?? descriptorMappings.error ?? auditLog.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      household: household.data,
      preferences: preferences.data,
      members: members.data ?? [],
      labels: labels.data ?? [],
      accounts: accounts.data ?? [],
      descriptorMappings: descriptorMappings.data ?? [],
      auditLog: auditLog.data ?? [],
    },
    error: null,
  };
}

/** One reimbursement-log row plus the linked (negative) transaction, if it still exists. */
export interface ReimbursementLogViewEntry extends ReimbursementLogEntry {
  transaction: Transaction | null;
}

/**
 * Reimbursement Log — negative entries on Expense labels at gross (positive)
 * amounts, with payer / offset / expense. Source of truth is transactions
 * with kind 'reimbursement' (their `reimbursement_log` row carries the
 * gross amount, paid_by, source/link and status). Refunds (kind 'refund')
 * and income-label negatives (kind 'repayment') are excluded by
 * construction: only kind 'reimbursement' is ever read here. A
 * reimbursement transaction with no log row yet still appears, as an
 * 'open' entry with the gross amount derived from the transaction.
 */
export async function fetchReimbursementLog(
  month: string,
): Promise<QueryResult<ReimbursementLogViewEntry[]>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const { monthRow } = await monthIdFor(householdId, month);
  if (!monthRow) return { data: [], error: null };
  const [logRows, reimbursements] = await Promise.all([
    supabase
      .from('reimbursement_log')
      .select('*')
      .eq('household_id', householdId)
      .eq('month_id', monthRow.id)
      .order('date_received', { ascending: false }),
    supabase
      .from('transactions')
      .select('*, label:labels(*), account:accounts(*)')
      .eq('household_id', householdId)
      .eq('month_id', monthRow.id)
      .eq('kind', 'reimbursement')
      .order('txn_date', { ascending: false }),
  ]);
  if (logRows.error) return { data: null, error: logRows.error.message };
  if (reimbursements.error) return { data: null, error: reimbursements.error.message };
  const entries = (logRows.data ?? []) as ReimbursementLogEntry[];
  const txns = (reimbursements.data ?? []) as Transaction[];
  const byTxnId = new Map(txns.map((t) => [t.id, t]));
  const seenTxnIds = new Set<string>();
  const result: ReimbursementLogViewEntry[] = entries.map((entry) => {
    const txn = entry.reimbursement_transaction_id
      ? (byTxnId.get(entry.reimbursement_transaction_id) ?? null)
      : null;
    if (txn) seenTxnIds.add(txn.id);
    return { ...entry, transaction: txn };
  });
  // Reimbursement transactions with no log row: surface them as open entries.
  for (const txn of txns) {
    if (seenTxnIds.has(txn.id)) continue;
    result.push({
      id: `txn-${txn.id}`,
      household_id: householdId,
      month_id: monthRow.id,
      date_received: txn.txn_date,
      description: txn.description,
      paid_by: null,
      gross_amount_cents: Math.abs(txn.amount_cents),
      offsets_label_id: txn.label_id,
      offsets_transaction_id: txn.offsets_transaction_id,
      reimbursement_transaction_id: txn.id,
      source_link: null,
      status: 'open',
      notes: null,
      created_at: txn.created_at,
      transaction: txn,
    });
  }
  result.sort((a, b) => (a.date_received < b.date_received ? 1 : -1));
  return { data: result, error: null };
}

export type ReportKind =
  | 'month-review'
  | 'year-review'
  | 'where-money-went'
  | 'goals-on-track'
  | 'biggest-leaks';

export interface ReportData {
  kind: ReportKind;
  monthKey: string | null;
  year: number | null;
  /** Ready-to-send prompt for the connected AI agent (no personal data baked in). */
  prompt: string;
  /** Data sources the report draws on, for display next to the prompt. */
  sources: string[];
  labels: Label[];
  projections: Projection[];
  actuals: MonthlyActual[];
  labelBudgets: LabelBudget[];
  transactions: Transaction[];
  goals: YearlyGoal[];
  fundBalances: SavingsFundBalance[];
  pool: SavingsPoolBalance | null;
}

const REPORT_PROMPTS: Record<ReportKind, { title: string; prompt: string; sources: string[] }> = {
  'month-review': {
    title: 'Month in review',
    prompt:
      'Review this month for my household budget: compare projected vs actual income per source and spending per label against the plan, flag labels over plan, and summarize savings (pool + buckets) and anything notable.',
    sources: ['Projections (planned income)', 'Transactions this month', 'Per-label budgets', 'Savings pool + bucket balances'],
  },
  'year-review': {
    title: 'Year in review',
    prompt:
      'Review this year for my household budget: total income vs plan, spending by category and label, savings progress against yearly goals, and the biggest trends across the months with data.',
    sources: ['All months this year', 'Projections', 'Transactions', 'Yearly goals', 'Savings pool + bucket balances'],
  },
  'where-money-went': {
    title: 'Where the money went',
    prompt:
      'Break down where the money went this month: spending by Needs vs Wants vs Savings, the top labels by spend, and which labels are over their planned amounts.',
    sources: ['Transactions this month', 'Per-label budgets', 'Label Needs/Wants mapping'],
  },
  'goals-on-track': {
    title: 'Am I on track for my goals?',
    prompt:
      'Check my yearly goals: progress toward each target, whether the linked savings bucket (if any) is on pace, and what would need to change to hit the targets by year end.',
    sources: ['Yearly goals', 'Savings bucket balances', 'Year-to-date income and spending'],
  },
  'biggest-leaks': {
    title: 'Biggest leaks',
    prompt:
      'Find my biggest leaks this month: labels most over plan, recurring Wants spending ahead of pace, and repeated pulls out of savings buckets. Suggest concrete fixes.',
    sources: ['Transactions this month', 'Per-label budgets', 'Savings bucket movements'],
  },
};

/**
 * Reports — the AI is the analyst (spec §2.6). Returns the prompt + the live
 * data slices the agent needs. The report itself is generated in the
 * conversation, not in the app. Call `logReportPrompt` when the user taps
 * Ask/Copy so the prompt lands in the AI audit log.
 */
export async function fetchReportData(
  kind: ReportKind,
  opts?: { month?: string; year?: number },
): Promise<QueryResult<ReportData>> {
  const { householdId, error: householdError } = await currentHousehold();
  if (!householdId) return { data: null, error: householdError };
  const spec = REPORT_PROMPTS[kind];
  const monthKey = opts?.month ?? null;
  const year = opts?.year ?? (monthKey ? Number(monthKey.slice(0, 4)) : new Date().getFullYear());
  const base = monthKey
    ? await fetchPlan(monthKey)
    : { data: null as PlanData | null, error: null as string | null };
  if (base.error) return { data: null, error: base.error };
  const yearData =
    kind === 'year-review' || kind === 'goals-on-track'
      ? await fetchYear(year)
      : { data: null as YearData | null, error: null as string | null };
  if (yearData.error) return { data: null, error: yearData.error };
  const [labels, goals, fundBalances, pool] = await Promise.all([
    listLabels(householdId),
    listYearlyGoals(householdId, year),
    listSavingsFundBalances(householdId),
    getSavingsPoolBalance(householdId),
  ]);
  const firstError = labels.error ?? goals.error ?? fundBalances.error ?? pool.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data: {
      kind,
      monthKey,
      year,
      prompt: spec.prompt,
      sources: spec.sources,
      labels: labels.data ?? [],
      projections: yearData.data?.projections ?? base.data?.projections ?? [],
      actuals: base.data?.actuals ?? [],
      labelBudgets: yearData.data?.labelBudgets ?? base.data?.labelBudgets ?? [],
      transactions: yearData.data?.transactions ?? base.data?.transactions ?? [],
      goals: yearData.data?.goals ?? goals.data ?? [],
      fundBalances: fundBalances.data ?? [],
      pool: pool.data,
    },
    error: null,
  };
}

/** Log a report prompt use to the AI audit log (spec §2.6). Best-effort: returns the audit error, if any. */
export async function logReportPrompt(
  kind: ReportKind,
  opts?: { month?: string; year?: number },
): Promise<string | null> {
  return logAudit('report_prompt', 'audit_log', null, {
    report: kind,
    month: opts?.month ?? null,
    year: opts?.year ?? null,
    title: REPORT_PROMPTS[kind].title,
  });
}

/* ==========================================================================
 * Re-exports — the screens import the whole data layer from './queries',
 * so the plan/audit mutations live here too (implementations in plan.ts
 * and audit.ts; no logic is duplicated here).
 * ========================================================================== */

export { logAudit } from './audit';
export {
  deleteProjection,
  deleteYearlyGoal,
  insertLabelBudget,
  saveHouseholdPreferences,
  updateLabelBudget,
  updateMonthSplit,
  upsertLabelBudget,
  upsertProjection,
  upsertYearlyGoal,
} from './plan';
