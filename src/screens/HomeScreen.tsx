/**
 * Home — projected vs actual, minimal and visual (spec §2.1).
 * Reads from the Plan (projections + split + transactions); it never stores
 * its own numbers. Bucket-paid expenses count toward their label's
 * Needs/Wants category (see computeMonthSummary).
 * The Spending card is a compact Needs/Wants/Savings summary. The Breakdown
 * card shows earning, spending and saving per category, like the spreadsheet
 * Dashboard: Income by source, Expenses by label category, Savings by fund.
 * Rows with a plan show a progress bar (actual inside, planned to its right);
 * rows without one show just the amount.
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../navigation/AppNavigator';
import { useTheme } from '../theme';
import { formatMoney, formatMonth, monthKey } from '../lib/money';
import {
  getMonth,
  listAccounts,
  listLabels,
  listLabelBudgets,
  listOpenItems,
  listProjections,
  listSavingsMovements,
  listTransactions,
} from '../lib/queries';
import { isSpendMovement } from '../lib/savings';
import {
  computeMonthSummary,
  monthPace,
  plannedSplit,
  shiftMonth,
  useHousehold,
} from '../components/useBudget';
import { Card, CardTitle, EmptyState, ErrorText, LoadingView, RowButton } from '../components/ui';
import type { Currency, Label, LabelBudget, Projection, Transaction } from '../lib/types';

export function HomeScreen() {
  const { tokens, appearance, setAppearance } = useTheme();
  const navigation = useNavigation<RootStackNavigation>();
  const { householdId, currency, loading: hhLoading, error: hhError } = useHousehold();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReturnType<typeof computeMonthSummary> | null>(null);
  const [monthRow, setMonthRow] = useState<{
    projected_savings_pct: number | null;
  } | null>(null);
  const [labelCount, setLabelCount] = useState(0);
  const [accountCount, setAccountCount] = useState(0);
  const [openItemCount, setOpenItemCount] = useState(0);
  const [reimbCount, setReimbCount] = useState(0);
  const [labels, setLabels] = useState<Label[]>([]);
  const [labelBudgets, setLabelBudgets] = useState<LabelBudget[]>([]);
  const [projections, setProjections] = useState<Projection[]>([]);

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
    setLabels(labels);
    setLabelCount(labels.filter((l) => l.is_active).length);
    setAccountCount((accountsRes.data ?? []).filter((a) => a.is_active).length);
    setOpenItemCount((openRes.data ?? []).length);

    if (!m) {
      setSummary(null);
      setLabelBudgets([]);
      setProjections([]);
      setReimbCount(0);
      setLoading(false);
      return;
    }
    const [txRes, projRes, movRes, budRes] = await Promise.all([
      listTransactions(householdId, m.id),
      listProjections(householdId, m.id),
      listSavingsMovements(householdId),
      listLabelBudgets(householdId, m.id),
    ]);
    if (txRes.error) setError(txRes.error);
    if (projRes.error) setError(projRes.error);
    const txs: Transaction[] = txRes.data ?? [];
    const projs: Projection[] = projRes.data ?? [];
    const bucketPaid = new Set(
      (movRes.data ?? []).filter(isSpendMovement).map((mv) => mv.transaction_id as string),
    );
    setSummary(computeMonthSummary(txs, labels, projs, bucketPaid));
    setProjections(projs);
    setLabelBudgets(budRes.data ?? []);
    setReimbCount(txs.filter((t) => t.kind === 'reimbursement').length);
    setLoading(false);
  }, [householdId, month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Breakdown card: earning, spending and saving per category, like the
  // spreadsheet Dashboard. Income by source, Expenses by label category,
  // Savings by fund (label). A row carries its plan (projection, or a label
  // budget in that category) so it can render a progress bar; a row with no
  // plan shows just the actual. Income rows also pick up any income label
  // with actuals but no projected source, so the rows reconcile with the
  // Income header total.
  // NOTE: this useMemo must stay above the early returns below. A hook after
  // a conditional return changes the hook count between renders, which
  // crashes the whole app to a blank page once loading finishes.
  const breakdown = useMemo(() => {
    if (!summary) return null;
    const perLabel = summary.perLabelSpent;
    const budgetByLabel = new Map(labelBudgets.map((b) => [b.label_id, b.planned_cents]));
    const incomeRows = (summary.perSource ?? []).map((s) => ({
      name: s.name,
      actual: s.actual,
      planned: s.projected as number | null,
    }));
    const knownSources = new Set(incomeRows.map((r) => r.name));
    for (const l of labels) {
      if (l.section !== 'Income' || !l.is_active || knownSources.has(l.label)) continue;
      const actual = perLabel.get(l.id) ?? 0;
      if (actual !== 0) incomeRows.push({ name: l.label, actual, planned: null });
    }
    const expByCat = new Map<string, { actual: number; planned: number }>();
    for (const l of labels) {
      if (l.section !== 'Expense' || !l.is_active) continue;
      const entry = expByCat.get(l.category) ?? { actual: 0, planned: 0 };
      entry.actual += perLabel.get(l.id) ?? 0;
      entry.planned += budgetByLabel.get(l.id) ?? 0;
      expByCat.set(l.category, entry);
    }
    const expenseRows = [...expByCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, v]) => ({ name, actual: v.actual, planned: v.planned }));
    const savingsRows = labels
      .filter((l) => l.section === 'Savings' && l.is_active)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((l) => ({ name: l.label, actual: perLabel.get(l.id) ?? 0, planned: null as number | null }));
    return { incomeRows, expenseRows, savingsRows };
  }, [summary, labels, labelBudgets]);
  // Gross saved per fund this month (the Savings rows). The Spending card's
  // Savings figure is the net one from the summary, which subtracts
  // bucket-funded spending; both are $0 while no bucket has been spent from.
  const savingsRowsTotal = breakdown?.savingsRows.reduce((s, r) => s + r.actual, 0) ?? 0;

  if (hhLoading || (loading && !summary && !monthRow)) return <LoadingView />;
  if (hhError || !householdId) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.bg }]}>
        <ErrorText message={hhError ?? 'No household found.'} />
      </View>
    );
  }

  const pace = monthPace(month);
  // Planned Needs/Wants/Savings come from the derived split (label budgets
  // grouped by each label's Needs/Wants flag), never from typed percentages.
  const split = plannedSplit(labels, labelBudgets, projections, monthRow?.projected_savings_pct ?? null);
  const projected = summary?.projectedIncome ?? 0;
  const plannedNeeds = split.needs;
  const plannedWants = split.wants;
  const plannedSavings = split.savings;
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
            <CardTitle title="Spending" right={`${formatMoney(out, currency)} out`} />
            <View style={[styles.splitBar, { backgroundColor: tokens.line }]}>
              <View style={{ flex: Math.max(summary?.needsActual ?? 0, 0), backgroundColor: tokens.needs }} />
              <View style={{ flex: Math.max(summary?.wantsActual ?? 0, 0), backgroundColor: tokens.wants }} />
              <View style={{ flex: Math.max(summary?.savingsActual ?? 0, 0), backgroundColor: tokens.savings }} />
            </View>
            <View style={styles.splitStats}>
              <SplitStat label="Needs" actual={summary?.needsActual ?? 0} planned={plannedNeeds} color={tokens.needs} currency={currency} />
              <SplitStat label="Wants" actual={summary?.wantsActual ?? 0} planned={plannedWants} color={tokens.wants} currency={currency} />
              <SplitStat label="Savings" actual={summary?.savingsActual ?? 0} planned={plannedSavings} color={tokens.savings} currency={currency} />
            </View>
          </Card>

          {breakdown ? (
            <Card>
              <CardTitle title="Breakdown" />
              <BreakdownGroup
                title="Income"
                actual={summary?.incomeActual ?? 0}
                planned={projected}
                rows={breakdown.incomeRows}
                currency={currency}
                color={tokens.brand}
              />
              <BreakdownGroup
                title="Expenses"
                actual={(summary?.needsActual ?? 0) + (summary?.wantsActual ?? 0)}
                planned={plannedNeeds + plannedWants}
                rows={breakdown.expenseRows}
                currency={currency}
                color={tokens.needs}
              />
              <BreakdownGroup
                title="Savings"
                actual={savingsRowsTotal}
                planned={plannedSavings}
                rows={breakdown.savingsRows}
                currency={currency}
                color={tokens.savings}
              />
            </Card>
          ) : null}
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

function SplitStat({
  label,
  actual,
  planned,
  color,
  currency,
}: {
  label: string;
  actual: number;
  planned: number;
  color: string;
  currency: Currency;
}) {
  const { tokens } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '700', marginTop: 3 }}>
        {formatMoney(actual, currency)}
      </Text>
      <Text style={{ color: tokens.ink3, fontSize: 11, marginTop: 1 }}>of {formatMoney(planned, currency)}</Text>
    </View>
  );
}

function ProgressBar({
  actual,
  planned,
  color,
  currency,
}: {
  actual: number;
  planned: number;
  color: string;
  currency: Currency;
}) {
  // Actual inside the bar, planned to its right — no "of" phrasing.
  // The amount's colour flips with the fill: dark on the bare track, white
  // once the fill covers most of the text.
  const { tokens } = useTheme();
  const ratio = planned > 0 ? Math.min(Math.max(actual / planned, 0), 1) : 0;
  const over = planned > 0 && actual > planned;
  return (
    <View style={{ alignItems: 'center', flex: 1.3, flexDirection: 'row', gap: 8 }}>
      <View style={[styles.progressTrack, { backgroundColor: tokens.line }]}>
        <View
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            backgroundColor: over ? tokens.danger : color,
            borderRadius: 99,
          }}
        />
        <Text
          style={{
            position: 'absolute',
            left: 8,
            lineHeight: 20,
            color: ratio >= 0.45 ? '#FFFFFF' : tokens.ink,
            fontSize: 12,
            fontWeight: '700',
          }}
        >
          {formatMoney(actual, currency)}
        </Text>
      </View>
      <Text style={{ color: tokens.ink2, fontSize: 13, fontWeight: '600', width: 70, textAlign: 'right' }}>
        {formatMoney(planned, currency)}
      </Text>
    </View>
  );
}

function BreakdownGroup({
  title,
  actual,
  planned,
  rows,
  currency,
  color,
}: {
  title: string;
  actual: number;
  planned: number;
  rows: { name: string; actual: number; planned: number | null }[];
  currency: Currency;
  color: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={{ marginTop: 14 }}>
      <View style={styles.breakRow}>
        <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '800', flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
        <ProgressBar actual={actual} planned={planned} color={color} currency={currency} />
      </View>
      {rows.map((r) => (
        <View key={r.name} style={styles.breakRow}>
          <Text style={{ color: tokens.ink, fontSize: 13.5, flex: 1 }} numberOfLines={1}>
            {r.name}
          </Text>
          {r.planned != null && r.planned > 0 ? (
            <ProgressBar actual={r.actual} planned={r.planned} color={color} currency={currency} />
          ) : (
            <Text style={{ color: tokens.ink2, fontSize: 13, fontWeight: '600', textAlign: 'right' }}>
              {formatMoney(r.actual, currency)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  breakRow: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between', paddingVertical: 5 },
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
  progressTrack: { borderRadius: 99, flex: 1, height: 20, justifyContent: 'center', overflow: 'hidden' },
  splitBar: { borderRadius: 99, flexDirection: 'row', height: 8, marginTop: 12, overflow: 'hidden' },
  splitStats: { flexDirection: 'row', gap: 10, marginTop: 12 },
  srcRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  statusText: { fontSize: 13.5, fontWeight: '600' },
});
