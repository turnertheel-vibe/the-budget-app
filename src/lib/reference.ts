/**
 * Reference data — Chart of Accounts (labels), accounts, descriptor
 * mappings (spec §2.7/§2.8, schema v2/v3).
 *
 * Rules: labels are retired, never hard-deleted (history must keep
 * resolving); accounts are deactivated, never hard-deleted (transactions
 * reference them, and past rows must keep showing the name); descriptor
 * mappings are hard-deleted (they carry no history). All writes check
 * duplicates first and write an audit_log row.
 */
import { supabase } from './supabase';
import { resolveHouseholdId } from './auth';
import { logAudit } from './audit';
import type { QueryResult } from './queries';
import type {
  Account,
  AccountType,
  DescriptorMapping,
  Label,
  LabelSection,
  NeedsWants,
} from './types';

function refErr<T>(message: string): QueryResult<T> {
  return { data: null, error: message };
}

async function duplicateExists(
  table: string,
  householdId: string,
  column: string,
  value: string,
  excludeId?: string,
): Promise<boolean> {
  let query = supabase
    .from(table)
    .select('id')
    .eq('household_id', householdId)
    .ilike(column, value)
    .limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data } = await query;
  return ((data as { id: string }[] | null)?.length ?? 0) > 0;
}

/* --- Labels --- */

export interface InsertLabelInput {
  label: string;
  category: string;
  section: LabelSection;
  /** Expense labels only; default 'Wants' (v3 D3). Ignored (stored null) for other sections. */
  needsWants?: NeedsWants | null;
  householdId?: string | null;
}

export async function insertLabel(input: InsertLabelInput): Promise<QueryResult<Label>> {
  const name = input.label.trim();
  if (!name) return refErr('Label name is required.');
  if (!input.category.trim()) return refErr('Category is required.');
  const resolved = await resolveHouseholdId(input.householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  if (await duplicateExists('labels', resolved.householdId, 'label', name)) {
    return refErr(`A label named "${name}" already exists.`);
  }
  const needsWants =
    input.section === 'Expense' ? (input.needsWants ?? 'Wants') : null;
  const { data, error } = await supabase
    .from('labels')
    .insert({
      household_id: resolved.householdId,
      label: name,
      category: input.category.trim(),
      section: input.section,
      needs_wants: needsWants,
    })
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const label = (data ?? null) as Label | null;
  if (label) {
    await logAudit('insert', 'labels', label.id, { label: name, section: input.section }, resolved.householdId);
  }
  return { data: label, error: null };
}

export async function renameLabel(
  labelId: string,
  newName: string,
  householdId?: string | null,
): Promise<QueryResult<Label>> {
  const name = newName.trim();
  if (!name) return refErr('Label name is required.');
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  if (await duplicateExists('labels', resolved.householdId, 'label', name, labelId)) {
    return refErr(`A label named "${name}" already exists.`);
  }
  const { data, error } = await supabase
    .from('labels')
    .update({ label: name })
    .eq('household_id', resolved.householdId)
    .eq('id', labelId)
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const label = (data ?? null) as Label | null;
  if (label) {
    await logAudit('update', 'labels', label.id, { label: name }, resolved.householdId);
  }
  return { data: label, error: null };
}

/** Retire a label: deactivate only — rows already logged against it keep resolving. */
export async function retireLabel(
  labelId: string,
  householdId?: string | null,
): Promise<QueryResult<Label>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  const { data, error } = await supabase
    .from('labels')
    .update({ is_active: false })
    .eq('household_id', resolved.householdId)
    .eq('id', labelId)
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const label = (data ?? null) as Label | null;
  if (label) {
    await logAudit('update', 'labels', label.id, { is_active: false }, resolved.householdId);
  }
  return { data: label, error: null };
}

/* --- Accounts --- */

export interface InsertAccountInput {
  name: string;
  lastFour?: string | null;
  accountType: AccountType;
  cardGroup?: string | null;
  notes?: string | null;
  householdId?: string | null;
}

export async function insertAccount(input: InsertAccountInput): Promise<QueryResult<Account>> {
  const name = input.name.trim();
  if (!name) return refErr('Account name is required.');
  const resolved = await resolveHouseholdId(input.householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  if (await duplicateExists('accounts', resolved.householdId, 'name', name)) {
    return refErr(`An account named "${name}" already exists.`);
  }
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      household_id: resolved.householdId,
      name,
      last_four: input.lastFour?.trim() || null,
      account_type: input.accountType,
      card_group: input.cardGroup?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const account = (data ?? null) as Account | null;
  if (account) {
    await logAudit('insert', 'accounts', account.id, { name }, resolved.householdId);
  }
  return { data: account, error: null };
}

export interface UpdateAccountPatch {
  name?: string;
  lastFour?: string | null;
  accountType?: AccountType;
  cardGroup?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export async function updateAccount(
  accountId: string,
  patch: UpdateAccountPatch,
  householdId?: string | null,
): Promise<QueryResult<Account>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return refErr('Account name is required.');
    if (await duplicateExists('accounts', resolved.householdId, 'name', name, accountId)) {
      return refErr(`An account named "${name}" already exists.`);
    }
  }
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name.trim();
  if (patch.lastFour !== undefined) updates.last_four = patch.lastFour?.trim() || null;
  if (patch.accountType !== undefined) updates.account_type = patch.accountType;
  if (patch.cardGroup !== undefined) updates.card_group = patch.cardGroup?.trim() || null;
  if (patch.notes !== undefined) updates.notes = patch.notes?.trim() || null;
  if (patch.isActive !== undefined) updates.is_active = patch.isActive;
  const { data, error } = await supabase
    .from('accounts')
    .update(updates)
    .eq('household_id', resolved.householdId)
    .eq('id', accountId)
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const account = (data ?? null) as Account | null;
  if (account) {
    await logAudit('update', 'accounts', account.id, updates, resolved.householdId);
  }
  return { data: account, error: null };
}

/**
 * Delete an account. Blocked when it is the last active account.
 * Implemented as deactivation, not a hard delete: transactions reference
 * accounts (FK), so a hard delete would fail on any account with history
 * and would erase the name from past rows. Deactivated accounts disappear
 * from pickers; past transactions keep showing the name.
 */
export async function deleteAccount(
  accountId: string,
  householdId?: string | null,
): Promise<QueryResult<Account>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  const { data: active, error: countError } = await supabase
    .from('accounts')
    .select('id')
    .eq('household_id', resolved.householdId)
    .eq('is_active', true);
  if (countError) return refErr(countError.message);
  if (((active as { id: string }[] | null)?.length ?? 0) <= 1) {
    return refErr('Cannot delete the last account — the household needs at least one.');
  }
  const { data, error } = await supabase
    .from('accounts')
    .update({ is_active: false })
    .eq('household_id', resolved.householdId)
    .eq('id', accountId)
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const account = (data ?? null) as Account | null;
  if (account) {
    await logAudit('delete', 'accounts', account.id, { name: account.name, deactivated: true }, resolved.householdId);
  }
  return { data: account, error: null };
}

/* --- Descriptor mappings --- */

export async function insertDescriptorMapping(
  statementText: string,
  resolvesTo: string,
  householdId?: string | null,
): Promise<QueryResult<DescriptorMapping>> {
  const text = statementText.trim();
  const resolvedName = resolvesTo.trim();
  if (!text) return refErr('Statement text is required.');
  if (!resolvedName) return refErr('Resolved name is required.');
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  if (await duplicateExists('descriptor_mappings', resolved.householdId, 'statement_text', text)) {
    return refErr(`A mapping for "${text}" already exists.`);
  }
  const { data, error } = await supabase
    .from('descriptor_mappings')
    .insert({ household_id: resolved.householdId, statement_text: text, resolved_name: resolvedName })
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const mapping = (data ?? null) as DescriptorMapping | null;
  if (mapping) {
    await logAudit('insert', 'descriptor_mappings', mapping.id, { statement_text: text }, resolved.householdId);
  }
  return { data: mapping, error: null };
}

export async function updateDescriptorMapping(
  mappingId: string,
  patch: { statementText?: string; resolvesTo?: string },
  householdId?: string | null,
): Promise<QueryResult<DescriptorMapping>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  const updates: Record<string, unknown> = {};
  if (patch.statementText !== undefined) {
    const text = patch.statementText.trim();
    if (!text) return refErr('Statement text is required.');
    if (await duplicateExists('descriptor_mappings', resolved.householdId, 'statement_text', text, mappingId)) {
      return refErr(`A mapping for "${text}" already exists.`);
    }
    updates.statement_text = text;
  }
  if (patch.resolvesTo !== undefined) {
    const resolvedName = patch.resolvesTo.trim();
    if (!resolvedName) return refErr('Resolved name is required.');
    updates.resolved_name = resolvedName;
  }
  const { data, error } = await supabase
    .from('descriptor_mappings')
    .update(updates)
    .eq('household_id', resolved.householdId)
    .eq('id', mappingId)
    .select('*')
    .single();
  if (error) return refErr(error.message);
  const mapping = (data ?? null) as DescriptorMapping | null;
  if (mapping) {
    await logAudit('update', 'descriptor_mappings', mapping.id, updates, resolved.householdId);
  }
  return { data: mapping, error: null };
}

export async function deleteDescriptorMapping(
  mappingId: string,
  householdId?: string | null,
): Promise<QueryResult<{ id: string }>> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return refErr(resolved.error ?? 'No household found.');
  const { error } = await supabase
    .from('descriptor_mappings')
    .delete()
    .eq('household_id', resolved.householdId)
    .eq('id', mappingId);
  if (error) return refErr(error.message);
  await logAudit('delete', 'descriptor_mappings', mappingId, {}, resolved.householdId);
  return { data: { id: mappingId }, error: null };
}
