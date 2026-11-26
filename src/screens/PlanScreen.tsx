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
import { deleteProjection, updateMonthSplit, upsertLabelBudget, upsertProjection } from '../lib/plan';
import { resultError, shiftMonth, useHousehold } from '../components/useBudget';
import { Bar, Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, SplitBar } from '../components/ui';
import type { Label, LabelBudget, Month, Projection, Transaction } from '../lib/types';

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
  const [selectedLabel, setSelectedLabel] = useState<Label | null>(null);

  // Income source form
  const [addingSource, setAddingSource] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceAmount, setSourceAmount] = useState('');
  const [editingSource, setEditingSource] = useState<Projection | null>(null);
  const [editSourceAmount, setEditSourceAmount] = useState('');

  // Split editor (local state mirrors the stored months row until saved)
  const [needsPct, setNeedsPct] = useState('');
  const [wantsPct, setWantsPct] = useState('');
  const [savingsPct, setSavingsPct] = useState('');
  const [splitDirty, setSplitDirty] = useState(false);
  const [splitMsg, setSplitMsg] = useState<string | null>(null);

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
      setNeedsPct(String(m.projected_needs_pct ?? ''));
      setWantsPct(String(m.projected_wants_pct ?? ''));
      setSavingsPct(String(m.projected_savings_pct ?? ''));
      setSplitDirty(false);
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

  const needsNum = Number(needsPct) || 0;
  const wantsNum = Number(wantsPct) || 0;
  const savingsNum = Number(savingsPct) || 0;
  const splitTotal = needsNum + wantsNum + savingsNum;
  const splitOver = splitTotal > 100;
  const unallocated = Math.max(0, 100 - splitTotal);
  // Derived percentages are floating-point sums (100 - 77.4 - 8.1 - 5.6 =
  // 8.900000000000006), so round them to 1 decimal for display.
  const pct1 = (n: number) => parseFloat(n.toFixed(1));

  const saveSplit = async () => {
    if (!householdId || !monthRow || splitOver) return;
    const res = await updateMonthSplit(
      month,
      { needsPct: needsNum, wantsPct: wantsNum, savingsPct: savingsNum },
      householdId,
    );
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setSplitDirty(false);
    setSplitMsg('Split saved — Home, Savings, and Year read from it.');
    load();
  };

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
          <CardTitle title="How it splits" right={`${pct1(splitTotal)}%`} />
          <SplitBar
            segments={[
              { value: needsNum, color: tokens.needs },
              { value: wantsNum, color: tokens.wants },
              { value: savingsNum, color: tokens.savings },
            ]}
          />
          <View style={styles.legend}>
            <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>Needs {needsNum}%</Text>
            <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>Wants {wantsNum}%</Text>
            <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>Savings {savingsNum}%</Text>
            {unallocated > 0 ? <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>Unallocated {pct1(unallocated)}%</Text> : null}
          </View>
          {splitOver ? (
            <Text style={{ color: tokens.danger, fontSize: 13, fontWeight: '700', marginTop: 8 }}>
              Over 100% — lower one of the three before saving.
            </Text>
          ) : null}
          <View style={styles.pctRow}>
            <PctField label="Needs %" value={needsPct} onChange={(v) => { setNeedsPct(v); setSplitDirty(true); }} tokens={tokens} />
            <PctField label="Wants %" value={wantsPct} onChange={(v) => { setWantsPct(v); setSplitDirty(true); }} tokens={tokens} />
            <PctField label="Savings %" value={savingsPct} onChange={(v) => { setSavingsPct(v); setSplitDirty(true); }} tokens={tokens} />
          </View>
          {splitDirty ? (
            <PrimaryButton label="Save split" disabled={splitOver} onPress={saveSplit} />
          ) : null}
          {splitMsg && !splitDirty ? <Text style={{ color: tokens.brand, fontSize: 13, marginTop: 8 }}>{splitMsg}</Text> : null}
          <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
            Under 100% shows as Unallocated. Over 100% is blocked.
          </Text>
        </Card>
      ) : null}

      <Card>
        <CardTitle title="Budget by label" />
        <TextInput
          placeholder="Search labels…"
          placeholderTextColor={tokens.ink3}
          value={search}
          onChangeText={setSearch}
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
                return (
                  <Pressable key={l.id} onPress={() => setSelectedLabel(l)} style={[styles.labelRow, { borderTopColor: tokens.line }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }}>{l.label}</Text>
                      <Text style={{ color: over ? tokens.danger : tokens.ink2, fontSize: 12.5, marginTop: 2 }}>
                        {formatMoney(spent, currency)} spent of {formatMoney(planned, currency)}
                        {over ? ' · over budget' : ''}
                        {planned > 0 ? ` · ${formatMoney(Math.max(0, planned - spent), currency)} left` : ''}
                      </Text>
                      <Bar fill={planned > 0 ? spent / planned : 0} color={over ? tokens.danger : tokens.needs} />
                    </View>
                    <Text style={{ color: tokens.ink3, fontSize: 16 }}>›</Text>
                  </Pressable>
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

      {selectedLabel && householdId && monthRow ? (
        <LabelBudgetSheet
          label={selectedLabel}
          month={month}
          householdId={householdId}
          planned={budgetByLabel.get(selectedLabel.id)?.planned_cents ?? 0}
          spent={spentByLabel.get(selectedLabel.id) ?? 0}
          transactions={transactions.filter((t) => t.label_id === selectedLabel.id)}
          currency={currency}
          onClose={() => setSelectedLabel(null)}
          onSaved={() => {
            setSelectedLabel(null);
            load();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function PctField({
  label,
  value,
  onChange,
  tokens,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tokens: ReturnType<typeof useTheme>['tokens'];
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: tokens.ink2, fontSize: 12, fontWeight: '700' }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        style={[styles.pctInput, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />
    </View>
  );
}

function LabelBudgetSheet({
  label,
  month,
  householdId,
  planned,
  spent,
  transactions,
  currency,
  onClose,
  onSaved,
}: {
  label: Label;
  month: string;
  householdId: string;
  planned: number;
  spent: number;
  transactions: Transaction[];
  currency: Parameters<typeof formatMoney>[1];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tokens } = useTheme();
  const [amount, setAmount] = useState((planned / 100).toFixed(2));
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
    // month+label, and this sheet edits existing budgets too.
    const res = await upsertLabelBudget(month, label.id, cents, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: tokens.surface, borderColor: tokens.line }]}>
      <Text style={[styles.sheetTitle, { color: tokens.ink }]}>{label.label}</Text>
      <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 4 }}>
        {formatMoney(spent, currency)} spent this month · {label.needs_wants ?? label.section} · {label.category}
      </Text>
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
      <Pressable onPress={onClose} style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Close</Text>
      </Pressable>
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
  labelRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  navBtn: { alignItems: 'center', borderRadius: 10, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  navRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  pctInput: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 4, paddingHorizontal: 10, paddingVertical: 9, textAlign: 'center' },
  pctRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  sheet: { borderRadius: 16, borderWidth: 1, marginTop: 12, padding: 16 },
  sheetTitle: { fontSize: 19, fontWeight: '800' },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  srcRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 10 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  txRow: { borderTopWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 8 },
});
