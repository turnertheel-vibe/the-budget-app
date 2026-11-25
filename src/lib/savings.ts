/**
 * Savings — one unallocated pool, buckets filled only from it (spec §2.5,
 * schema v3 D1/D2).
 *
 * Balances are DERIVED, never stored: the pool is `v_savings_pool_balance`
 * (Savings-section transactions minus all fund movements) and a bucket
 * balance is the sum of its movements (`v_savings_fund_balances`). Every
 * function here validates against those views before writing, so a move
 * can never overdraw the pool or a bucket.
 *
 * Movement signs: positive = into the bucket, negative = out of it.
 * - allocate pool → bucket: 'allocation', +cents, reason null (v3 D2).
 * - release bucket → pool: 'withdrawal', −cents, reason REQUIRED.
 * - spend from a bucket: 'withdrawal', −cents, linked to the transaction
 *   that spent it (reason null — the linked transaction IS the record of
 *   why the money left; the D2 reason rule covers user-initiated releases,
 *   not linked spends). There is no 'spend' movement_type in the v2/v3
 *   check constraint, so spends are stored as withdrawals with a
 *   transaction_id; `isSpendMovement` tells them apart for display.
 * - No direct bucket-to-bucket moves: route through the pool
 *   (`moveBetweenBuckets` = release + allocate).
 */
import { supabase } from './supabase';
import { resolveHouseholdId } from './auth';
import { logAudit } from './audit';
import type { QueryResult } from './queries';
import type { SavingsFund, SavingsFundMovement } from './types';

function err<T>(message: string): QueryResult<T> {
  return { data: null, error: message };
}

function validateCents(cents: number): string | null {
  if (!Number.isInteger(cents)) return 'Amount must be a whole number of cents.';
  if (cents <= 0) return 'Amount must be greater than zero.';
  return null;
}

/** Current pool balance in cents for a household (0 when the view has no row yet). */
export async function getPoolBalanceCents(householdId: string): Promise<number> {
  const { data } = await supabase
    .from('v_savings_pool_balance')
    .select('pool_cents')
    .eq('household_id', householdId)
    .maybeSingle();
  const row = data as { pool_cents: number | null } | null;
  return row?.pool_cents ?? 0;
}

/** Current balance of one bucket in cents (0 when the view has no row — e.g. never moved). */
export async function getFundBalanceCents(fundId: string): Promise<number> {
  const { data } = await supabase
    .from('v_savings_fund_balances')
    .select('balance_cents')
    .eq('fund_id', fundId)
    .maybeSingle();
  const row = data as { balance_cents: number | null } | null;
  return row?.balance_cents ?? 0;
}

/** A movement is a bucket-paid spend when it is linked to a transaction. Never fabricate a reason for it. */
export function isSpendMovement(movement: SavingsFundMovement): boolean {
  return movement.transaction_id !== null && movement.transaction_id !== undefined;
}

async function insertMovement(
  householdId: string,
  fundId: string,
  movementType: 'allocation' | 'withdrawal',
  amountCents: number,
  reason: string | null,
  transactionId: string | null,
): Promise<QueryResult<SavingsFundMovement>> {
  const { data, error } = await supabase
    .from('savings_fund_movements')
    .insert({
      household_id: householdId,
      fund_id: fundId,
      movement_type: movementType,
      amount_cents: amountCents,
      reason,
      transaction_id: transactionId,
    })
    .select('*')
    .single();
  return { data: (data ?? null) as SavingsFundMovement | null, error: error ? error.message : null };
}

async function getActiveFund(
  householdId: string,
  fundId: string,
): Promise<{ fund: SavingsFund | null; error: string | null }> {
  const { data, error } = await supabase
    .from('savings_funds')
    .select('*')
    .eq('household_id', householdId)
    .eq('id', fundId)
    .maybeSingle();
  if (error) return { fund: null, error: error.message };
  const fund = (data ?? null) as SavingsFund | null;
  if (!fund) return { fund: null, error: 'Savings bucket not found.' };
  if (!fund.is_active) return { fund: null, error: 'Savings bucket is deactivated.' };
  return { fund, error: null };
}

/**
 * Move money from the unallocated pool into a bucket. No reason is stored
 * on allocations (v3 D2). Fails when the pool does not hold enough.
 */
export async function allocateToBucket(
  fundId: string,
  cents: number,
  _reason?: string | null,
  householdId?: string | null,
): Promise<QueryResult<SavingsFundMovement>> {
  const centsError = validateCents(cents);
  if (centsError) return err(centsError);
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return err(resolved.error ?? 'No household found.');
  const { error: fundError } = await getActiveFund(resolved.householdId, fundId);
  if (fundError) return err(fundError);
  const pool = await getPoolBalanceCents(resolved.householdId);
  if (cents > pool) {
    return err(`Not enough in the unallocated pool (${cents} requested, ${pool} available).`);
  }
  // NOTE: reason is intentionally NOT stored on allocations (v3 D2: null on allocations).
  const result = await insertMovement(resolved.householdId, fundId, 'allocation', cents, null, null);
  if (result.data) {
    await logAudit('insert', 'savings_fund_movements', result.data.id, {
      fund_id: fundId,
      movement_type: 'allocation',
      amount_cents: cents,
    }, resolved.householdId);
  }
  return result;
}

/**
 * Move money out of a bucket back to the unallocated pool. `reason` is
 * REQUIRED — empty/missing reason is rejected before anything is written
 * (v3 D2). Fails when the bucket does not hold enough.
 */
export async function releaseFromBucket(
  fundId: string,
  cents: number,
  reason: string,
  householdId?: string | null,
): Promise<QueryResult<SavingsFundMovement>> {
  const centsError = validateCents(cents);
  if (centsError) return err(centsError);
  if (!reason || !reason.trim()) {
    return err('A reason is required when money leaves a bucket.');
  }
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return err(resolved.error ?? 'No household found.');
  const { error: fundError } = await getActiveFund(resolved.householdId, fundId);
  if (fundError) return err(fundError);
  const balance = await getFundBalanceCents(fundId);
  if (cents > balance) {
    return err(`Not enough in this bucket (${cents} requested, ${balance} available).`);
  }
  const result = await insertMovement(
    resolved.householdId,
    fundId,
    'withdrawal',
    -cents,
    reason.trim(),
    null,
  );
  if (result.data) {
    await logAudit('insert', 'savings_fund_movements', result.data.id, {
      fund_id: fundId,
      movement_type: 'withdrawal',
      amount_cents: -cents,
      reason: reason.trim(),
    }, resolved.householdId);
  }
  return result;
}

/**
 * Spend from a bucket without a linked transaction (e.g. from bucket
 * detail). For a spend tied to an expense row, use insertTransaction with
 * `fundId` instead — that writes the one transaction+movement pair so the
 * spend still counts toward its label's Needs/Wants category. Fails when
 * the bucket does not hold enough.
 */
export async function spendFromBucket(
  fundId: string,
  cents: number,
  householdId?: string | null,
): Promise<QueryResult<SavingsFundMovement>> {
  const centsError = validateCents(cents);
  if (centsError) return err(centsError);
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return err(resolved.error ?? 'No household found.');
  const { error: fundError } = await getActiveFund(resolved.householdId, fundId);
  if (fundError) return err(fundError);
  const balance = await getFundBalanceCents(fundId);
  if (cents > balance) {
    return err(`Not enough in this bucket (${cents} requested, ${balance} available).`);
  }
  const result = await insertMovement(resolved.householdId, fundId, 'withdrawal', -cents, null, null);
  if (result.data) {
    await logAudit('insert', 'savings_fund_movements', result.data.id, {
      fund_id: fundId,
      movement_type: 'withdrawal',
      amount_cents: -cents,
      spend: true,
    }, resolved.householdId);
  }
  return result;
}

/**
 * Write the movement half of a bucket-paid expense (called by
 * insertTransaction after the transaction row exists). Internal helper
 * exported for the transactions module: same balance check as
 * spendFromBucket, but linked to the transaction.
 */
export async function spendFromBucketForTransaction(
  householdId: string,
  fundId: string,
  cents: number,
  transactionId: string,
): Promise<QueryResult<SavingsFundMovement>> {
  const centsError = validateCents(cents);
  if (centsError) return err(centsError);
  const { error: fundError } = await getActiveFund(householdId, fundId);
  if (fundError) return err(fundError);
  const balance = await getFundBalanceCents(fundId);
  if (cents > balance) {
    return err(`Not enough in this bucket (${cents} requested, ${balance} available).`);
  }
  const result = await insertMovement(householdId, fundId, 'withdrawal', -cents, null, transactionId);
  if (result.data) {
    await logAudit('insert', 'savings_fund_movements', result.data.id, {
      fund_id: fundId,
      movement_type: 'withdrawal',
      amount_cents: -cents,
      transaction_id: transactionId,
    }, householdId);
  }
  return result;
}

/**
 * Move money from one bucket to another. There is no direct bucket-to-
 * bucket move: this releases to the pool (reason required) and then
 * allocates from the pool, so the pool is the only path between buckets.
 * If the allocate step fails, the release has already landed in the pool
 * and the error says so — the money is not lost, it is unallocated.
 */
export async function moveBetweenBuckets(
  fromFundId: string,
  toFundId: string,
  cents: number,
  reason: string,
  householdId?: string | null,
): Promise<QueryResult<{ released: SavingsFundMovement; allocated: SavingsFundMovement }>> {
  if (fromFundId === toFundId) return err('Source and destination buckets must be different.');
  const released = await releaseFromBucket(fromFundId, cents, reason, householdId ?? null);
  if (!released.data) return err(released.error ?? 'Release from bucket failed.');
  const allocated = await allocateToBucket(toFundId, cents, null, householdId ?? null);
  if (!allocated.data) {
    return {
      data: null,
      error: `Released ${cents} from the source bucket to the pool, but the allocate step failed (${allocated.error ?? 'unknown error'}). The money is in the unallocated pool.`,
    };
  }
  return { data: { released: released.data, allocated: allocated.data }, error: null };
}

/* --- Bucket (savings fund) management: add / rename / deactivate, like labels. --- */

export async function insertSavingsFund(
  name: string,
  targetPct?: number | null,
  householdId?: string | null,
): Promise<QueryResult<SavingsFund>> {
  const trimmed = name.trim();
  if (!trimmed) return err('Bucket name is required.');
  if (targetPct !== undefined && targetPct !== null && (targetPct < 0 || targetPct > 100)) {
    return err('Target percentage must be between 0 and 100.');
  }
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return err(resolved.error ?? 'No household found.');
  const { data: existing } = await supabase
    .from('savings_funds')
    .select('id')
    .eq('household_id', resolved.householdId)
    .ilike('name', trimmed)
    .limit(1);
  if ((existing as { id: string }[] | null)?.length) {
    return err(`A bucket named "${trimmed}" already exists.`);
  }
  const { data, error } = await supabase
    .from('savings_funds')
    .insert({ household_id: resolved.householdId, name: trimmed, target_pct: targetPct ?? null })
    .select('*')
    .single();
  if (error) return err(error.message);
  const fund = (data ?? null) as SavingsFund | null;
  if (fund) {
    await logAudit('insert', 'savings_funds', fund.id, { name: trimmed }, resolved.householdId);
  }
  return { data: fund, error: null };
}

export async function renameSavingsFund(
  fundId: string,
  name: string,
  householdId?: string | null,
): Promise<QueryResult<SavingsFund>> {
  const trimmed = name.trim();
  if (!trimmed) return err('Bucket name is required.');
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return err(resolved.error ?? 'No household found.');
  const { data: existing } = await supabase
    .from('savings_funds')
    .select('id')
    .eq('household_id', resolved.householdId)
    .ilike('name', trimmed)
    .neq('id', fundId)
    .limit(1);
  if ((existing as { id: string }[] | null)?.length) {
    return err(`A bucket named "${trimmed}" already exists.`);
  }
  const { data, error } = await supabase
    .from('savings_funds')
    .update({ name: trimmed })
    .eq('household_id', resolved.householdId)
    .eq('id', fundId)
    .select('*')
    .single();
  if (error) return err(error.message);
  const fund = (data ?? null) as SavingsFund | null;
  if (fund) {
    await logAudit('update', 'savings_funds', fund.id, { name: trimmed }, resolved.householdId);
  }
  return { data: fund, error: null };
}

/** Deactivate a bucket (never hard-delete — movement history must keep resolving). */
export async function deactivateSavingsFund(
  fundId: string,
  householdId?: string | null,
): Promise<QueryResult<SavingsFund>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return err(resolved.error ?? 'No household found.');
  const { data, error } = await supabase
    .from('savings_funds')
    .update({ is_active: false })
    .eq('household_id', resolved.householdId)
    .eq('id', fundId)
    .select('*')
    .single();
  if (error) return err(error.message);
  const fund = (data ?? null) as SavingsFund | null;
  if (fund) {
    await logAudit('update', 'savings_funds', fund.id, { is_active: false }, resolved.householdId);
  }
  return { data: fund, error: null };
}
