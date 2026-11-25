/**
 * Home — projected vs actual, minimal and visual (spec §2.1).
 * Reads from the Plan (projections + split + transactions); it never stores
 * its own numbers. Bucket-paid expenses count toward their label's
 * Needs/Wants category (see computeMonthSummary).
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../navigation/AppNavigator';
import { useTheme } from '../theme';
import { formatMoney, formatMonth, monthKey } from '../lib/money';
import {
  getMonth,
  listAccounts,
  listLabels,
  listOpenItems,
  listProjections,
  listSavingsMovements,
  listTransactions,
} from '../lib/queries';
import { isSpendMovement } from '../lib/savings';
import {
  computeMonthSummary,
  monthPace,
  shiftMonth,
  useHousehold,
} from '../components/useBudget';
import { Bar, Card, CardTitle, EmptyState, ErrorText, LoadingView, RowButton } from '../components/ui';
import type { Currency, Label, Projection, Transaction } from '../lib/types';

export function HomeScreen() {
  const { tokens, appearance, setAppearance } = useTheme();
  const navigation = useNavigation<RootStackNavigation>();
  const { householdId, currency, loading: hhLoading, error: hhError } = useHousehold();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReturnType<typeof computeMonthSummary> | null>(null);
  const [monthRow, setMonthRow] = useState<{
    projected_needs_pct: number | null;
    projected_wants_pct: number | null;
    projected_savings_pct: number | null;
  } | null>(null);
  const [labelCount, setLabelCount] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [openItemCount, setOpenItemCount] = useState(0);
  const [reimbCount, setReimbCount] = useState(0);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    setError(null);
    const { data: m, error: mErr } = await getMonth(householdId, month);
    if (mErr) {
      setError(mErr);
      setLoading(false);
      return;
    }
    setMonthRow(m);
    const [labelsRes, accountsRes, openRes] = await Promise.all([
      listLabels(householdId),
      listAccounts(householdId),
      listOpenItems(householdId),
    ]);
    const labels: Label[] = labelsRes.data ?? [];
    setLabelCount(labels.filter((l) => l.is_active).length);
    setAccountCount((accountsRes.data ?? []).filter((a) => a.is_active).length);
    setOpenItemCount((openRes.data ?? []).length);

    if (!m) {
      setSummary(null);
      setReimbCount(0);
      setLoading(false);
      return;
    }
    const [txRes, projRes, movRes] = await Promise.all([
      listTransactions(householdId, m.id),
      listProjections(householdId, m.id),
      listSavingsMovements(householdId),
    ]);
    if (txRes.error) setError(txRes.error);
    if (projRes.error) setError(projRes.error);
    const txs: Transaction[] = txRes.data ?? [];
    const projs: Projection[] = projRes.data ?? [];
    const bucketPaid = new Set(
      (movRes.data ?? []).filter(isSpendMovement).map((mv) => mv.transaction_id as string),
    );
    setSummary(computeMonthSummary(txs, labels, projs, bucketPaid));
    setReimbCount(txs.filter((t) => t.kind === 'reimbursement').length);
    setLoading(false);
  }, [householdId, month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (hhLoading || (loading && !summary && !monthRow)) return <LoadingView />;
  if (hhError || !householdId) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.bg }]}>
        <ErrorText message={hhError ?? 'No household found.'} />
      </View>
    );
  }

  const pace = monthPace(month);
  const needsPct = monthRow?.projected_needs_pct ?? 0;
  const wantsPct = monthRow?.projected_wants_pct ?? 0;
  const savingsPct = monthRow?.projected_savings_pct ?? 0;
  const projected = summary?.projectedIncome ?? 0;
  const plannedNeeds = Math.round((projected * needsPct) / 100);
  const plannedWants = Math.round((projected * wantsPct) / 100);
  const plannedSavings = Math.round((projected * savingsPct) / 100);
  const out = summary?.out ?? 0;
  const left = summary?.leftToSpend ?? projected;
  const overPace = projected > 0 && out > projected * pace;
  const status =
    !summary || projected === 0
      ? 'No plan for this month yet'
      : left < 0
        ? 'Over plan — spending is past projected income'
        : overPace
          ? 'Ahead of pace — spending is running ahead of the month'
          : 'On track — spending is inside the plan so far';

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.monthTitle, { color: tokens.ink }]}>{formatMonth(month)}</Text>
          <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 2 }}>
            Projected vs actual — the Plan is the source
          </Text>
        </View>
        <View style={styles.navRow}>
          <Pressable
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}
          >
            <Text style={{ color: tokens.ink, fontSize: 18 }}>‹</Text>
          </Pressable>
          <Pressable
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}
          >
            <Text style={{ color: tokens.ink, fontSize: 18 }}>›</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Toggle appearance"
            onPress={() => setAppearance(appearance === 'dark' ? 'light' : 'dark')}
            style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}
          >
            <Text style={{ color: tokens.ink, fontSize: 15 }}>{appearance === 'dark' ? '☀' : '☾'}</Text>
          </Pressable>
        </View>
      </View>

      <ErrorText message={error} />

      {!monthRow ? (
        <Card>
          <EmptyState
            title="No plan for this month yet"
            body="Add a projected income source on the Plan tab and this dashboard will fill in from it."
          />
        </Card>
      ) : (
        <>
          <View style={[styles.hero, { backgroundColor: tokens.brand }]}>
            <Text style={[styles.heroLabel, { color: tokens.brandInk }]}>Left to spend</Text>
            <Text style={[styles.heroAmount, { color: tokens.brandInk }]}>{formatMoney(left, currency)}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: left < 0 || overPace ? tokens.dangerSoft : '#DCE8C8' }]} />
              <Text style={[styles.statusText, { color: tokens.brandInk }]}>{status}</Text>
            </View>
            <View style={[styles.heroPace, { backgroundColor: 'rgba(255,255,255,0.28)' }]}>
              <View style={{ width: `${pace * 100}%`, height: '100%', backgroundColor: '#FFFFFF', borderRadius: 99 }} />
            </View>
            <Text style={[styles.heroPaceLabel, { color: tokens.brandInk }]}>
              {Math.round(pace * 100)}% through the month
            </Text>
            <View style={styles.miniRow}>
              <View>
                <Text style={[styles.miniLabel, { color: tokens.brandInk }]}>Projected</Text>
                <Text style={[styles.miniVal, { color: tokens.brandInk }]}>{formatMoney(projected, currency)}</Text>
              </View>
              <View>
                <Text style={[styles.miniLabel, { color: tokens.brandInk }]}>In</Text>
                <Text style={[styles.miniVal, { color: tokens.brandInk }]}>
                  {formatMoney(summary?.incomeActual ?? 0, currency)}
                </Text>
              </View>
              <View>
                <Text style={[styles.miniLabel, { color: tokens.brandInk }]}>Out</Text>
                <Text style={[styles.miniVal, { color: tokens.brandInk }]}>{formatMoney(out, currency)}</Text>
              </View>
            </View>
          </View>

          <Card>
            <CardTitle
              title="Income"
              right={`${formatMoney(summary?.incomeActual ?? 0, currency)} of ${formatMoney(projected, currency)}`}
            />
            <Bar
              fill={projected > 0 ? (summary?.incomeActual ?? 0) / projected : 0}
              color={tokens.brand}
              pace={pace}
            />
            {(summary?.perSource ?? []).map((s) => (
              <View key={s.name} style={styles.srcRow}>
                <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={{ color: tokens.ink2, fontSize: 13, fontWeight: '600' }}>
                  {formatMoney(s.actual, currency)} / {formatMoney(s.projected, currency)}
                </Text>
              </View>
            ))}
            {(summary?.perSource ?? []).length === 0 ? (
              <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 8 }}>
                No income sources yet — add one on the Plan tab.
              </Text>
            ) : null}
          </Card>

          <Card>
            <CardTitle title="Spending" right={`${formatMoney(out, currency)} out`} />
            <SpendingRow label="Needs" actual={summary?.needsActual ?? 0} planned={plannedNeeds} color={tokens.needs} currency={currency} pace={pace} />
            <SpendingRow label="Wants" actual={summary?.wantsActual ?? 0} planned={plannedWants} color={tokens.wants} currency={currency} pace={pace} />
            <SpendingRow label="Savings" actual={summary?.savingsActual ?? 0} planned={plannedSavings} color={tokens.savings} currency={currency} pace={pace} />
            <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
              Bucket-paid expenses count toward their label&apos;s Needs / Wants category.
            </Text>
          </Card>
        </>
      )}

      <Card>
        <CardTitle title="Jump in" />
        <RowButton title="Labels" subtitle={`${labelCount} active labels`} onPress={() => navigation.navigate('Labels')} />
        <RowButton title="Accounts" subtitle={`${accountCount} active accounts`} onPress={() => navigation.navigate('Accounts')} />
        {openItemCount > 0 ? (
          <RowButton
            title="Open Items"
            subtitle={`${openItemCount} charge${openItemCount === 1 ? '' : 's'} waiting on a receipt — see the Activity tab`}
          />
        ) : null}
        <RowButton
          title="Reimbursement Log"
          subtitle={
            reimbCount > 0
              ? `${reimbCount} reimbursement${reimbCount === 1 ? '' : 's'} this month · gross amounts, for taxes`
              : 'Gross amounts, for taxes'
          }
          onPress={() => navigation.navigate('ReimbursementLog')}
        />
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function SpendingRow({
  label,
  actual,
  planned,
  color,
  currency,
  pace,
}: {
  label: string;
  actual: number;
  planned: number;
  color: string;
  currency: Currency;
  pace: number;
}) {
  const { tokens } = useTheme();
  const over = planned > 0 && actual > planned;
  return (
    <View style={{ marginTop: 12 }}>
      <View style={styles.srcRow}>
        <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: over ? tokens.danger : tokens.ink2, fontSize: 13, fontWeight: '600' }}>
          {formatMoney(actual, currency)} of {formatMoney(planned, currency)}
          {over ? ' · over plan' : ''}
        </Text>
      </View>
      <Bar fill={planned > 0 ? actual / planned : 0} color={over ? tokens.danger : color} pace={pace} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  dot: { borderRadius: 5, height: 10, width: 10 },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  hero: { borderRadius: 20, marginTop: 14, padding: 18 },
  heroAmount: { fontSize: 38, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  heroLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroPace: { borderRadius: 99, height: 8, marginTop: 14, overflow: 'hidden' },
  heroPaceLabel: { fontSize: 12, fontWeight: '600', marginTop: 6, opacity: 0.85 },
  miniLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, opacity: 0.8, textTransform: 'uppercase' },
  miniRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  miniVal: { fontSize: 15, fontWeight: '700', marginTop: 3 },
  monthTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  navBtn: { alignItems: 'center', borderRadius: 10, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  navRow: { flexDirection: 'row', gap: 6 },
  srcRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  statusText: { fontSize: 13.5, fontWeight: '600' },
});
