/**
 * Database row types — mirrors schema v2 + v3 (no generated types yet;
 * keep these in sync with goals/budget-app/files/schema-v2.sql and
 * schema-v3.sql). Money is integer cents; dates are ISO strings; ids are UUID strings.
 */

export type LabelSection = 'Expense' | 'Income' | 'Savings' | 'Rewards';
export type NeedsWants = 'Needs' | 'Wants';
export type TransactionKind = 'standard' | 'reimbursement' | 'refund' | 'repayment';
export type TransactionSource = 'manual' | 'receipt' | 'invoice' | 'bank_import' | 'venmo';
export type AccountType = 'credit' | 'debit';
export type HouseholdRole = 'owner' | 'member';
/**
 * Movement types stored in the DB (v2 check: 'allocation' | 'withdrawal' |
 * 'adjustment'). A bucket-paid spend is stored as a 'withdrawal' whose
 * `transaction_id` points at the linked transaction — that link, not a
 * separate kind, is what marks it as a spend. See `isSpendMovement` in
 * src/lib/savings.ts.
 */
export type MovementType = 'allocation' | 'withdrawal' | 'adjustment';
export type DateFormat = 'mdy' | 'dmy' | 'slash' | 'iso';
export type Currency = 'USD' | 'EUR' | 'GBP';
export type JanuaryReminderTiming = 'Jan 1' | 'first weekend' | 'Jan 15';

export interface Household {
  id: string;
  name: string;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface HouseholdMember {
  // No `id` column: the table's key is household_id + user_id.
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  created_at: string;
  profile?: Profile | null;
}

export interface Month {
  id: string;
  household_id: string;
  /** First day of the month, e.g. '2026-11-01'. */
  month: string;
  projected_wants_pct: number | null;
  projected_needs_pct: number | null;
  projected_savings_pct: number | null;
  created_at: string;
}

export interface Label {
  id: string;
  household_id: string;
  label: string;
  category: string;
  section: LabelSection;
  /** Needs/Wants; null for Income, Savings and Rewards labels (v3 D3). */
  needs_wants: NeedsWants | null;
  is_active: boolean;
  created_at: string;
}

export interface Account {
  id: string;
  household_id: string;
  name: string;
  last_four: string | null;
  account_type: AccountType;
  card_group: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Receipt {
  id: string;
  household_id: string;
  filename: string;
  /** Reference to the receipt in the user's own storage — never a file stored by the app (v3 D8). */
  receipt_ref: string | null;
  receipt_date: string | null;
  vendor: string | null;
  message_id: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  household_id: string;
  month_id: string;
  description: string;
  merchant: string | null;
  txn_date: string;
  /** Integer cents. Positive = standard; negative only for reimbursement/refund/repayment kinds (v3 D7). */
  amount_cents: number;
  kind: TransactionKind;
  label_id: string;
  account_id: string | null;
  source: TransactionSource;
  receipt_id: string | null;
  offsets_transaction_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  label?: Label | null;
  account?: Account | null;
}

export interface ReimbursementLogEntry {
  id: string;
  household_id: string;
  month_id: string | null;
  date_received: string;
  description: string;
  paid_by: string | null;
  gross_amount_cents: number;
  offsets_label_id: string | null;
  offsets_transaction_id: string | null;
  reimbursement_transaction_id: string | null;
  source_link: string | null;
  status: 'resolved' | 'open';
  notes: string | null;
  created_at: string;
}

export interface OpenItem {
  id: string;
  household_id: string;
  description: string;
  amount_cents: number | null;
  item_date: string | null;
  source: string | null;
  status: 'open' | 'resolved';
  resolution_notes: string | null;
  created_at: string;
}

export interface Projection {
  id: string;
  month_id: string;
  /** Per-label projection key (e.g. an income source name), not a category name. */
  category: string;
  section: 'Expense' | 'Income' | 'Savings';
  projected_cents: number;
  created_at: string;
}

export interface DescriptorMapping {
  id: string;
  household_id: string;
  statement_text: string;
  /** v2 column name is `resolved_name` (what the statement text resolves to). */
  resolved_name: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  household_id: string;
  /** v2 column name is `actor_id` (references profiles.id). */
  actor_id: string | null;
  action: string;
  /** v2 column name is `table_name`. */
  table_name: string | null;
  /** v2 column name is `row_id`. */
  row_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface SavingsFund {
  id: string;
  household_id: string;
  name: string;
  /** v2 column is `target_pct` (share of the savings pool, percent) — there is no target_cents column on savings_funds. */
  target_pct: number | null;
  is_active: boolean;
  created_at: string;
}

export interface SavingsFundMovement {
  id: string;
  household_id: string;
  fund_id: string;
  movement_type: MovementType;
  amount_cents: number;
  /** Why money left the bucket — required on withdrawals, null on allocations (v3 D2). */
  reason: string | null;
  transaction_id: string | null;
  created_at: string;
}

export interface LabelBudget {
  id: string;
  household_id: string;
  month_id: string;
  label_id: string;
  planned_cents: number;
  created_at: string;
}

export interface YearlyGoal {
  id: string;
  household_id: string;
  year: number;
  goal: string;
  target_cents: number | null;
  fund_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface HouseholdPreferences {
  household_id: string;
  default_account_id: string | null;
  currency: Currency;
  date_format: DateFormat;
  january_reminder_timing: JanuaryReminderTiming | null;
}

/** Derived view: unallocated savings pool, per household (v3 D1). Never a stored number. */
export interface SavingsPoolBalance {
  household_id: string;
  pool_cents: number;
}

/** Derived view: bucket balance = sum of its movements (v2 view also returns name/target_pct). */
export interface SavingsFundBalance {
  household_id: string;
  fund_id: string;
  name: string;
  target_pct: number | null;
  balance_cents: number;
}

/** Derived view: actuals per month, grouped by label category + section (v2 view has no per-label rows). */
export interface MonthlyActual {
  household_id: string;
  month_id: string;
  category: string;
  section: string;
  entry_count: number;
  actual_cents: number;
}
