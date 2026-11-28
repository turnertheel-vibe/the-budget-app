/**
 * Plan — the single source Home, Savings, and Year read from (spec §2.3):
 * projected income sources, the Needs/Wants/Savings split, and a planned
 * amount per expense label. Savings labels are NOT budgeted here — they are
 * planned in the split and held in buckets on Savings.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import { dollarsToCents, formatMoney, formatMonth, monthKey } from '../lib/money';
import {
  getMonth,
  listLabelBudgets,
  listLabels,
  listProjections,
  listTransactions,
} from '../lib/queries';
import { deleteProjection, upsertLabelBudget, upsertProjection } from '../lib/plan';
import { setLabelNeedsWants } from '../lib/reference';
import { plannedSplit, resultError, shiftMonth, useHousehold } from '../components/useBudget';
import { Bar, Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, SegControl, SplitBar } from '../components/ui';
import type { Label, LabelBudget, Month, NeedsWants, Projection, Transaction } from '../lib/types';

export function PlanScreen() {
  const { tokens } = useTheme();
  const { householdId, currency, loading: hhLoading, error: hhError } = useHousehold();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [loading, setLoading] = useState(true);
  // Only the first load shows the loading screen; later tab focuses refresh
  // silently in the background so the tab stays where you left it (see
  // ActivityScreen for why — the LoadingView swap reset the scroll).
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [monthRow, setMonthRow] = useState<Month | null>(null);
  const [projections, setProjections] = useState<Projection[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [budgets, setBudgets] = useState<LabelBudget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [search, setSearch] = useState('');
  // Budget-by-label accordion: tapping a label row expands it in place so
  // its planned amount can be adjusted right there. Only one row is expanded
  // at a time; tapping the expanded row again collapses it.
  const [expandedLabelId, setExpandedLabelId] = useState<string | null>(null);

  // Income source form
  const [addingSource, setAddingSource] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceAmount, setSourceAmount] = useState('');
  const [editingSource, setEditingSource] = useState<Projection | null>(null);
  const [editSourceAmount, setEditSourceAmount] = useState('');

  const load = useCallback(async () => {
    if (!householdId) return;
    if (!hasLoaded.current) setLoading(true);
    setError(null);
    const { data: m, error: mErr } = await getMonth(householdId, month);
    if (mErr) {
      setError(mErr);
      hasLoaded.current = true;
      setLoading(false);
      return;
    }
    setMonthRow(m);
    const labelsRes = await listLabels(householdId);
    setLabels(labelsRes.data ?? []);
    if (labelsRes.error) setError(labelsRes.error);
    if (m) {
      const [projRes, budRes, txRes] = await Promise.all([
        listProjections(householdId, m.id),
        listLabelBudgets(householdId, m.id),
        listTransactions(householdId, m.id),
      ]);
      setProjections(projRes.data ?? []);
      setBudgets(budRes.data ?? []);
      setTransactions(txRes.data ?? []);
      if (projRes.error) setError(projRes.error);
      if (budRes.error) setError(budRes.error);
    } else {
      setProjections([]);
      setBudgets([]);
      setTransactions([]);
    }
    hasLoaded.current = true;
    setLoading(false);
  }, [householdId, month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const projectedTotal = useMemo(() => projections.reduce((s, p) => s + p.projected_cents, 0), [projections]);

  // The split is derived, never typed in: Needs and Wants are the month's
  // per-label budgets grouped by each label's Needs/Wants flag; Savings is
  // the stored savings target; the rest is Unallocated.
  const split = useMemo(
    () => plannedSplit(labels, budgets, projections, monthRow?.projected_savings_pct ?? null),
    [labels, budgets, projections, monthRow],
  );
  // Derived percentages are floating-point sums, so round them to 1 decimal
  // for display.
  const pct1 = (n: number) => parseFloat(n.toFixed(1));
  const splitPct = (cents: number) => (split.projected > 0 ? pct1((cents / split.projected) * 100) : 0);

  const addSource = async () => {
    if (!householdId || !monthRow || !sourceName.trim()) return;
    const cents = dollarsToCents(sourceAmount);
    if (cents == null || cents < 0) {
      setError('Enter a projected amount of zero or more.');
      return;
    }
    const name = sourceName.trim();
    // Add source AND an Income label of the same name, ready to log against
    // (createLabel does both; a duplicate label is ignored).
    const res = await upsertProjection(month, name, cents, {
      section: 'Income',
      createLabel: true,
      householdId,
    });
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setSourceName('');
    setSourceAmount('');
    setAddingSource(false);
    load();
  };

  const saveSourceEdit = async () => {
    if (!editingSource) return;
    const cents = dollarsToCents(editSourceAmount);
    if (cents == null || cents < 0) {
      setError('Enter a projected amount of zero or more.');
      return;
    }
    const res = await upsertProjection(month, editingSource.category, cents, { householdId });
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setEditingSource(null);
    load();
  };

  const removeSource = async (p: Projection) => {
    const res = await deleteProjection(p.id, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    load();
  };

  const spentByLabel = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions) {
      map.set(t.label_id, (map.get(t.label_id) ?? 0) + t.amount_cents);
    }
    return map;
  }, [transactions]);
  const budgetByLabel = useMemo(() => {
    const map = new Map<string, LabelBudget>();
    for (const b of budgets) map.set(b.label_id, b);
    return map;
  }, [budgets]);

  const expenseLabels = labels
    .filter((l) => l.is_active && l.section === 'Expense')
    .filter((l) => !search.trim() || l.label.toLowerCase().includes(search.trim().toLowerCase()));
  const grouped = useMemo(() => {
    const map = new Map<string, Label[]>();
    for (const l of expenseLabels) {
      const list = map.get(l.category) ?? [];
      list.push(l);
      map.set(l.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [expenseLabels]);

  if (hhLoading || loading) return <LoadingView />;
  if (hhError || !householdId) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.bg }]}>
        <ErrorText message={hhError ?? 'No household found.'} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.ink }]}>Plan</Text>
        <View style={styles.navRow}>
          <Pressable onPress={() => setMonth((m) => shiftMonth(m, -1))} style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}>
            <Text style={{ color: tokens.ink, fontSize: 18 }}>‹</Text>
          </Pressable>
          <Text style={{ color: tokens.ink, fontWeight: '700', alignSelf: 'center' }}>{formatMonth(month)}</Text>
          <Pressable onPress={() => setMonth((m) => shiftMonth(m, 1))} style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}>
            <Text style={{ color: tokens.ink, fontSize: 18 }}>›</Text>
          </Pressable>
        </View>
      </View>
      <ErrorText message={error} />

      {!monthRow ? (
        <Card>
          <EmptyState
            title="No plan for this month yet"
            body="Add a projected income source below and the month's plan will be created from it. Home, Savings, and Year all read from this tab."
          />
        </Card>
      ) : null}

      <Card>
        <CardTitle title="Projected income" right={formatMoney(projectedTotal, currency)} />
        {projections.map((p) => (
          <View key={p.id} style={[styles.srcRow, { borderTopColor: tokens.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }}>{p.category}</Text>
              {editingSource?.id === p.id ? (
                <TextInput
                  value={editSourceAmount}
                  onChangeText={setEditSourceAmount}
                  keyboardType="decimal-pad"
                  placeholder="Projected amount"
                  placeholderTextColor={tokens.ink3}
                  style={[styles.inlineInput, { color: tokens.ink, borderColor: tokens.line }]}
                />
              ) : (
                <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 2 }}>
                  {formatMoney(p.projected_cents, currency)} projected
                </Text>
              )}
            </View>
            {editingSource?.id === p.id ? (
              <Pressable onPress={saveSourceEdit} style={[styles.smallBtn, { backgroundColor: tokens.brand }]}>
                <Text style={{ color: tokens.brandInk, fontWeight: '700', fontSize: 13 }}>Save</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={() => {
                    setEditingSource(p);
                    setEditSourceAmount((p.projected_cents / 100).toFixed(2));
                  }}
                  style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}
                >
                  <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => removeSource(p)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
                  <Text style={{ color: tokens.danger, fontWeight: '700', fontSize: 13 }}>Remove</Text>
                </Pressable>
              </>
            )}
          </View>
        ))}
        {projections.length === 0 && monthRow ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 8 }}>No income sources yet.</Text>
        ) : null}
        {addingSource && monthRow ? (
          <View style={{ marginTop: 10 }}>
            <TextInput
              placeholder="Source name (e.g. a paycheck or client)"
              placeholderTextColor={tokens.ink3}
              value={sourceName}
              onChangeText={setSourceName}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Projected amount"
              placeholderTextColor={tokens.ink3}
              value={sourceAmount}
              onChangeText={setSourceAmount}
              keyboardType="decimal-pad"
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <PrimaryButton label="Add source" disabled={!sourceName.trim()} onPress={addSource} />
            <Pressable onPress={() => setAddingSource(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            disabled={!monthRow}
            onPress={() => setAddingSource(true)}
            style={{ paddingVertical: 8, marginTop: 4 }}
          >
            <Text style={{ color: monthRow ? tokens.brand : tokens.ink3, fontWeight: '700' }}>
              + Add income source
            </Text>
          </Pressable>
        )}
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
          Adding a source also creates an Income label of the same name, ready to log against.
        </Text>
      </Card>

      {monthRow ? (
        <Card>
          <CardTitle title="How it splits" />
          <SplitBar
            segments={[
              { value: splitPct(split.needs), color: tokens.needs },
              { value: splitPct(split.wants), color: tokens.wants },
              { value: splitPct(split.savings), color: tokens.savings },
            ]}
          />
          <View style={styles.legend}>
            <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>
              Needs {formatMoney(split.needs, currency)} · {splitPct(split.needs)}%
            </Text>
            <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>
              Wants {formatMoney(split.wants, currency)} · {splitPct(split.wants)}%
            </Text>
            <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>
              Savings {formatMoney(split.savings, currency)} · {splitPct(split.savings)}%
            </Text>
            {split.unallocated !== 0 ? (
              <Text style={{ color: split.unallocated < 0 ? tokens.danger : tokens.ink2, fontSize: 12.5 }}>
                Unallocated {formatMoney(split.unallocated, currency)} · {splitPct(split.unallocated)}%
              </Text>
            ) : null}
          </View>
          <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
            From your label budgets below — tap a label to change its amount or set it as a Need or a Want.
          </Text>
        </Card>
      ) : null}

      <Card>
        <CardTitle title="Budget by label" />
        <TextInput
          placeholder="Search labels…"
          placeholderTextColor={tokens.ink3}
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            setExpandedLabelId(null);
          }}
          style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
        />
        {grouped.length === 0 ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 10 }}>
            {search ? 'No labels match that search.' : 'No expense labels yet — add one from the Chart of accounts.'}
          </Text>
        ) : (
          grouped.map(([category, rows]) => (
            <View key={category}>
              <Text style={[styles.groupLabel, { color: tokens.ink2 }]}>
                {category} · {formatMoney(rows.reduce((s, l) => s + (budgetByLabel.get(l.id)?.planned_cents ?? 0), 0), currency)} planned
              </Text>
              {rows.map((l) => {
                const planned = budgetByLabel.get(l.id)?.planned_cents ?? 0;
                const spent = spentByLabel.get(l.id) ?? 0;
                const over = planned > 0 && spent > planned;
                const expanded = expandedLabelId === l.id;
                return (
                  <View key={l.id} style={{ borderTopColor: tokens.line, borderTopWidth: 1, paddingVertical: 10 }}>
                    <Pressable
                      onPress={() => setExpandedLabelId(expanded ? null : l.id)}
                      style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }}>{l.label}</Text>
                        <Text style={{ color: over ? tokens.danger : tokens.ink2, fontSize: 12.5, marginTop: 2 }}>
                          {formatMoney(spent, currency)} spent of {formatMoney(planned, currency)}
                          {over ? ' · over budget' : ''}
                          {planned > 0 ? ` · ${formatMoney(Math.max(0, planned - spent), currency)} left` : ''}
                          {` · ${l.needs_wants ?? 'Wants'}`}
                        </Text>
                        <Bar fill={planned > 0 ? spent / planned : 0} color={over ? tokens.danger : tokens.needs} />
                      </View>
                      <Text style={{ color: tokens.ink3, fontSize: 16 }}>{expanded ? '⌄' : '›'}</Text>
                    </Pressable>
                    {expanded && householdId && monthRow ? (
                      <LabelBudgetEditor
                        label={l}
                        month={month}
                        householdId={householdId}
                        planned={planned}
                        spent={spent}
                        transactions={transactions.filter((t) => t.label_id === l.id)}
                        currency={currency}
                        onSaved={() => {
                          setExpandedLabelId(null);
                          load();
                        }}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))
        )}
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
          Savings labels are not budgeted here — they are planned in the split above and held in buckets on Savings.
        </Text>
      </Card>

      <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>
        Income and split changes update Home, Savings, and Year at once.
      </Text>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function LabelBudgetEditor({
  label,
  month,
  householdId,
  planned,
  spent,
  transactions,
  currency,
  onSaved,
}: {
  label: Label;
  month: string;
  householdId: string;
  planned: number;
  spent: number;
  transactions: Transaction[];
  currency: Parameters<typeof formatMoney>[1];
  onSaved: () => void;
}) {
  const { tokens } = useTheme();
  const [amount, setAmount] = useState((planned / 100).toFixed(2));
  const [needsWants, setNeedsWants] = useState<NeedsWants>(label.needs_wants ?? 'Wants');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const cents = dollarsToCents(amount);
    if (cents == null || cents < 0) {
      setError('Enter a planned amount of zero or more.');
      return;
    }
    setBusy(true);
    setError(null);
    // Upsert: insertLabelBudget rejects when a budget already exists for the
    // month+label, and this editor edits existing budgets too.
    const res = await upsertLabelBudget(month, label.id, cents, householdId);
    let err = resultError(res);
    if (!err && needsWants !== (label.needs_wants ?? 'Wants')) {
      err = resultError(await setLabelNeedsWants(label.id, needsWants, householdId));
    }
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved();
  };

  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 4 }}>
        {formatMoney(spent, currency)} spent this month · {label.category}
      </Text>
      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Need or want?</Text>
      <View style={{ marginTop: 8 }}>
        <SegControl options={['Needs', 'Wants'] as const} value={needsWants} onChange={setNeedsWants} />
      </View>
      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Planned monthly amount</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />
      <ErrorText message={error} />
      <PrimaryButton label={busy ? 'Saving…' : 'Save planned amount'} disabled={busy} onPress={save} />
      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>This month&apos;s transactions</Text>
      {transactions.length === 0 ? (
        <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 6 }}>Nothing logged against this label yet.</Text>
      ) : (
        transactions.map((t) => (
          <View key={t.id} style={[styles.txRow, { borderTopColor: tokens.line }]}>
            <Text style={{ color: tokens.ink, fontSize: 14, flex: 1 }} numberOfLines={1}>
              {t.merchant || t.description}
            </Text>
            <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600' }}>{formatMoney(t.amount_cents, currency)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  groupLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginTop: 14, textTransform: 'uppercase' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  inlineInput: { borderRadius: 8, borderWidth: 1, marginTop: 6, paddingHorizontal: 10, paddingVertical: 6 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  navBtn: { alignItems: 'center', borderRadius: 10, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  navRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  srcRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 10 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  txRow: { borderTopWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 8 },
});
