/**
 * Add Transaction — modal sheet (spec §2.4).
 *
 * Keypad, a single +/− toggle, section control, Most-recent label picker,
 * and "Pay from savings?" yes/no (default No). The transaction kind is
 * app-derived on save by insertTransaction, never user-chosen:
 * - negative on an Expense label + note starting REIMB → reimbursement
 * - negative on an Expense label + note starting REFUND → refund
 * - negative on an Income label → repayment
 * - negative on an Expense label with no prefix → insertTransaction
 *   auto-prefixes "REIMB " to the description (documented assumption,
 *   flagged for Turner to confirm — see the note under the save button).
 * A bucket-paid expense is saved in one call — insertTransaction({fundId})
 * writes the linked transaction + movement pair, so the movement carries
 * the transaction_id and is removed if the transaction is deleted.
 *
 * Date is November 2026 only for now (the app's first month); the UI says so.
 *
 * Split mode (opened from a parked charge): the sheet becomes a split
 * builder — add one labelled amount at a time, see what is categorised and
 * what is left, then save all rows at once. The charge closes only when the
 * rows cover its full amount. No +/− toggle in split mode: rows are positive
 * allocations of the charge, and a row can never exceed what is left.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../theme';
import { formatDate, formatMoney, todayIso } from '../lib/money';
import { supabase } from '../lib/supabase';
import { getMonth, listAccounts, listLabels, listSavingsFundBalances, listSavingsFunds } from '../lib/queries';
import { insertTransaction } from '../lib/transactions';
import { logAudit } from '../lib/queries';
import { resultData, resultError, useHousehold } from '../components/useBudget';
import { EmptyState, ErrorText, LoadingView, SegControl } from '../components/ui';
import type { Account, Label, LabelSection, SavingsFund } from '../lib/types';

const SECTIONS: LabelSection[] = ['Expense', 'Income', 'Savings'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
const NOVEMBER_2026 = '2026-11-01';

export function AddTransactionScreen() {
  const { tokens } = useTheme();
  const navigation = useNavigation();
  // Opened from a parked (open) charge, the sheet is pre-filled from it and
  // saving applies the row against the charge (see save below). A parked
  // charge only closes once its full amount has been split into labelled
  // rows — "Receipt in" never resolves it by itself.
  const route = useRoute<RouteProp<RootStackParamList, 'AddTransaction'>>();
  const openItem = route.params;
  const { householdId, currency, dateFormat, prefs, loading: hhLoading, error: hhError } = useHousehold();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthId, setMonthId] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [funds, setFunds] = useState<SavingsFund[]>([]);
  const [fundBalances, setFundBalances] = useState<Map<string, number>>(new Map());
  const [recentLabelIds, setRecentLabelIds] = useState<string[]>([]);

  const [digits, setDigits] = useState(() =>
    openItem?.openItemAmountCents != null ? String(openItem.openItemAmountCents / 100) : '',
  );
  const [negative, setNegative] = useState(false);
  const [section, setSection] = useState<LabelSection>('Expense');
  const [labelId, setLabelId] = useState('');
  const [labelSearch, setLabelSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [payFromSavings, setPayFromSavings] = useState(false);
  const [fundId, setFundId] = useState('');
  const [merchant, setMerchant] = useState(openItem?.openItemDescription ?? '');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState('');
  const [day, setDay] = useState(() => {
    if (openItem?.openItemDate?.startsWith('2026-11-')) return Number(openItem.openItemDate.slice(8, 10));
    const today = todayIso();
    return today.startsWith('2026-11-') ? Number(today.slice(8, 10)) : 24;
  });
  const [busy, setBusy] = useState(false);

  // Split builder (only when opened from a parked charge): the user adds one
  // labelled amount at a time and saves them all in one sitting. splitRows
  // holds the rows built so far; the draft (amount + label + bucket) is the
  // same form as a normal transaction, reset after each row is added.
  type SplitRow = { id: number; labelId: string; label: string; cents: number; fundId: string | null; fundName: string | null };
  const [splitRows, setSplitRows] = useState<SplitRow[]>([]);
  const [splitSeq, setSplitSeq] = useState(0);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    const [monthRes, labelsRes, accountsRes, fundsRes, balRes] = await Promise.all([
      getMonth(householdId, NOVEMBER_2026),
      listLabels(householdId),
      listAccounts(householdId),
      listSavingsFunds(householdId),
      listSavingsFundBalances(householdId),
    ]);
    if (monthRes.error) setError(monthRes.error);
    setMonthId(monthRes.data?.id ?? null);
    setLabels((labelsRes.data ?? []).filter((l) => l.is_active));
    const accts = (accountsRes.data ?? []).filter((a) => a.is_active);
    setAccounts(accts);
    setAccountId(prefs?.default_account_id ?? accts[0]?.id ?? '');
    setFunds((fundsRes.data ?? []).filter((f) => f.is_active));
    setFundBalances(new Map((balRes.data ?? []).map((b) => [b.fund_id, b.balance_cents])));
    // Most-recent ranking: usage count desc, most recent use breaking ties.
    const { data: history } = await supabase
      .from('transactions')
      .select('label_id, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(500);
    const counts = new Map<string, { count: number; last: string }>();
    for (const row of (history ?? []) as { label_id: string; created_at: string }[]) {
      const entry = counts.get(row.label_id) ?? { count: 0, last: row.created_at };
      entry.count += 1;
      counts.set(row.label_id, entry);
    }
    setRecentLabelIds(
      [...counts.entries()]
        .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last))
        .map(([id]) => id),
    );
    setLoading(false);
  }, [householdId, prefs?.default_account_id]);

  useEffect(() => {
    load();
  }, [load]);

  const cents = Math.round((Number.parseFloat(digits || '0') || 0) * 100);
  const signedCents = negative ? -cents : cents;
  const dateIso = `2026-11-${String(day).padStart(2, '0')}`;

  // Split-mode derived values. splitTarget is the parked charge's amount as
  // opened (the sheet's pre-fill); splitLeft is what is still uncategorised.
  const isSplit = !!openItem?.openItemId;
  const splitTarget = openItem?.openItemAmountCents ?? 0;
  const splitTotal = splitRows.reduce((sum, r) => sum + r.cents, 0);
  const splitLeft = Math.max(0, splitTarget - splitTotal);
  // Money already promised to a bucket by rows in this split, so the draft
  // row's bucket check uses what the bucket still has free.
  const fundCommitted = splitRows
    .filter((r) => r.fundId && r.fundId === fundId)
    .reduce((sum, r) => sum + r.cents, 0);
  const selectedLabel = labels.find((l) => l.id === labelId) ?? null;
  const selectedFund = funds.find((f) => f.id === fundId) ?? null;
  // Free balance for the draft row: the bucket's balance less what this
  // split's earlier rows already promised to it (0 outside split mode).
  const fundBalance = fundId ? (fundBalances.get(fundId) ?? 0) - fundCommitted : 0;

  // Switching section, going negative, or answering No clears the bucket choice.
  const chooseSection = (s: LabelSection) => {
    setSection(s);
    setLabelId('');
    setPayFromSavings(false);
    setFundId('');
  };
  // Picking a label clears the search box: the pick stays visible as the
  // Selected row, and the list below stops claiming "No labels match" for a
  // query whose only match is the label just picked.
  const pickLabel = (id: string) => {
    setLabelId(id);
    setLabelSearch('');
  };
  const toggleNegative = () => {
    setNegative((n) => !n);
    setPayFromSavings(false);
    setFundId('');
  };

  const sectionLabels = useMemo(
    () => labels.filter((l) => l.section === section),
    [labels, section],
  );
  const searching = labelSearch.trim().length > 0;
  const recent = useMemo(() => {
    if (searching) return [];
    return recentLabelIds
      .map((id) => sectionLabels.find((l) => l.id === id))
      .filter((l): l is Label => !!l)
      .slice(0, 5);
  }, [recentLabelIds, sectionLabels, searching]);
  const recentIds = new Set(recent.map((l) => l.id));
  // Type-to-filter: the full label list never renders. Typing filters to matching
  // labels (flat list, no category groups); the selected label is excluded here
  // because it is shown as the Selected row above.
  const filtered = useMemo(() => {
    if (!searching) return [];
    const q = labelSearch.trim().toLowerCase();
    return sectionLabels.filter((l) => l.id !== labelId && l.label.toLowerCase().includes(q));
  }, [sectionLabels, searching, labelSearch, labelId]);

  const bucketShort = payFromSavings && cents > 0 && fundId && cents > fundBalance;
  const canSave =
    cents > 0 &&
    !!labelId &&
    !!monthId &&
    !busy &&
    (!payFromSavings || !!fundId) &&
    !bucketShort;
  // Split mode: the draft row must fit in what's left of the charge, and the
  // split saves once at least one row is built.
  const canAddRow = isSplit && canSave && cents <= splitLeft;
  const canSaveSplit = isSplit && splitRows.length > 0 && !!monthId && !busy;

  const pressKey = (key: string) => {
    if (key === 'back') {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    if (key === '.' && digits.includes('.')) return;
    const next = digits + key;
    const [, frac] = next.split('.');
    if (frac !== undefined && frac.length > 2) return;
    setDigits(next);
  };

  // Split builder actions. A row captures the draft's label, amount and
  // bucket; adding it resets the draft (amount + label + bucket) so the next
  // row starts clean, while merchant / date / account stay shared.
  const addSplitRow = () => {
    if (!canAddRow || !selectedLabel) return;
    const id = splitSeq + 1;
    setSplitSeq(id);
    setSplitRows((rows) => [
      ...rows,
      {
        id,
        labelId: selectedLabel.id,
        label: selectedLabel.label,
        cents,
        fundId: payFromSavings ? fundId : null,
        fundName: payFromSavings ? (selectedFund?.name ?? null) : null,
      },
    ]);
    setDigits('');
    setLabelId('');
    setLabelSearch('');
    setPayFromSavings(false);
    setFundId('');
  };
  const removeSplitRow = (id: number) => {
    setSplitRows((rows) => rows.filter((r) => r.id !== id));
  };

  // Saves every built row as its own transaction, then applies the total
  // against the parked charge once. The charge closes only when the rows
  // cover its full amount; a partial split leaves it open with the rest.
  const saveSplit = async () => {
    if (!householdId || !monthId || !openItem?.openItemId || !canSaveSplit) return;
    setBusy(true);
    setError(null);
    const description = note.trim() || merchant.trim();
    let saved = 0;
    for (const row of splitRows) {
      const res = await insertTransaction({
        householdId,
        month: NOVEMBER_2026,
        description: description || row.label,
        merchant: merchant.trim() || null,
        txnDate: dateIso,
        amountCents: row.cents,
        labelId: row.labelId,
        accountId: accountId || null,
        source: 'manual',
        receiptRef: receipt.trim() || null,
        fundId: row.fundId,
      });
      const err = resultError(res);
      if (err) {
        setError(saved === 0 ? err : `${saved} of ${splitRows.length} rows saved, then: ${err}`);
        setBusy(false);
        return;
      }
      const inserted = resultData<{ id?: string; description?: string; kind?: string }>(res);
      await logAudit('transaction.created', 'transactions', inserted?.id ?? null, {
        description: inserted?.description ?? row.label,
        amount_cents: row.cents,
        kind: inserted?.kind ?? null,
        label: row.label,
        from_bucket: row.fundName,
      }).catch(() => undefined);
      saved += 1;
    }
    const { data: item } = await supabase
      .from('open_items')
      .select('amount_cents')
      .eq('id', openItem.openItemId)
      .maybeSingle();
    const remaining = (item?.amount_cents ?? splitTotal) - splitTotal;
    if (remaining <= 0) {
      await supabase
        .from('open_items')
        .update({ status: 'resolved', resolution_notes: 'Split into labelled rows from the Add sheet.' })
        .eq('id', openItem.openItemId);
      await logAudit('open_item.resolved', 'open_items', openItem.openItemId, {
        description: openItem.openItemDescription ?? null,
      }).catch(() => undefined);
    } else {
      await supabase
        .from('open_items')
        .update({ amount_cents: remaining })
        .eq('id', openItem.openItemId);
      await logAudit('open_item.split', 'open_items', openItem.openItemId, {
        description: openItem.openItemDescription ?? null,
        amount_cents: remaining,
      }).catch(() => undefined);
    }
    setBusy(false);
    navigation.goBack();
  };

  const save = async () => {
    if (!householdId || !monthId || !selectedLabel || !canSave) return;
    setBusy(true);
    setError(null);
    // Description is the note the user typed (or the merchant, or the label).
    // insertTransaction derives the kind itself (REIMB → reimbursement,
    // REFUND → refund, income negative → repayment; an unmarked negative
    // expense entry is auto-prefixed REIMB there) and writes the linked
    // reimbursement-log row and receipt reference.
    const description = note.trim() || merchant.trim() || selectedLabel.label;
    // One call writes the linked transaction + movement pair when a bucket
    // pays: fundId in the input links the movement to the transaction, so
    // deleting the transaction removes the movement too. Never call
    // spendFromBucket separately here — that would leave the movement unlinked.
    const res = await insertTransaction({
      householdId,
      month: NOVEMBER_2026,
      description,
      merchant: merchant.trim() || null,
      txnDate: dateIso,
      amountCents: signedCents,
      labelId: selectedLabel.id,
      accountId: accountId || null,
      source: 'manual',
      receiptRef: receipt.trim() || null,
      fundId: payFromSavings ? fundId : null,
    });
    const err = resultError(res);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    const inserted = resultData<{ id?: string; description?: string; kind?: string }>(res);
    await logAudit('transaction.created', 'transactions', inserted?.id ?? null, {
      description: inserted?.description ?? description,
      amount_cents: signedCents,
      kind: inserted?.kind ?? null,
      label: selectedLabel.label,
      from_bucket: payFromSavings ? selectedFund?.name ?? null : null,
    }).catch(() => undefined);
    // Splitting a parked charge: apply this row against it. The charge stays
    // open with the remainder until the full amount is split, then it closes.
    // A negative row (reimbursement/refund/repayment) never counts against it.
    if (openItem?.openItemId && signedCents > 0) {
      const { data: item } = await supabase
        .from('open_items')
        .select('amount_cents')
        .eq('id', openItem.openItemId)
        .maybeSingle();
      const remaining = (item?.amount_cents ?? signedCents) - signedCents;
      if (remaining <= 0) {
        await supabase
          .from('open_items')
          .update({ status: 'resolved', resolution_notes: 'Split into labelled rows from the Add sheet.' })
          .eq('id', openItem.openItemId);
        await logAudit('open_item.resolved', 'open_items', openItem.openItemId, {
          description: openItem.openItemDescription ?? null,
        }).catch(() => undefined);
      } else {
        await supabase
          .from('open_items')
          .update({ amount_cents: remaining })
          .eq('id', openItem.openItemId);
        await logAudit('open_item.split', 'open_items', openItem.openItemId, {
          description: openItem.openItemDescription ?? null,
          amount_cents: remaining,
        }).catch(() => undefined);
      }
    }
    setBusy(false);
    navigation.goBack();
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
      <View style={styles.amountRow}>
        {!isSplit ? (
          <Pressable
            accessibilityLabel="Make amount negative"
            accessibilityState={{ selected: negative }}
            onPress={toggleNegative}
            style={[styles.signToggle, { borderColor: tokens.line, backgroundColor: negative ? tokens.dangerSoft : tokens.surface }]}
          >
            <Text style={{ color: negative ? tokens.danger : tokens.ink, fontSize: 18, fontWeight: '700' }}>+/−</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.amount, { color: negative ? tokens.danger : tokens.ink }]}>
          {formatMoney(signedCents, currency)}
        </Text>
      </View>
      <Text style={[styles.hint, { color: tokens.ink2 }]}>
        {isSplit
          ? 'Add a labelled row for part of the charge, then the next — the sheet tracks what is left.'
          : negative
            ? 'Negative entry — the app derives its kind from the label and note on save (REIMB → reimbursement, REFUND → refund, income → repayment).'
            : 'Enter the amount, pick a label, save.'}
      </Text>

      {openItem?.openItemId ? (
        <View style={{ backgroundColor: tokens.brandSoft, borderRadius: 10, marginTop: 12, padding: 12 }}>
          <Text style={{ color: tokens.ink, fontSize: 13.5, fontWeight: '700' }}>
            Splitting a parked charge — {openItem.openItemDescription ?? 'Parked charge'}
          </Text>
          <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
            {formatMoney(splitTotal, currency)} categorised of {formatMoney(splitTarget, currency)} ·{' '}
            {splitLeft > 0 ? `${formatMoney(splitLeft, currency)} left to split.` : 'Fully split — save to close the charge.'}
          </Text>
          <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
            Add rows below and save them all at once. Saving less than the full amount keeps the charge open
            with the rest, so you can finish it later.
          </Text>
          {splitRows.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {splitRows.map((row) => (
                <View
                  key={row.id}
                  style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}
                >
                  <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600', flex: 1 }}>
                    {row.label}
                    {row.fundName ? ` · from ${row.fundName}` : ''}
                  </Text>
                  <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600', marginRight: 10 }}>
                    {formatMoney(row.cents, currency)}
                  </Text>
                  <Pressable
                    accessibilityLabel={`Remove ${row.label} row`}
                    onPress={() => removeSplitRow(row.id)}
                    style={{ borderColor: tokens.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 }}
                  >
                    <Text style={{ color: tokens.ink2, fontSize: 14, fontWeight: '700' }}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ marginTop: 12 }}>
        <SegControl options={SECTIONS} value={section} onChange={chooseSection} />
      </View>

      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Label</Text>
      <TextInput
        placeholder="Search labels…"
        placeholderTextColor={tokens.ink3}
        value={labelSearch}
        onChangeText={setLabelSearch}
        style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />
      {recent.length > 0 ? (
        <View>
          <Text style={[styles.groupLabel, { color: tokens.ink2 }]}>Most recent</Text>
          {recent.map((l) => (
            <LabelRow key={l.id} label={l} selected={labelId === l.id} onPress={() => pickLabel(l.id)} />
          ))}
        </View>
      ) : null}
      {selectedLabel && !recentIds.has(selectedLabel.id) ? (
        <View>
          <Text style={[styles.groupLabel, { color: tokens.ink2 }]}>Selected</Text>
          <LabelRow label={selectedLabel} selected onPress={() => pickLabel(selectedLabel.id)} />
        </View>
      ) : null}
      {searching ? (
        filtered.length === 0 ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 8 }}>No labels match that search.</Text>
        ) : (
          filtered.map((l) => (
            <LabelRow key={l.id} label={l} selected={labelId === l.id} onPress={() => pickLabel(l.id)} />
          ))
        )
      ) : labels.length === 0 ? (
        <EmptyState title="No labels yet" body="Add a label from the Chart of accounts first." />
      ) : recent.length === 0 && !selectedLabel ? (
        <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 8 }}>Type above to search all labels.</Text>
      ) : null}
      {isSplit ? (
        <View>
          <Pressable
            disabled={!canAddRow}
            onPress={addSplitRow}
            style={[styles.saveButton, { backgroundColor: canAddRow ? tokens.brand : tokens.unallocated, marginTop: 12 }]}
          >
            <Text style={[styles.saveText, { color: tokens.brandInk }]}>
              {selectedLabel && cents > 0
                ? `Add ${formatMoney(cents, currency)} · ${selectedLabel.label}`
                : 'Add this row to the split'}
            </Text>
          </Pressable>
          {!!selectedLabel && cents > splitLeft ? (
            <Text style={{ color: tokens.danger, fontSize: 13, marginTop: 8 }}>
              That is more than the {formatMoney(splitLeft, currency)} left to split — lower the amount first.
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Account</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {accounts.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => setAccountId(a.id)}
            style={[styles.chip, { backgroundColor: accountId === a.id ? tokens.brand : tokens.surface2 }]}
          >
            <Text style={{ color: accountId === a.id ? tokens.brandInk : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
              {a.name}
              {a.last_four ? ` ··${a.last_four}` : ''}
            </Text>
          </Pressable>
        ))}
        {accounts.length === 0 ? <Text style={{ color: tokens.ink3, fontSize: 13 }}>No accounts yet.</Text> : null}
      </View>

      <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Date — November 2026 only for now</Text>
      <View style={styles.dateRow}>
        <Pressable
          disabled={day <= 1}
          onPress={() => setDay((d) => Math.max(1, d - 1))}
          style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}
        >
          <Text style={{ color: tokens.ink, fontSize: 18 }}>‹</Text>
        </Pressable>
        <Text style={{ color: tokens.ink, fontSize: 15, fontWeight: '700' }}>{formatDate(dateIso, dateFormat)}</Text>
        <Pressable
          disabled={day >= 30}
          onPress={() => setDay((d) => Math.min(30, d + 1))}
          style={[styles.navBtn, { borderColor: tokens.line, backgroundColor: tokens.surface }]}
        >
          <Text style={{ color: tokens.ink, fontSize: 18 }}>›</Text>
        </Pressable>
      </View>
      <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
        The app starts with November 2026 — month navigation for other months comes with the next pass.
      </Text>

      {section === 'Expense' && !negative ? (
        <View style={[styles.savingsBox, { backgroundColor: tokens.surface, borderColor: tokens.line }]}>
          <View style={styles.savingsTop}>
            <Text style={[styles.savingsLabel, { color: tokens.ink }]}>Pay from savings?</Text>
            <View style={[styles.seg, { backgroundColor: tokens.surface2 }]}>
              {(['No', 'Yes'] as const).map((choice) => {
                const on = (choice === 'Yes') === payFromSavings;
                return (
                  <Pressable
                    key={choice}
                    onPress={() => {
                      setPayFromSavings(choice === 'Yes');
                      if (choice === 'No') setFundId('');
                    }}
                    style={[styles.segButton, on && { backgroundColor: tokens.brand }]}
                  >
                    <Text style={{ color: on ? tokens.brandInk : tokens.ink2, fontWeight: '600' }}>{choice}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {payFromSavings ? (
            <View style={{ marginTop: 10 }}>
              {funds.length === 0 ? (
                <Text style={{ color: tokens.ink3, fontSize: 13 }}>
                  No bucket has money yet — move pool money into a bucket on the Savings tab first, or switch
                  “Pay from savings?” back to No.
                </Text>
              ) : (
                funds.map((f) => (
                  <Pressable
                    key={f.id}
                    onPress={() => setFundId(f.id)}
                    style={[styles.bucketRow, { backgroundColor: fundId === f.id ? tokens.brandSoft : tokens.surface, borderColor: tokens.line }]}
                  >
                    <Text style={{ color: fundId === f.id ? tokens.brand : tokens.ink, fontWeight: '600', flex: 1 }}>
                      {f.name}
                    </Text>
                    <Text style={{ color: tokens.ink2, fontSize: 13, fontWeight: '600' }}>
                      {formatMoney(fundBalances.get(f.id) ?? 0, currency)}
                    </Text>
                  </Pressable>
                ))
              )}
              {bucketShort ? (
                <Text style={{ color: tokens.danger, fontSize: 13, marginTop: 8 }}>
                  That bucket holds {formatMoney(fundBalance, currency)} — less than this expense.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <TextInput
        placeholder="Merchant (optional)"
        placeholderTextColor={tokens.ink3}
        value={merchant}
        onChangeText={setMerchant}
        style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />
      <TextInput
        placeholder={isSplit ? 'Note (optional) — applies to every row in this split' : 'Note (optional) — start with REIMB or REFUND for a negative expense entry'}
        placeholderTextColor={tokens.ink3}
        value={note}
        onChangeText={setNote}
        style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />
      <TextInput
        placeholder="Receipt filename (optional) — the app stores the reference only, never the file"
        placeholderTextColor={tokens.ink3}
        value={receipt}
        onChangeText={setReceipt}
        autoCapitalize="none"
        style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />

      <View style={styles.keypad}>
        {KEYS.map((key) => (
          <Pressable key={key} onPress={() => pressKey(key)} style={[styles.key, { backgroundColor: tokens.surface }]}>
            <Text style={[styles.keyText, { color: tokens.ink }]}>{key === 'back' ? '⌫' : key}</Text>
          </Pressable>
        ))}
      </View>

      {!monthId ? (
        <Text style={{ color: tokens.danger, fontSize: 13, marginTop: 10 }}>
          There is no November 2026 month row yet — add a projected income source on the Plan tab first.
        </Text>
      ) : null}
      {payFromSavings && !fundId ? (
        <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 10 }}>
          Choose which bucket pays for this — or switch “Pay from savings?” back to No.
        </Text>
      ) : null}
      <Pressable
        disabled={isSplit ? !canSaveSplit : !canSave}
        onPress={isSplit ? saveSplit : save}
        style={[
          styles.saveButton,
          { backgroundColor: (isSplit ? canSaveSplit : canSave) ? tokens.brand : tokens.unallocated },
        ]}
      >
        <Text style={[styles.saveText, { color: tokens.brandInk }]}>
          {busy
            ? 'Saving…'
            : isSplit
              ? splitRows.length === 0
                ? 'Save split'
                : `Save split · ${splitRows.length} row${splitRows.length === 1 ? '' : 's'} · ${formatMoney(splitTotal, currency)}`
              : 'Save transaction'}
        </Text>
      </Pressable>
      {!isSplit ? (
        <Text style={{ color: tokens.ink3, fontSize: 12, lineHeight: 17, marginTop: 8, textAlign: 'center' }}>
          Assumption to confirm with Turner: a negative expense entry with no REIMB/REFUND note is saved as a
          reimbursement, with “REIMB ” added to its description.
        </Text>
      ) : null}
      <ErrorText message={error} />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function LabelRow({ label, selected, onPress }: { label: Label; selected: boolean; onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.labelRow,
        { backgroundColor: selected ? tokens.brandSoft : tokens.surface, borderColor: tokens.line },
      ]}
    >
      <Text style={{ color: selected ? tokens.brand : tokens.ink, fontWeight: '600', flex: 1 }}>{label.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 40, fontWeight: '800', letterSpacing: -0.5 },
  amountRow: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  bucketRow: { borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 6, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  container: { flex: 1, padding: 16 },
  dateRow: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 16 },
  groupLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginTop: 14, textTransform: 'uppercase' },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10 },
  key: { alignItems: 'center', borderRadius: 10, flexBasis: '31.5%', justifyContent: 'center', paddingVertical: 12 },
  keyText: { fontSize: 22, fontWeight: '600' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', marginTop: 14 },
  labelRow: { borderRadius: 10, borderWidth: 1, flexDirection: 'row', marginTop: 6, paddingHorizontal: 12, paddingVertical: 10 },
  navBtn: { alignItems: 'center', borderRadius: 10, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  saveButton: { alignItems: 'center', borderRadius: 12, marginTop: 14, paddingVertical: 14 },
  saveText: { fontSize: 16, fontWeight: '700' },
  savingsBox: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 12 },
  savingsLabel: { fontSize: 15, fontWeight: '700' },
  savingsTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  seg: { borderRadius: 10, flexDirection: 'row', padding: 3 },
  segButton: { alignItems: 'center', borderRadius: 8, flex: 1, paddingHorizontal: 14, paddingVertical: 8 },
  signToggle: { alignItems: 'center', borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', width: 52 },
});
