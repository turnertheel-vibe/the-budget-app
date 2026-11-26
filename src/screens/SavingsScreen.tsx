/**
 * Savings — one pool, buckets filled only from it (spec §2.5).
 * The pool is a derived view (v_savings_pool_balance), never a stored
 * number; bucket balances are sums of movements. Moves out of a bucket
 * require a written reason; allocations do not. Movement history never
 * fabricates a reason: bucket-paid expenses are a distinct "spend" entry
 * with no quoted reason — only pool↔bucket moves show the user-typed
 * reason in quotes.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import { dollarsToCents, formatDate, formatMoney, formatMonth, monthKey } from '../lib/money';
import {
  getMonth,
  getSavingsPoolBalance,
  listProjections,
  listSavingsFundBalances,
  listSavingsFunds,
  listSavingsMovements,
} from '../lib/queries';
import {
  allocateToBucket,
  deactivateSavingsFund,
  insertSavingsFund,
  isSpendMovement,
  releaseFromBucket,
  renameSavingsFund,
} from '../lib/savings';
import { logAudit } from '../lib/queries';
import { resultError, useHousehold } from '../components/useBudget';
import { Bar, Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, SplitBar } from '../components/ui';
import type { SavingsFund, SavingsFundMovement } from '../lib/types';

export function SavingsScreen() {
  const { tokens } = useTheme();
  const { householdId, currency, dateFormat, loading: hhLoading, error: hhError } = useHousehold();
  const [loading, setLoading] = useState(true);
  // Only the first load shows the loading screen; later tab focuses refresh
  // silently in the background so the tab stays where you left it.
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [poolCents, setPoolCents] = useState(0);
  const [funds, setFunds] = useState<SavingsFund[]>([]);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [movements, setMovements] = useState<SavingsFundMovement[]>([]);
  const [plannedSavings, setPlannedSavings] = useState(0);
  const [selectedFund, setSelectedFund] = useState<SavingsFund | null>(null);
  const [addingFund, setAddingFund] = useState(false);
  const [fundName, setFundName] = useState('');
  const [fundTarget, setFundTarget] = useState('');

  const load = useCallback(async () => {
    if (!householdId) return;
    if (!hasLoaded.current) setLoading(true);
    setError(null);
    const month = monthKey(new Date());
    const [poolRes, fundsRes, balRes, movRes, monthRes] = await Promise.all([
      getSavingsPoolBalance(householdId),
      listSavingsFunds(householdId),
      listSavingsFundBalances(householdId),
      listSavingsMovements(householdId),
      getMonth(householdId, month),
    ]);
    if (poolRes.error) setError(poolRes.error);
    if (fundsRes.error) setError(fundsRes.error);
    setPoolCents(poolRes.data?.pool_cents ?? 0);
    setFunds((fundsRes.data ?? []).filter((f) => f.is_active));
    setBalances(new Map((balRes.data ?? []).map((b) => [b.fund_id, b.balance_cents])));
    setMovements(movRes.data ?? []);
    const m = monthRes.data;
    if (m) {
      const projRes = await listProjections(householdId, m.id);
      const projected = (projRes.data ?? []).reduce((s, p) => s + p.projected_cents, 0);
      setPlannedSavings(Math.round((projected * (m.projected_savings_pct ?? 0)) / 100));
    } else {
      setPlannedSavings(0);
    }
    hasLoaded.current = true;
    setLoading(false);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const totalInBuckets = useMemo(
    () => funds.reduce((s, f) => s + (balances.get(f.id) ?? 0), 0),
    [funds, balances],
  );
  const total = poolCents + totalInBuckets;

  const addFund = async () => {
    if (!householdId || !fundName.trim()) return;
    // target_pct is a share of total saved (0–100); there is no money-goal
    // column on savings_funds, so the money target is derived from the %.
    const pct = fundTarget.trim() ? Number(fundTarget.trim()) : null;
    if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
      setError('Target must be a percentage between 0 and 100.');
      return;
    }
    const res = await insertSavingsFund(fundName.trim(), pct, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setFundName('');
    setFundTarget('');
    setAddingFund(false);
    load();
  };

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
      <Text style={[styles.title, { color: tokens.ink }]}>Savings</Text>
      <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 4 }}>
        {formatMonth(monthKey(new Date()))} · this month&apos;s plan earmarks {formatMoney(plannedSavings, currency)} for savings
      </Text>
      <ErrorText message={error} />

      <Card>
        <CardTitle title="Total saved" right={formatMoney(total, currency)} />
        <SplitBar
          segments={[
            { value: totalInBuckets, color: tokens.brand },
            { value: poolCents, color: tokens.unallocated },
          ]}
        />
        <View style={styles.legend}>
          <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>In buckets {formatMoney(totalInBuckets, currency)}</Text>
          <Text style={{ color: tokens.ink2, fontSize: 12.5 }}>Waiting in the pool {formatMoney(poolCents, currency)}</Text>
        </View>
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
          Buckets are filled only from the pool — the pool is what&apos;s left after every bucket move.
        </Text>
      </Card>

      <Card>
        <CardTitle title="Unallocated pool" right={formatMoney(poolCents, currency)} />
        <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 18 }}>
          Savings you&apos;ve logged this month that isn&apos;t in a bucket yet. Move it into a bucket below.
        </Text>
        {poolCents <= 0 ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 8 }}>
            The pool is empty — log a Savings transaction first, or release money back from a bucket.
          </Text>
        ) : null}
      </Card>

      {funds.length === 0 ? (
        <Card>
          <EmptyState title="No buckets yet" body="Add a bucket below, then move pool money into it." />
        </Card>
      ) : (
        funds.map((f) => {
          const balance = balances.get(f.id) ?? 0;
          // Money target derived from the percentage: this bucket's share of
          // everything saved (pool + all buckets). No target_cents column exists.
          const targetAmount =
            f.target_pct != null && total > 0 ? Math.round((total * f.target_pct) / 100) : null;
          const pct = targetAmount && targetAmount > 0 ? Math.min(1, balance / targetAmount) : 0;
          return (
            <Pressable key={f.id} onPress={() => setSelectedFund(selectedFund?.id === f.id ? null : f)}>
              <Card>
                <View style={styles.bucketTop}>
                  <Text style={[styles.bucketName, { color: tokens.ink }]}>{f.name}</Text>
                  <Text style={{ color: tokens.ink, fontSize: 15, fontWeight: '700' }}>
                    {formatMoney(balance, currency)}
                  </Text>
                </View>
                {targetAmount ? (
                  <>
                    <Bar fill={pct} color={tokens.brand} />
                    <Text style={{ color: tokens.ink2, fontSize: 12.5, marginTop: 6 }}>
                      {Math.round(pct * 100)}% of {formatMoney(targetAmount, currency)} goal ({f.target_pct}% of total saved)
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 4 }}>No target set</Text>
                )}
                {selectedFund?.id === f.id ? (
                  <BucketDetail
                    fund={f}
                    balance={balance}
                    poolCents={poolCents}
                    movements={movements.filter((mv) => mv.fund_id === f.id)}
                    currency={currency}
                    dateFormat={dateFormat}
                    onDone={load}
                    onError={setError}
                  />
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}

      <Card>
        <CardTitle title="Add a bucket" />
        {addingFund ? (
          <>
            <TextInput
              placeholder="Bucket name"
              placeholderTextColor={tokens.ink3}
              value={fundName}
              onChangeText={setFundName}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Target % of total saved (optional, 0–100)"
              placeholderTextColor={tokens.ink3}
              value={fundTarget}
              onChangeText={(v) => setFundTarget(v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <PrimaryButton label="Add bucket" disabled={!fundName.trim()} onPress={addFund} />
            <Pressable onPress={() => setAddingFund(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => setAddingFund(true)} style={{ paddingVertical: 6 }}>
            <Text style={{ color: tokens.brand, fontWeight: '700' }}>+ Add a bucket</Text>
          </Pressable>
        )}
      </Card>

      <Card>
        <CardTitle title="Recent movement" />
        {movements.length === 0 ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 6 }}>No movements yet.</Text>
        ) : (
          movements.slice(0, 15).map((mv) => <MovementRow key={mv.id} mv={mv} funds={funds} currency={currency} dateFormat={dateFormat} />)
        )}
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function MovementRow({
  mv,
  funds,
  currency,
  dateFormat,
}: {
  mv: SavingsFundMovement;
  funds: SavingsFund[];
  currency: Parameters<typeof formatMoney>[1];
  dateFormat: Parameters<typeof formatDate>[1];
}) {
  const { tokens } = useTheme();
  const fundName = funds.find((f) => f.id === mv.fund_id)?.name ?? 'Bucket';
  // Spends are withdrawals with a linked transaction (there is no 'spend'
  // movement_type in the v2/v3 check constraint). Only user-initiated
  // releases carry a reason; spends never show one.
  const isSpend = isSpendMovement(mv);
  const label =
    mv.movement_type === 'allocation'
      ? `Pool → ${fundName}`
      : isSpend
        ? `Spent from ${fundName}`
        : mv.movement_type === 'withdrawal'
          ? `${fundName} → pool`
          : `Adjustment · ${fundName}`;
  return (
    <View style={[styles.moveRow, { borderTopColor: tokens.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>
          {formatDate(mv.created_at.slice(0, 10), dateFormat)}
          {mv.movement_type === 'withdrawal' && !isSpend && mv.reason ? ` · “${mv.reason}”` : ''}
          {isSpend ? ' · bucket-paid expense' : ''}
        </Text>
      </View>
      <Text style={{ color: mv.movement_type === 'allocation' ? tokens.brand : tokens.ink, fontSize: 14, fontWeight: '700' }}>
        {mv.amount_cents >= 0 ? '+' : '−'}
        {formatMoney(Math.abs(mv.amount_cents), currency)}
      </Text>
    </View>
  );
}

function BucketDetail({
  fund,
  balance,
  poolCents,
  movements,
  currency,
  dateFormat,
  onDone,
  onError,
}: {
  fund: SavingsFund;
  balance: number;
  poolCents: number;
  movements: SavingsFundMovement[];
  currency: Parameters<typeof formatMoney>[1];
  dateFormat: Parameters<typeof formatDate>[1];
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const { tokens } = useTheme();
  const [mode, setMode] = useState<'allocate' | 'release'>('allocate');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState(fund.name);

  const cents = dollarsToCents(amount);
  const max = mode === 'allocate' ? poolCents : balance;
  const reasonRequired = mode === 'release';
  const canMove =
    cents != null && cents > 0 && cents <= max && (!reasonRequired || reason.trim().length > 0) && !busy;

  const move = async () => {
    if (!canMove || cents == null) return;
    setBusy(true);
    setError(null);
    const res =
      mode === 'allocate'
        ? await allocateToBucket(fund.id, cents)
        : await releaseFromBucket(fund.id, cents, reason.trim());
    const err = resultError(res);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    await logAudit(
      mode === 'allocate' ? 'savings.allocated' : 'savings.released',
      'savings_fund_movements',
      fund.id,
      { fund: fund.name, amount_cents: cents, reason: mode === 'release' ? reason.trim() : null },
    ).catch(() => undefined);
    setAmount('');
    setReason('');
    setBusy(false);
    onDone();
  };

  const rename = async () => {
    if (!newName.trim()) return;
    const res = await renameSavingsFund(fund.id, newName.trim());
    const err = resultError(res);
    if (err) {
      onError(err);
      return;
    }
    onDone();
  };

  const deactivate = async () => {
    if (balance !== 0) {
      setError('Move the money out of this bucket before deactivating it.');
      return;
    }
    const res = await deactivateSavingsFund(fund.id);
    const err = resultError(res);
    if (err) {
      onError(err);
      return;
    }
    onDone();
  };

  return (
    <View style={{ marginTop: 12 }}>
      <View style={[styles.moveBox, { backgroundColor: tokens.surface2 }]}>
        <View style={styles.segRow}>
          <Pressable
            onPress={() => setMode('allocate')}
            style={[styles.segBtn, { backgroundColor: mode === 'allocate' ? tokens.surface : 'transparent' }]}
          >
            <Text style={{ color: mode === 'allocate' ? tokens.ink : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
              Move in (pool → bucket)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('release')}
            style={[styles.segBtn, { backgroundColor: mode === 'release' ? tokens.surface : 'transparent' }]}
          >
            <Text style={{ color: mode === 'release' ? tokens.ink : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
              Move out (bucket → pool)
            </Text>
          </Pressable>
        </View>
        <Text style={{ color: tokens.ink2, fontSize: 12.5, marginTop: 8 }}>
          Available: {formatMoney(max, currency)}
        </Text>
        <TextInput
          placeholder="Amount"
          placeholderTextColor={tokens.ink3}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
        />
        {reasonRequired ? (
          <TextInput
            placeholder="Reason (required — why is this money leaving the bucket?)"
            placeholderTextColor={tokens.ink3}
            value={reason}
            onChangeText={setReason}
            style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
          />
        ) : null}
        {cents != null && cents > max ? (
          <Text style={{ color: tokens.danger, fontSize: 13, marginTop: 6 }}>
            That&apos;s more than the {mode === 'allocate' ? 'pool' : 'bucket'} holds.
          </Text>
        ) : null}
        <ErrorText message={error} />
        <PrimaryButton
          label={busy ? 'Moving…' : mode === 'allocate' ? 'Move into bucket' : 'Move back to pool'}
          disabled={!canMove}
          onPress={move}
        />
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
          Spending from a bucket happens in the Add sheet (“Pay from savings?”) — it writes one linked
          transaction + movement pair.
        </Text>
      </View>

      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Movement history</Text>
      {movements.length === 0 ? (
        <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 6 }}>No movements for this bucket yet.</Text>
      ) : (
        movements.map((mv) => <MovementRow key={mv.id} mv={mv} funds={[fund]} currency={currency} dateFormat={dateFormat} />)
      )}

      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Rename bucket</Text>
      <TextInput value={newName} onChangeText={setNewName} style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]} />
      <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
        The target ({fund.target_pct ?? '—'}% of total saved) is set when the bucket is created.
      </Text>
      <PrimaryButton label="Save bucket name" onPress={rename} />
      <Pressable onPress={deactivate} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Text style={{ color: tokens.danger, fontWeight: '700' }}>Deactivate bucket</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bucketName: { fontSize: 15, fontWeight: '700' },
  bucketTop: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  container: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  moveBox: { borderRadius: 12, marginTop: 4, padding: 12 },
  moveRow: { borderTopWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 10 },
  segBtn: { alignItems: 'center', borderRadius: 8, flex: 1, paddingVertical: 8 },
  segRow: { flexDirection: 'row', gap: 4 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
});
