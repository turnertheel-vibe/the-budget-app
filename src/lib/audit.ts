/**
 * Audit log — every app-side write lands here (spec §4, schema v2/v3).
 *
 * Writes to `audit_log` (columns: household_id, actor_id, action,
 * table_name, row_id, details). The v3 `audit_log_insert` policy allows
 * household members to insert rows for their own household. Reads are
 * covered by `listAuditLog` in queries.ts.
 *
 * Failures to write an audit row never fail the caller's operation — the
 * audit write is best-effort and its error is returned so the caller can
 * surface it, but the data write itself has already happened.
 */
import { supabase } from './supabase';
import { getCurrentUserId, resolveHouseholdId } from './auth';

export type AuditAction = 'insert' | 'update' | 'delete' | 'report_prompt';

/**
 * Write one audit row. `details` is free-form JSON (what changed, old/new
 * values, reason). Returns an error string when the audit write itself
 * failed, null on success.
 */
export async function logAudit(
  action: string,
  table: string,
  rowId: string | null,
  details?: Record<string, unknown> | null,
  householdId?: string | null,
): Promise<string | null> {
  const resolved = await resolveHouseholdId(householdId ?? null);
  if (!resolved.householdId) return resolved.error ?? 'No household found for this user.';
  const actorId = await getCurrentUserId();
  const { error } = await supabase.from('audit_log').insert({
    household_id: resolved.householdId,
    actor_id: actorId,
    action,
    table_name: table,
    row_id: rowId,
    details: details ?? null,
  });
  return error ? error.message : null;
}
