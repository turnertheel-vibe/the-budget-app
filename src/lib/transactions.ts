/**
 * Transaction kind derivation (spec §2.4, schema v3 D7).
 *
 * The user sees ONE +/− toggle and never picks a negative type. The app
 * derives `transactions.kind` on save:
 * - negative on an Expense label + note starting REIMB → 'reimbursement'
 *   (also writes a reimbursement_log row at the gross amount; refunds excluded)
 * - negative on an Expense label + note starting REFUND → 'refund'
 * - negative on an Income label → 'repayment' (reduces income)
 * - negative on an Expense label otherwise → plain negative correction.
 *   NOTE: the v3 DB check only allows 'standard' | 'reimbursement' |
 *   'refund' | 'repayment', so a plain correction has NO dedicated kind in
 *   v3 — callers must not invent one. See deriveNegativeKind below.
 * - positive → 'standard'.
 *
 * The DB enforces the sign per kind: standard rows are > 0, the negative
 * kinds are < 0. A negative amount is stored negative; the label's spending
 * nets against it everywhere else.
 */
import type { LabelSection, TransactionKind } from './types';

export function isNegativeKind(kind: TransactionKind): boolean {
  return kind === 'reimbursement' || kind === 'refund' || kind === 'repayment';
}

/**
 * Derive the kind for a negative entry from the label's section and the note.
 * Returns null for a plain negative correction on an Expense label with no
 * REIMB/REFUND marker — v3 has no kind for that case, so the screens agent
 * must decide the UX (e.g. require a REIMB/REFUND note, or store it as a
 * positive offset). Do not silently map it to 'reimbursement'.
 */
export function deriveNegativeKind(
  section: LabelSection,
  note: string,
): TransactionKind | null {
  const trimmed = note.trim().toUpperCase();
  if (section === 'Income') return 'repayment';
  if (section === 'Expense') {
    if (trimmed.startsWith('REIMB')) return 'reimbursement';
    if (trimmed.startsWith('REFUND')) return 'refund';
    return null;
  }
  return null;
}

/** Full derivation for a save: positive → standard; negative → derived kind (may be null). */
export function deriveTransactionKind(
  section: LabelSection,
  amountCents: number,
  note: string,
): TransactionKind | null {
  if (amountCents >= 0) return 'standard';
  return deriveNegativeKind(section, note);
}

/* ==========================================================================
 * Mutations — insert / update / delete (spec §2.4, schema v3 D7).
 *
 * Every write is followed by an audit_log row. Amounts are integer cents;
 * ISO dates. Never logs credit card payments (a transfer, not spending —
 * rejected here when the description says so; the Add screen must not
 * offer a credit-card-payment label). Never touches receipts.storage_path
 * (dropped in v3): only receipt_ref, a filename/link reference, never a
 * file. There is no server-side function yet (spec §4): a bucket-paid
 * expense / reimbursement is sequential inserts from the client, and a
 * failure mid-sequence best-effort rolls back the rows already written.
 * Pool/bucket balances are derived views, so removing or adjusting a
 * movement settles them automatically — there is no balance column to fix.
 * ========================================================================== */

import { supabase } from './supabase';
import { getCurrentUserId, resolveHouseholdId } from './auth';
import { logAudit } from './audit';
import { ensureMonth, type QueryResult } from './queries';
import { getFundBalanceCents, spendFromBucketForTransaction } from './savings';
import type { Label, Transaction, TransactionSource } from './types';

export interface InsertTransactionInput {
  householdId?: string | null;
  /** First-of-month key, e.g. '2026-11-01'. The month row is created on demand. */
  month?: string;
  /** Month row id (from getMonth) — alternative to `month`; when given, used directly. */
  month_id?: string;
  description: string;
  merchant?: string | null;
  /** ISO date 'YYYY-MM-DD'. (Either this or `txn_date` is required.) */
  txnDate?: string;
  /** Signed integer cents. (Either this or `amount_cents` is required.) */
  amountCents?: number;
  /** (Either this or `label_id` is required.) */
  labelId?: string;
  accountId?: string | null;
  source?: TransactionSource;
  /** Receipt filename/link reference only — never a file (v3 D8). */
  receiptRef?: string | null;
  /** Alias for receiptRef (screens pass the receipt filename under this name). */
  receipt_filename?: string | null;
  offsetsTransactionId?: string | null;
  /** Who paid, for the reimbursement log. */
  paidBy?: string | null;
  sourceLink?: string | null;
  /** Pay from this savings bucket (Expense entries only). */
  fundId?: string | null;
  /**
   * Pre-derived kind (screens derive it with deriveTransactionKind first).
   * When omitted, the kind is derived here. When given, it must agree with
   * the amount's sign (standard > 0, negative kinds < 0).
   */
  kind?: TransactionKind;
  /* Snake_case aliases for the DB column names (screens pass these). */
  household_id?: string | null;
  txn_date?: string;
  amount_cents?: number;
  label_id?: string;
  account_id?: string | null;
  receipt_ref?: string | null;
  offsets_transaction_id?: string | null;
  paid_by?: string | null;
  source_link?: string | null;
  fund_id?: string | null;
}

export interface UpdateTransactionPatch {
  description?: string;
  merchant?: string | null;
  txnDate?: string;
  amountCents?: number;
  labelId?: string;
  accountId?: string | null;
  receiptRef?: string | null;
  offsetsTransactionId?: string | null;
  paidBy?: string | null;
  sourceLink?: string | null;
  /** undefined = leave the bucket link unchanged; null = remove it; id = (re)link it. */
  fundId?: string | null;
  /* Snake_case aliases for the DB column names (screens pass these). */
  txn_date?: string;
  amount_cents?: number;
  label_id?: string;
  account_id?: string | null;
  receipt_ref?: string | null;
  offsets_transaction_id?: string | null;
  paid_by?: string | null;
  source_link?: string | null;
  fund_id?: string | null;
}

function txErr<T>(message: string): QueryResult<T> {
  return { data: null, error: message };
}

/** Credit card payments are transfers, not spending — they are never logged (schema v2 rules). */
function isCreditCardPayment(description: string): boolean {
  return /credit\s*card\s*payment/i.test(description);
}

async function fetchLabel(householdId: string, labelId: string): Promise<Label | null> {
  const { data } = await supabase
    .from('labels')
    .select('*')
    .eq('household_id', householdId)
    .eq('id', labelId)
    .maybeSingle();
  return (data ?? null) as Label | null;
}

async function fetchTransactionWithJoins(id: string): Promise<Transaction | null> {
  const { data } = await supabase
    .from('transactions')
    .select('*, label:labels(*), account:accounts(*)')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as Transaction | null;
}

/**
 * Resolve the kind for a save, applying the documented auto-prefix rule:
 * a negative on an Expense label with no REIMB/REFUND marker is stored as
 * a reimbursement with "REIMB " prepended to the description.
 * ASSUMPTION — flagged for Turner to confirm: the v3 check has no kind for
 * a plain negative correction, so the app must not write one. If Turner
 * wants plain negative corrections, the schema needs a kind for them.
 */
function resolveKindAndDescription(
  section: LabelSection,
  amountCents: number,
  description: string,
): { kind: TransactionKind; description: string } {
  if (amountCents > 0) return { kind: 'standard', description };
  const derived = deriveNegativeKind(section, description);
  if (derived) return { kind: derived, description };
  // Expense negative, no marker → auto-prefix REIMB (see note above).
  return { kind: 'reimbursement', description: `REIMB ${description}` };
}

async function writeReimbursementLogRow(input: {
  householdId: string;
  monthId: string;
  txn: Transaction;
  paidBy: string | null;
  sourceLink: string | null;
}): Promise<string | null> {
  const { error } = await supabase.from('reimbursement_log').insert({
    household_id: input.householdId,
    month_id: input.monthId,
    date_received: input.txn.txn_date,
    description: input.txn.description,
    paid_by: input.paidBy,
    gross_amount_cents: Math.abs(input.txn.amount_cents),
    offsets_label_id: input.txn.label_id,
    offsets_transaction_id: input.txn.offsets_transaction_id,
    reimbursement_transaction_id: input.txn.id,
    source_link: input.sourceLink,
    status: input.txn.offsets_transaction_id ? 'resolved' : 'open',
    notes: null,
  });
  return error ? error.message : null;
}

/**
 * Insert a transaction. Derives the kind app-side, enforces the v3 sign
 * rules, writes the reimbursement_log row for reimbursements and the
 * linked savings_fund_movements row when paying from a bucket (one
 * transaction+movement pair; the expense still counts in its label's
 * Needs/Wants category because the transaction row itself carries the
 * label). Writes an audit_log row.
 */
export async function insertTransaction(
  rawInput: InsertTransactionInput,
): Promise<QueryResult<Transaction>> {
  // Normalize: accept both camelCase and snake_case (DB column) keys.
  const input = {
    householdId: rawInput.householdId ?? rawInput.household_id ?? null,
    month: rawInput.month ?? null,
    monthId: rawInput.month_id ?? null,
    description: rawInput.description,
    merchant: rawInput.merchant ?? null,
    txnDate: rawInput.txnDate ?? rawInput.txn_date ?? '',
    amountCents: rawInput.amountCents ?? rawInput.amount_cents ?? 0,
    labelId: rawInput.labelId ?? rawInput.label_id ?? '',
    accountId: rawInput.accountId ?? rawInput.account_id ?? null,
    source: rawInput.source ?? 'manual',
    receiptRef: rawInput.receiptRef ?? rawInput.receipt_ref ?? rawInput.receipt_filename ?? null,
    offsetsTransactionId:
      rawInput.offsetsTransactionId ?? rawInput.offsets_transaction_id ?? null,
    paidBy: rawInput.paidBy ?? rawInput.paid_by ?? null,
    sourceLink: rawInput.sourceLink ?? rawInput.source_link ?? null,
    fundId: rawInput.fundId ?? rawInput.fund_id ?? null,
    kind: rawInput.kind ?? null,
  };
  const description = input.description.trim();
  if (!description) return txErr('Description is required.');
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    return txErr('Amount must be a non-zero whole number of cents.');
  }
  if (isCreditCardPayment(description)) {
    return txErr('Credit card payments are never logged — they are transfers, not spending.');
  }
  const resolved = await resolveHouseholdId(input.householdId ?? null);
  if (!resolved.householdId) return txErr(resolved.error ?? 'No household found.');
  const householdId = resolved.householdId;

  const label = await fetchLabel(householdId, input.labelId);
  if (!label) return txErr('Label not found.');
  if (!label.is_active) return txErr('That label is retired. Pick an active label.');
  if (input.fundId && label.section !== 'Expense') {
    return txErr('Pay-from-savings is only for Expense entries.');
  }
  if (input.accountId) {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('household_id', householdId)
      .eq('id', input.accountId)
      .maybeSingle();
    if (!account) return txErr('Account not found.');
  }

  const derived = resolveKindAndDescription(label.section, input.amountCents, description);
  // A caller-supplied kind (screens derive it first) wins, but must agree with the sign.
  const kind = input.kind ?? derived.kind;
  const finalDescription = input.kind ? description : derived.description;
  if (input.kind) {
    const signOk = (kind === 'standard') === (input.amountCents > 0);
    if (!signOk) return txErr(`Kind '${kind}' does not match the amount's sign.`);
  }

  // Month: a month row id wins when given; otherwise create/ensure the row by month key.
  let monthRowId: string;
  if (input.monthId) {
    const { data: monthRow } = await supabase
      .from('months')
      .select('id')
      .eq('household_id', householdId)
      .eq('id', input.monthId)
      .maybeSingle();
    if (!monthRow) return txErr('Month not found.');
    monthRowId = (monthRow as { id: string }).id;
  } else {
    if (!input.month) return txErr('A month ("YYYY-MM-01" key) or month_id is required.');
    const monthResult = await ensureMonth(householdId, input.month);
    if (!monthResult.data) return txErr(monthResult.error ?? 'Could not create the month row.');
    monthRowId = monthResult.data.id;
  }

  // Receipt reference only (v3 D8): a receipts row holding the filename/link, never a file.
  let receiptId: string | null = null;
  if (input.receiptRef?.trim()) {
    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .insert({
        household_id: householdId,
        filename: input.receiptRef.trim(),
        receipt_ref: input.receiptRef.trim(),
        receipt_date: input.txnDate,
        vendor: input.merchant?.trim() || null,
        message_id: null,
      })
      .select('id')
      .single();
    if (receiptError) return txErr(receiptError.message);
    receiptId = (receipt as { id: string }).id;
  }

  const actorId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      household_id: householdId,
      month_id: monthRowId,
      description: finalDescription,
      merchant: input.merchant?.trim() || null,
      txn_date: input.txnDate,
      amount_cents: input.amountCents,
      kind,
      label_id: input.labelId,
      account_id: input.accountId ?? null,
      source: input.source ?? 'manual',
      receipt_id: receiptId,
      offsets_transaction_id: input.offsetsTransactionId ?? null,
      created_by: actorId,
    })
    .select('*')
    .single();
  if (error) return txErr(error.message);
  const txn = (data ?? null) as Transaction | null;
  if (!txn) return txErr('Transaction insert returned no row.');

  // Reimbursement → gross-amount log row (refunds excluded by kind).
  if (kind === 'reimbursement') {
    const logError = await writeReimbursementLogRow({
      householdId,
      monthId: monthRowId,
      txn,
      paidBy: input.paidBy?.trim() || null,
      sourceLink: input.sourceLink?.trim() || null,
    });
    if (logError) {
      await supabase.from('transactions').delete().eq('id', txn.id);
      return txErr(`Transaction rolled back: reimbursement log write failed (${logError}).`);
    }
  }

  // Bucket-paid expense → one linked movement (spend counts once, under its label's category).
  if (input.fundId) {
    const movement = await spendFromBucketForTransaction(
      householdId,
      input.fundId,
      input.amountCents,
      txn.id,
    );
    if (!movement.data) {
      await supabase.from('reimbursement_log').delete().eq('reimbursement_transaction_id', txn.id);
      await supabase.from('transactions').delete().eq('id', txn.id);
      return txErr(`Transaction rolled back: bucket spend failed (${movement.error ?? 'unknown error'}).`);
    }
  }

  await logAudit('insert', 'transactions', txn.id, {
    kind,
    amount_cents: input.amountCents,
    label_id: input.labelId,
    txn_date: input.txnDate,
    fund_id: input.fundId ?? null,
  }, householdId);
  const full = await fetchTransactionWithJoins(txn.id);
  return { data: full ?? txn, error: null };
}

/**
 * Update a transaction. Re-derives the kind when amount/label/description
 * change, settles the linked bucket movement by the difference (or removes
 * / re-links it when fundId is patched), and keeps the reimbursement log
 * in step with the kind. Writes an audit_log row.
 */
export async function updateTransaction(
  id: string,
  rawPatch: UpdateTransactionPatch,
): Promise<QueryResult<Transaction>> {
  // Normalize: accept both camelCase and snake_case (DB column) keys.
  // fundId presence matters (undefined = unchanged), so detect it explicitly.
  const patch = {
    description: rawPatch.description,
    merchant: rawPatch.merchant,
    txnDate: rawPatch.txnDate ?? rawPatch.txn_date,
    amountCents: rawPatch.amountCents ?? rawPatch.amount_cents,
    labelId: rawPatch.labelId ?? rawPatch.label_id,
    accountId: rawPatch.accountId ?? rawPatch.account_id,
    receiptRef: rawPatch.receiptRef ?? rawPatch.receipt_ref,
    offsetsTransactionId: rawPatch.offsetsTransactionId ?? rawPatch.offsets_transaction_id,
    paidBy: rawPatch.paidBy ?? rawPatch.paid_by,
    sourceLink: rawPatch.sourceLink ?? rawPatch.source_link,
    fundId:
      'fundId' in rawPatch
        ? rawPatch.fundId
        : 'fund_id' in rawPatch
          ? rawPatch.fund_id
          : undefined,
  };
  const existing = await fetchTransactionWithJoins(id);
  if (!existing) return txErr('Transaction not found.');
  const householdId = existing.household_id;

  const newDescription = (patch.description ?? existing.description).trim();
  if (!newDescription) return txErr('Description is required.');
  const newAmount = patch.amountCents ?? existing.amount_cents;
  if (!Number.isInteger(newAmount) || newAmount === 0) {
    return txErr('Amount must be a non-zero whole number of cents.');
  }
  if (isCreditCardPayment(newDescription)) {
    return txErr('Credit card payments are never logged — they are transfers, not spending.');
  }
  const newLabelId = patch.labelId ?? existing.label_id;
  const label = await fetchLabel(householdId, newLabelId);
  if (!label) return txErr('Label not found.');
  const { kind: newKind, description: finalDescription } = resolveKindAndDescription(
    label.section,
    newAmount,
    newDescription,
  );
  if (patch.fundId && label.section !== 'Expense') {
    return txErr('Pay-from-savings is only for Expense entries.');
  }

  const updates: Record<string, unknown> = {
    description: finalDescription,
    amount_cents: newAmount,
    kind: newKind,
    label_id: newLabelId,
  };
  if (patch.merchant !== undefined) updates.merchant = patch.merchant?.trim() || null;
  if (patch.txnDate !== undefined) updates.txn_date = patch.txnDate;
  if (patch.accountId !== undefined) updates.account_id = patch.accountId;
  if (patch.offsetsTransactionId !== undefined) {
    updates.offsets_transaction_id = patch.offsetsTransactionId;
  }
  if (patch.receiptRef !== undefined) {
    // A new receipt ref replaces the link (receipts hold references only, never files).
    if (patch.receiptRef?.trim()) {
      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .insert({
          household_id: householdId,
          filename: patch.receiptRef.trim(),
          receipt_ref: patch.receiptRef.trim(),
          receipt_date: patch.txnDate ?? existing.txn_date,
          vendor: (patch.merchant ?? existing.merchant)?.trim() || null,
          message_id: null,
        })
        .select('id')
        .single();
      if (receiptError) return txErr(receiptError.message);
      updates.receipt_id = (receipt as { id: string }).id;
    } else {
      updates.receipt_id = null;
    }
  }

  const { error } = await supabase.from('transactions').update(updates).eq('id', id);
  if (error) return txErr(error.message);

  // Keep the reimbursement log in step with the kind.
  if (existing.kind === 'reimbursement' && newKind !== 'reimbursement') {
    await supabase.from('reimbursement_log').delete().eq('reimbursement_transaction_id', id);
  } else if (newKind === 'reimbursement') {
    const updated = (await fetchTransactionWithJoins(id)) ?? existing;
    const { data: logRows } = await supabase
      .from('reimbursement_log')
      .select('id')
      .eq('reimbursement_transaction_id', id)
      .limit(1);
    if ((logRows as { id: string }[] | null)?.length) {
      await supabase
        .from('reimbursement_log')
        .update({
          date_received: updated.txn_date,
          description: updated.description,
          gross_amount_cents: Math.abs(updated.amount_cents),
          offsets_label_id: updated.label_id,
          offsets_transaction_id: updated.offsets_transaction_id,
          paid_by: patch.paidBy?.trim() || undefined,
          source_link: patch.sourceLink?.trim() || undefined,
        })
        .eq('reimbursement_transaction_id', id);
    } else {
      await writeReimbursementLogRow({
        householdId,
        monthId: updated.month_id,
        txn: updated,
        paidBy: patch.paidBy?.trim() || null,
        sourceLink: patch.sourceLink?.trim() || null,
      });
    }
  }

  // Settle the linked bucket movement by the difference.
  const { data: movements } = await supabase
    .from('savings_fund_movements')
    .select('id, fund_id')
    .eq('household_id', householdId)
    .eq('transaction_id', id);
  const linked = (movements ?? []) as { id: string; fund_id: string }[];
  if (patch.fundId !== undefined) {
    // Explicit re-link: remove old movements, add the new one if asked.
    for (const m of linked) {
      await supabase.from('savings_fund_movements').delete().eq('id', m.id);
    }
    if (patch.fundId && newAmount > 0) {
      const movement = await spendFromBucketForTransaction(householdId, patch.fundId, newAmount, id);
      if (!movement.data) return txErr(`Bucket spend failed (${movement.error ?? 'unknown error'}). Old movement was removed; re-link the bucket.`);
    }
  } else if (linked.length > 0) {
    // Amount/label changed with the link untouched: adjust by the difference, or drop it.
    if (newAmount > 0 && label.section === 'Expense') {
      const balance = linked[0] ? await getFundBalanceCents(linked[0].fund_id) : 0;
      // The old movement (-old amount) is still counted in the balance; the new
      // movement must fit the balance plus the amount the old movement returns.
      const available = balance + Math.abs(existing.amount_cents);
      if (newAmount > available) {
        return txErr(`Not enough in this bucket (${newAmount} requested, ${available} available).`);
      }
      await supabase
        .from('savings_fund_movements')
        .update({ amount_cents: -newAmount })
        .eq('id', linked[0].id);
    } else {
      for (const m of linked) {
        await supabase.from('savings_fund_movements').delete().eq('id', m.id);
      }
    }
  }

  await logAudit('update', 'transactions', id, {
    kind: newKind,
    amount_cents: newAmount,
    label_id: newLabelId,
    previous: { kind: existing.kind, amount_cents: existing.amount_cents, label_id: existing.label_id },
  }, householdId);
  const full = await fetchTransactionWithJoins(id);
  return { data: full ?? existing, error: null };
}

/**
 * Delete a transaction. Removes/refunds its linked bucket movement first
 * (derived balances settle automatically), removes its reimbursement log
 * row, clears it as an offset on other log rows, then deletes the row.
 * Writes an audit_log row.
 */
export async function deleteTransaction(id: string): Promise<QueryResult<{ id: string }>> {
  const existing = await fetchTransactionWithJoins(id);
  if (!existing) return txErr('Transaction not found.');
  const householdId = existing.household_id;

  const { error: movementError } = await supabase
    .from('savings_fund_movements')
    .delete()
    .eq('household_id', householdId)
    .eq('transaction_id', id);
  if (movementError) return txErr(movementError.message);

  const { error: logDeleteError } = await supabase
    .from('reimbursement_log')
    .delete()
    .eq('household_id', householdId)
    .eq('reimbursement_transaction_id', id);
  if (logDeleteError) return txErr(logDeleteError.message);

  // Other log rows that offset this transaction lose their link (they stay, as 'open').
  await supabase
    .from('reimbursement_log')
    .update({ offsets_transaction_id: null, status: 'open' })
    .eq('household_id', householdId)
    .eq('offsets_transaction_id', id);

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('household_id', householdId)
    .eq('id', id);
  if (error) return txErr(error.message);

  await logAudit('delete', 'transactions', id, {
    kind: existing.kind,
    amount_cents: existing.amount_cents,
    label_id: existing.label_id,
    txn_date: existing.txn_date,
    description: existing.description,
  }, householdId);
  return { data: { id }, error: null };
}
