/**
 * Reimbursement Log — a view over transactions, not a separate entry point
 * (spec §2.8). Gross reimbursement amounts, for taxes. Refunds and
 * income-label negatives (repayments) never appear here.
 */
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import { formatDate, formatMoney } from '../lib/money';
import { listLabels, listReimbursements } from '../lib/queries';
import { useHousehold } from '../components/useBudget';
import { Card, CardTitle, EmptyState, ErrorText, LoadingView } from '../components/ui';
import type { Label, ReimbursementLogEntry } from '../lib/types';

export function ReimbursementLogScreen() {
  const { tokens } = useTheme();
  const { householdId, currency, dateFormat, loading: hhLoading, error: hhError } = useHousehold();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReimbursementLogEntry[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    const [rRes, lRes] = await Promise.all([listReimbursements(householdId), listLabels(householdId)]);
    if (rRes.error) setError(rRes.error);
    if (lRes.error) setError(lRes.error);
    setEntries(rRes.data ?? []);
    setLabels(lRes.data ?? []);
    setLoading(false);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (hhLoading || loading) return <LoadingView />;
  if (hhError || !householdId) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.bg }]}>
        <ErrorText message={hhError ?? 'No household found.'} />
      </View>
    );
  }

  const total = entries.reduce((s, e) => s + e.gross_amount_cents, 0);
  const labelName = (id: string | null) => labels.find((l) => l.id === id)?.label ?? '—';

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color: tokens.ink }]}>Reimbursement Log</Text>
      <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 4 }}>
        Gross amounts, for taxes. A reimbursement is logged as a negative entry on the label it offsets —
        use the +/− toggle in the Add sheet. Refunds never appear here.
      </Text>
      <ErrorText message={error} />

      <Card>
        <CardTitle title="Total reimbursed" right={formatMoney(total, currency)} />
        {entries.length === 0 ? (
          <EmptyState title="No reimbursements yet" body="When someone pays you back, log it as a negative entry on the label it offsets with a note starting REIMB." />
        ) : (
          entries.map((e) => (
            <View key={e.id} style={[styles.row, { borderTopColor: tokens.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }} numberOfLines={1}>
                  {e.description}
                </Text>
                <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>
                  {formatDate(e.date_received, dateFormat)}
                  {e.paid_by ? ` · Paid by ${e.paid_by}` : ''}
                  {e.offsets_label_id ? ` · Offsets ${labelName(e.offsets_label_id)}` : ''}
                </Text>
                {e.source_link ? (
                  <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
                    Source: {e.source_link}
                  </Text>
                ) : null}
                {e.notes ? (
                  <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }} numberOfLines={2}>
                    {e.notes}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '700' }}>
                  {formatMoney(e.gross_amount_cents, currency)}
                </Text>
                <Text
                  style={{
                    color: e.status === 'resolved' ? tokens.brand : tokens.wants,
                    fontSize: 12,
                    fontWeight: '700',
                    marginTop: 2,
                  }}
                >
                  {e.status === 'resolved' ? 'Resolved' : 'Open'}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  row: { borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
});
