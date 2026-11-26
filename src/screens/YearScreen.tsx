/**
 * Year — yearly overview, goals, and reports (spec §2.6).
 * The year overview is annualized from real months and labeled as such;
 * months with no data say so honestly. Reports are prompts that hand off
 * to the connected AI agent — the AI is the analyst, not built-in charts.
 * The January reminder is derived, never stored: it clears the moment any
 * active goal exists for the target year.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import { dollarsToCents, formatMoney, formatMonth } from '../lib/money';
import { supabase } from '../lib/supabase';
import {
  getHouseholdPreferences,
  getSavingsPoolBalance,
  listLabelBudgets,
  listLabels,
  listProjections,
  listSavingsFundBalances,
  listSavingsMovements,
  listTransactions,
  listYearlyGoals,
} from '../lib/queries';
import { logAudit, upsertYearlyGoal } from '../lib/queries';
import { deleteYearlyGoal } from '../lib/plan';
import { getMonth } from '../lib/queries';
import { computeMonthSummary, monthPace, resultError, useHousehold } from '../components/useBudget';
import { isSpendMovement } from '../lib/savings';
import { Bar, Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, SegControl } from '../components/ui';
import type { Label, SavingsFund, YearlyGoal } from '../lib/types';
import { listSavingsFunds } from '../lib/queries';

const REPORTS = [
  {
    id: 'month-review',
    name: 'November in review',
    desc: "This month's story — plan vs. actual, label by label",
    prompt:
      'Give me November 2026 in review: projected vs. actual income, Needs / Wants / Savings against the plan, and the labels furthest from their planned amounts.',
    sources:
      "November's projected income and split from the Plan tab, per-label planned vs. actual, and this month's transactions.",
  },
  {
    id: 'year-review',
    name: '2026 year in review',
    desc: 'The whole year — income, the split, and the goals',
    prompt:
      'Give me my 2026 year in review: income vs. plan, how spending split across Needs, Wants, and Savings, and how each of my yearly goals is tracking.',
    sources:
      'The 2026 plan (November’s plan × 12, as the Year tab frames it), your yearly goals and their progress, and every transaction logged so far.',
  },
  {
    id: 'where-went',
    name: 'Where the money went',
    desc: 'November by label and category, biggest first',
    prompt:
      'Show me where my money went in November 2026, by label and category, biggest first — and call out anything that looks unusual.',
    sources:
      "Every November transaction, grouped by its label and category, with each label's planned amount from the Plan tab.",
  },
  {
    id: 'goals',
    name: 'Am I on track for my goals?',
    desc: 'Each goal against its target, and what it would take',
    prompt:
      'Am I on track for my 2026 goals? Go goal by goal: saved so far vs. target, and the monthly pace that would get each one there by year-end.',
    sources: 'Your yearly goals and targets, plus the savings bucket balances behind the linked ones.',
  },
  {
    id: 'leaks',
    name: 'Biggest leaks',
    desc: 'Small recurring charges and quiet creep, surfaced',
    prompt:
      'Find my biggest money leaks: small recurring charges, subscriptions I barely use, and labels that have crept up over the last few months.',
    sources: 'Recurring-looking transactions across your labels, plus per-label planned vs. actual to spot the creep.',
  },
];

const BRIEFING_KEY = '@budget-app/monthly-briefing';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function YearScreen() {
  const { tokens } = useTheme();
  const { householdId, currency, loading: hhLoading, error: hhError, prefs } = useHousehold();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  // Only the first load shows the loading screen; later tab focuses refresh
  // silently in the background so the tab stays where you left it.
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [goals, setGoals] = useState<YearlyGoal[]>([]);
  const [funds, setFunds] = useState<SavingsFund[]>([]);
  const [fundBalances, setFundBalances] = useState<Map<string, number>>(new Map());
  const [savedSoFar, setSavedSoFar] = useState(0);
  const [annual, setAnnual] = useState<{ income: number; needs: number; wants: number; savings: number } | null>(null);
  const [annualNote, setAnnualNote] = useState('');
  const [monthHasData, setMonthHasData] = useState<boolean[]>(new Array(12).fill(false));
  const [monthOut, setMonthOut] = useState<(number | null)[]>(new Array(12).fill(null));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [briefingOn, setBriefingOn] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<YearlyGoal | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalFundId, setGoalFundId] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    if (!hasLoaded.current) setLoading(true);
    setError(null);
    const [goalsRes, fundsRes, balRes, poolRes, prefsRes] = await Promise.all([
      listYearlyGoals(householdId, year),
      listSavingsFunds(householdId),
      listSavingsFundBalances(householdId),
      getSavingsPoolBalance(householdId),
      getHouseholdPreferences(householdId),
    ]);
    if (goalsRes.error) setError(goalsRes.error);
    const activeGoals = (goalsRes.data ?? []).filter((g) => g.is_active);
    setGoals(activeGoals);
    const activeFunds = (fundsRes.data ?? []).filter((f) => f.is_active);
    setFunds(activeFunds);
    const balMap = new Map((balRes.data ?? []).map((b) => [b.fund_id, b.balance_cents]));
    setFundBalances(balMap);
    const inBuckets = activeFunds.reduce((s, f) => s + (balMap.get(f.id) ?? 0), 0);
    setSavedSoFar((poolRes.data?.pool_cents ?? 0) + inBuckets);
    void prefsRes;

    // Annualization: real months only; months with no row are "No data".
    const hasData = new Array<boolean>(12).fill(false);
    const outByMonth: (number | null)[] = new Array(12).fill(null);
    let baseMonth: { income: number; needs: number; wants: number; savings: number } | null = null;
    let baseLabel = '';
    const { data: monthRows } = await supabase
      .from('months')
      .select('*')
      .eq('household_id', householdId)
      .gte('month', `${year}-01-01`)
      .lte('month', `${year}-12-01`)
      .order('month', { ascending: true });
    const labelsRes = await listLabels(householdId);
    const labels: Label[] = labelsRes.data ?? [];
    for (const mRow of monthRows ?? []) {
      const idx = Number(mRow.month.slice(5, 7)) - 1;
      const [txRes, projRes, movRes] = await Promise.all([
        listTransactions(householdId, mRow.id),
        listProjections(householdId, mRow.id),
        listSavingsMovements(householdId),
      ]);
      const txs = txRes.data ?? [];
      if (txs.length > 0 || (projRes.data ?? []).length > 0) {
        hasData[idx] = true;
        const bucketPaid = new Set(
          (movRes.data ?? []).filter(isSpendMovement).map((mv) => mv.transaction_id as string),
        );
        const s = computeMonthSummary(txs, labels, projRes.data ?? [], bucketPaid);
        outByMonth[idx] = s.out;
        if (!baseMonth) {
          baseMonth = { income: s.projectedIncome, needs: s.needsActual, wants: s.wantsActual, savings: s.savingsActual };
          baseLabel = formatMonth(mRow.month);
        }
      }
      // "Your app noticed" — computed from the current (latest) month with data.
      if (idx === new Date().getMonth() && mRow.month.startsWith(String(new Date().getFullYear()))) {
        const s = computeMonthSummary(txs, labels, projRes.data ?? [], new Set());
        const notes: string[] = [];
        const budRes = await listLabelBudgets(householdId, mRow.id);
        for (const b of budRes.data ?? []) {
          const spent = txs.filter((t) => t.label_id === b.label_id).reduce((x, t) => x + t.amount_cents, 0);
          if (b.planned_cents > 0 && spent > b.planned_cents) {
            const lbl = labels.find((l) => l.id === b.label_id);
            notes.push(`${lbl?.label ?? 'A label'} is over its planned amount (${formatMoney(spent, currency)} vs ${formatMoney(b.planned_cents, currency)}).`);
          }
        }
        const pace = monthPace(mRow.month);
        const plannedWants = Math.round((s.projectedIncome * (mRow.projected_wants_pct ?? 0)) / 100);
        if (plannedWants > 0 && s.wantsActual > plannedWants * pace) {
          notes.push('Wants spending is ahead of pace for the month.');
        }
        const pulls = (movRes.data ?? []).filter(
          (mv) => mv.movement_type === 'withdrawal' && !isSpendMovement(mv),
        ).length;
        if (pulls > 1) notes.push(`Money has been pulled out of buckets ${pulls} times — worth a look at why.`);
        setSuggestions(notes);
      }
    }
    setMonthHasData(hasData);
    setMonthOut(outByMonth);
    if (baseMonth) {
      const b = baseMonth as { income: number; needs: number; wants: number; savings: number };
      setAnnual({ income: b.income * 12, needs: b.needs * 12, wants: b.wants * 12, savings: b.savings * 12 });
      setAnnualNote(`Annualized from ${baseLabel}'s plan × 12 — the only month with a plan so far.`);
    } else {
      setAnnual(null);
      setAnnualNote('No month has a plan yet — add one on the Plan tab and the year view will annualize from it.');
    }
    const stored = await AsyncStorage.getItem(BRIEFING_KEY);
    setBriefingOn(stored === 'on');
    hasLoaded.current = true;
    setLoading(false);
  }, [householdId, year, currency]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const reminderTargetYear = useMemo(() => {
    const now = new Date();
    return now.getMonth() === 0 ? now.getFullYear() : now.getFullYear() + 1;
  }, []);
  const reminderDone = goals.some((g) => g.year === reminderTargetYear);
  const reminderTiming = prefs?.january_reminder_timing ?? 'Jan 1';
  const reminderLabel =
    reminderTiming === 'first weekend'
      ? `the first weekend of January ${reminderTargetYear}`
      : reminderTiming === 'Jan 15'
        ? `January 15, ${reminderTargetYear}`
        : `January 1, ${reminderTargetYear}`;

  const goalProgress = (g: YearlyGoal) => {
    if (g.fund_id) return fundBalances.get(g.fund_id) ?? 0;
    return 0;
  };

  const saveGoal = async () => {
    if (!householdId || !goalName.trim()) {
      setGoalError('Give the goal a name.');
      return;
    }
    const target = goalTarget.trim() ? dollarsToCents(goalTarget) : null;
    if (goalTarget.trim() && target == null) {
      setGoalError('Enter a valid target amount.');
      return;
    }
    const res = await upsertYearlyGoal({
      household_id: householdId,
      year,
      goal: goalName.trim(),
      target_cents: target,
      fund_id: goalFundId || null,
      ...(editingGoal ? { id: editingGoal.id } : {}),
    });
    const err = resultError(res);
    if (err) {
      setGoalError(err);
      return;
    }
    setGoalForm(false);
    setEditingGoal(null);
    setGoalName('');
    setGoalTarget('');
    setGoalFundId('');
    load();
  };

  const deleteGoal = async (g: YearlyGoal) => {
    const res = await deleteYearlyGoal(g.id, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    load();
  };

  const toggleBriefing = async (on: boolean) => {
    setBriefingOn(on);
    await AsyncStorage.setItem(BRIEFING_KEY, on ? 'on' : 'off');
  };

  const copyPrompt = async (report: (typeof REPORTS)[number]) => {
    setCopiedId(report.id);
    try {
      await Clipboard.setStringAsync(report.prompt);
    } catch {
      try {
        const nav = globalThis.navigator as unknown as { clipboard?: { writeText: (t: string) => Promise<void> } } | undefined;
        if (nav?.clipboard) await nav.clipboard.writeText(report.prompt);
      } catch {
        // No clipboard: the prompt is shown as selectable text below.
      }
    }
    await logAudit('report.prompt_copied', 'audit_log', null, { report: report.id, year }).catch(() => undefined);
  };

  const requestReport = async (report: (typeof REPORTS)[number]) => {
    setExpandedReport(expandedReport === report.id ? null : report.id);
    await logAudit('report.requested', 'audit_log', null, { report: report.id, year }).catch(() => undefined);
  };

  if (hhLoading || loading) return <LoadingView />;
  if (hhError || !householdId) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.bg }]}>
        <ErrorText message={hhError ?? 'No household found.'} />
      </View>
    );
  }

  const now = new Date();
  const yearPace = year === now.getFullYear() ? (now.getMonth() + 1) / 12 : year < now.getFullYear() ? 1 : 0;

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.ink }]}>{year}</Text>
        <View style={styles.navRow}>
          <Pressable onPress={() => setYear((y) => y - 1)} style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}>
            <Text style={{ color: tokens.ink, fontSize: 18 }}>‹</Text>
          </Pressable>
          <Pressable onPress={() => setYear((y) => y + 1)} style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}>
            <Text style={{ color: tokens.ink, fontSize: 18 }}>›</Text>
          </Pressable>
        </View>
      </View>
      <ErrorText message={error} />

      <Card>
        <CardTitle title={reminderDone ? `${reminderTargetYear} goals are set` : `Set your ${reminderTargetYear} goals in January`} />
        <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 19 }}>
          Every January, before the year gets going, sit down and set the year&apos;s goals. This reminder comes
          back each January and stays until that year&apos;s goals are set.
        </Text>
        <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 8 }}>
          {reminderDone
            ? `${reminderTargetYear} goals: set · Next reminder: ${reminderTargetYear + 1} in January`
            : `Next reminder: ${reminderLabel} · ${reminderTargetYear} goals: not set yet`}
        </Text>
      </Card>

      <Card>
        <CardTitle title="Year overview" right={annual ? 'annualized' : ''} />
        {annual ? (
          <>
            <YearRow label="Income" value={annual.income} currency={currency} tokens={tokens} />
            <YearRow label="Needs" value={annual.needs} currency={currency} tokens={tokens} />
            <YearRow label="Wants" value={annual.wants} currency={currency} tokens={tokens} />
            <YearRow label="Savings" value={annual.savings} currency={currency} tokens={tokens} />
            <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 10 }}>
              Actually saved so far: {formatMoney(savedSoFar, currency)} (pool + all buckets — the same total
              as the Savings tab)
            </Text>
          </>
        ) : (
          <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 19 }}>{annualNote}</Text>
        )}
        {annual ? <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>{annualNote}</Text> : null}
        <View style={styles.grid}>
          {MONTH_NAMES.map((m, i) => {
            const isCurrent = year === now.getFullYear() && i === now.getMonth();
            return (
              <View
                key={m}
                style={[
                  styles.cell,
                  { backgroundColor: tokens.surface2, borderColor: isCurrent ? tokens.brand : tokens.line },
                ]}
              >
                <Text style={{ color: tokens.ink, fontSize: 12, fontWeight: '800' }}>
                  {m}
                  {isCurrent ? ' · now' : ''}
                </Text>
                <Text style={{ color: tokens.ink2, fontSize: 12, marginTop: 4 }}>
                  {monthHasData[i] && monthOut[i] != null
                    ? formatMoney(monthOut[i] as number, currency)
                    : isCurrent
                      ? 'Nothing logged yet'
                      : 'No data'}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      <Card>
        <CardTitle title="Yearly goals" />
        {goals.length === 0 ? (
          <EmptyState
            title="No goals yet"
            body="Yearly goals get set each January — that's what the reminder above is for. Add one now if you already know it."
          />
        ) : (
          goals.map((g) => {
            const saved = goalProgress(g);
            const pct = g.target_cents && g.target_cents > 0 ? Math.min(1, saved / g.target_cents) : 0;
            const reached = g.target_cents != null && g.target_cents > 0 && saved >= g.target_cents;
            const fundName = g.fund_id ? funds.find((f) => f.id === g.fund_id)?.name : null;
            return (
              <View key={g.id} style={[styles.goalRow, { borderTopColor: tokens.line }]}>
                <View style={styles.goalTop}>
                  <Text style={{ color: tokens.ink, fontSize: 15, fontWeight: '700', flex: 1 }}>{g.goal}</Text>
                  <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '700' }}>
                    {g.target_cents != null ? formatMoney(g.target_cents, currency) : 'No target'}
                  </Text>
                </View>
                <Bar fill={pct} color={tokens.brand} />
                <View style={styles.goalFoot}>
                  <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>
                    {g.year} · {formatMoney(saved, currency)} saved · {Math.round(pct * 100)}%
                    {yearPace > 0 && g.target_cents ? ` · pace ${Math.round(yearPace * 100)}% through the year` : ''}
                  </Text>
                  {reached ? (
                    <Text style={{ color: tokens.brand, fontSize: 12, fontWeight: '800' }}>Goal reached</Text>
                  ) : fundName ? (
                    <Text style={{ color: tokens.ink3, fontSize: 12 }}>{fundName}</Text>
                  ) : (
                    <Text style={{ color: tokens.ink3, fontSize: 12 }}>Tracked by hand</Text>
                  )}
                </View>
                <View style={styles.goalActions}>
                  <Pressable
                    onPress={() => {
                      setEditingGoal(g);
                      setGoalName(g.goal);
                      setGoalTarget(g.target_cents != null ? (g.target_cents / 100).toFixed(2) : '');
                      setGoalFundId(g.fund_id ?? '');
                      setGoalForm(true);
                    }}
                    style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}
                  >
                    <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => deleteGoal(g)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
                    <Text style={{ color: tokens.danger, fontWeight: '700', fontSize: 13 }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
        {goalForm ? (
          <View style={{ marginTop: 12 }}>
            <TextInput
              placeholder="Goal name"
              placeholderTextColor={tokens.ink3}
              value={goalName}
              onChangeText={setGoalName}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Target amount (optional)"
              placeholderTextColor={tokens.ink3}
              value={goalTarget}
              onChangeText={setGoalTarget}
              keyboardType="decimal-pad"
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Link a bucket (optional — progress fills in on its own)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              <Pressable
                onPress={() => setGoalFundId('')}
                style={[styles.chip, { backgroundColor: !goalFundId ? tokens.brand : tokens.surface2 }]}
              >
                <Text style={{ color: !goalFundId ? tokens.brandInk : tokens.ink2, fontWeight: '700', fontSize: 13 }}>No bucket</Text>
              </Pressable>
              {funds.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => setGoalFundId(f.id)}
                  style={[styles.chip, { backgroundColor: goalFundId === f.id ? tokens.brand : tokens.surface2 }]}
                >
                  <Text style={{ color: goalFundId === f.id ? tokens.brandInk : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
                    {f.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <ErrorText message={goalError} />
            <PrimaryButton label={editingGoal ? 'Save goal' : 'Add goal'} onPress={saveGoal} />
            <Pressable
              onPress={() => {
                setGoalForm(false);
                setEditingGoal(null);
              }}
              style={{ alignItems: 'center', paddingVertical: 8 }}
            >
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => { setEditingGoal(null); setGoalName(''); setGoalTarget(''); setGoalFundId(''); setGoalForm(true); }} style={{ paddingVertical: 8, marginTop: 4 }}>
            <Text style={{ color: tokens.brand, fontWeight: '700' }}>+ Add a goal</Text>
          </Pressable>
        )}
      </Card>

      <Card>
        <CardTitle title="Reports" />
        <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 19 }}>
          Reports aren&apos;t drawn here — your connected AI agent writes them in chat, from your real plan,
          labels, and transactions, so you can ask follow-ups. Tap one to see the prompt, or tap Copy to
          paste it into your chat yourself.
        </Text>
        {REPORTS.map((r) => (
          <View key={r.id} style={[styles.reportRow, { borderTopColor: tokens.line }]}>
            <Pressable onPress={() => requestReport(r)} style={{ flex: 1 }}>
              <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '700' }}>{r.name}</Text>
              <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>{r.desc}</Text>
            </Pressable>
            <Pressable onPress={() => copyPrompt(r)} style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}>
              <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>
                {copiedId === r.id ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
            {expandedReport === r.id ? (
              <View style={{ marginTop: 10 }}>
                <Text selectable style={{ color: tokens.ink, fontSize: 13.5, lineHeight: 19 }}>
                  {r.prompt}
                </Text>
                <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>Sources: {r.sources}</Text>
                <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
                  Long-press the prompt above to copy it on mobile. Each tap is logged to the AI audit log.
                </Text>
              </View>
            ) : null}
          </View>
        ))}
        <View style={{ marginTop: 14 }}>
          <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Your app noticed</Text>
          {suggestions.length === 0 ? (
            <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 6 }}>Nothing to flag yet.</Text>
          ) : (
            suggestions.map((s, i) => (
              <Text key={i} style={{ color: tokens.ink, fontSize: 13.5, lineHeight: 19, marginTop: 6 }}>
                • {s}
              </Text>
            ))
          )}
        </View>
        <View style={[styles.briefingRow, { borderTopColor: tokens.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '700' }}>Monthly briefing</Text>
            <Text style={{ color: tokens.ink2, fontSize: 12.5, marginTop: 2 }}>
              On the 1st, your agent sends last month in review in chat — what came in, where it went,
              anything worth a look. No asking needed.
            </Text>
          </View>
          {/* Wrapped so the toggle keeps its natural height instead of
              stretching to the full row height (the row's default
              alignItems: 'stretch' made it a tall pill). */}
          <View style={{ alignSelf: 'center' }}>
            <SegControl options={['Off', 'On'] as const} value={briefingOn ? 'On' : 'Off'} onChange={(v) => toggleBriefing(v === 'On')} />
          </View>
        </View>
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function YearRow({
  label,
  value,
  currency,
  tokens,
}: {
  label: string;
  value: number;
  currency: Parameters<typeof formatMoney>[1];
  tokens: ReturnType<typeof useTheme>['tokens'];
}) {
  return (
    <View style={styles.yearRow}>
      <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '700' }}>{formatMoney(value, currency)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  briefingRow: { borderTopWidth: 1, flexDirection: 'row', gap: 12, marginTop: 16, paddingTop: 14 },
  cell: { borderRadius: 10, borderWidth: 1, margin: 3, padding: 10, width: '30%' },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  container: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  goalActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  goalFoot: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  goalRow: { borderTopWidth: 1, paddingVertical: 12 },
  goalTop: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  navBtn: { alignItems: 'center', borderRadius: 10, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  navRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  reportRow: { borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  yearRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
});
