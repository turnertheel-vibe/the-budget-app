/**
 * Activity — the transaction log, newest first (spec §2.2).
 * Tap a row for the detail sheet: edit amount/label/account/merchant/
 * description/date, or delete. Edits and deletes write audit entries.
 * Open Items sit at the top when any exist; the Reimbursement Log is linked.
 * A parked charge can be deleted from its row: × arms a two-tap confirm,
 * "Delete?" removes it (audit-logged; it was never a transaction, so there
 * is nothing else to keep).
 */
import { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../navigation/AppNavigator';
import { useTheme } from '../theme';
import { dollarsToCents, formatDate, formatMoney, formatMonth, monthKey, todayIso } from '../lib/money';
import { supabase } from '../lib/supabase';
import {
  getMonth,
  listAccounts,
  listLabels,
  listOpenItems,
  listTransactions,
} from '../lib/queries';
import { deleteTransaction, updateTransaction } from '../lib/transactions';
import { logAudit } from '../lib/queries';
import { resultError, shiftMonth, useHousehold } from '../components/useBudget';
import { Bar, Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, RowButton } from '../components/ui';
import type { Account, Label, OpenItem, Transaction } from '../lib/types';

export function ActivityScreen() {
  const { tokens } = useTheme();
  const navigation = useNavigation<RootStackNavigation>();
  const { householdId, currency, dateFormat, loading: hhLoading, error: hhError } = useHousehold();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [loading, setLoading] = useState(true);
  // Tabs stay mounted, but every focus re-ran load() with a full-screen
  // LoadingView, which unmounted the list and reset the scroll to the top.
  // Only the first load shows the loading screen; later focuses refresh
  // silently in the background and the tab stays where you left it.
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [noMonth, setNoMonth] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [parking, setParking] = useState(false);
  const [parkDesc, setParkDesc] = useState('');
  const [parkAmount, setParkAmount] = useState('');
  const [parkDate, setParkDate] = useState(todayIso());
  const [parkBusy, setParkBusy] = useState(false);
  // Which parked charge is one tap into a two-tap delete (same idiom as the
  // transaction detail sheet's confirm delete).
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId) return;
    if (!hasLoaded.current) setLoading(true);
    setError(null);
    setConfirmDeleteItemId(null);
    const { data: m, error: mErr } = await getMonth(householdId, month);
    if (mErr) {
      setError(mErr);
      hasLoaded.current = true;
      setLoading(false);
      return;
    }
    const [labelsRes, accountsRes, openRes] = await Promise.all([
      listLabels(householdId),
      listAccounts(householdId),
      listOpenItems(householdId),
    ]);
    setLabels(labelsRes.data ?? []);
    setAccounts(accountsRes.data ?? []);
    setOpenItems(openRes.data ?? []);
    if (labelsRes.error) setError(labelsRes.error);
    if (!m) {
      setNoMonth(true);
      setTransactions([]);
      hasLoaded.current = true;
      setLoading(false);
      return;
    }
    setNoMonth(false);
    const { data, error: txErr } = await listTransactions(householdId, m.id);
    if (txErr) setError(txErr);
    setTransactions(data ?? []);
    hasLoaded.current = true;
    setLoading(false);
  }, [householdId, month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const parkItem = async () => {
    if (!householdId || !parkDesc.trim() || parkBusy) return;
    setParkBusy(true);
    const cents = dollarsToCents(parkAmount);
    const { error: err } = await supabase.from('open_items').insert({
      household_id: householdId,
      description: parkDesc.trim(),
      amount_cents: cents,
      item_date: parkDate,
      source: 'manual',
      status: 'open',
    });
    if (err) {
      setError(err.message);
      setParkBusy(false);
      return;
    }
    await logAudit('open_item.parked', 'open_items', null, { description: parkDesc.trim(), amount_cents: cents }).catch(() => undefined);
    setParkDesc('');
    setParkAmount('');
    setParking(false);
    setParkBusy(false);
    load();
  };

  // "Receipt in" does NOT resolve the charge — it opens the Add sheet
  // pre-filled from the parked charge so the receipt can be split into
  // labelled rows. The charge only closes once its full amount is split
  // (see AddTransactionScreen). Resolving here used to make the charge
  // vanish with no labelled rows ever created.
  const splitItem = (item: OpenItem) => {
    navigation.navigate('AddTransaction', {
      openItemId: item.id,
      openItemDescription: item.description,
      openItemAmountCents: item.amount_cents ?? undefined,
      openItemDate: item.item_date ?? undefined,
    });
  };

  // Delete a parked charge outright (it was never logged, so there is no
  // transaction to keep). Two taps: × arms the confirm, "Delete?" does it.
  // The audit log keeps the record, same as a deleted transaction.
  const deleteItem = async (item: OpenItem) => {
    const { error: err } = await supabase.from('open_items').delete().eq('id', item.id);
    if (err) {
      setError(err.message);
      return;
    }
    await logAudit('open_item.deleted', 'open_items', item.id, {
      description: item.description,
      amount_cents: item.amount_cents,
    }).catch(() => undefined);
    setConfirmDeleteItemId(null);
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

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const list = groups.get(t.txn_date) ?? [];
    list.push(t);
    groups.set(t.txn_date, list);
  }
  const sortedDates = [...groups.keys()].sort().reverse();

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.ink }]}>Activity</Text>
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

      {openItems.length > 0 ? (
        <Card>
          <CardTitle title="Open items" right="waiting on a receipt" />
          <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 18 }}>
            Parked charges stay unlabeled until the receipt shows up — then split them into labelled rows
            from the Add sheet. Never park a charge in a catch-all label.
          </Text>
          {openItems.map((item) => (
            <View key={item.id} style={[styles.openRow, { borderTopColor: tokens.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }}>{item.description}</Text>
                <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>
                  {item.item_date ? formatDate(item.item_date, dateFormat) : 'No date'}
                  {item.source ? ` · ${item.source}` : ''}
                </Text>
              </View>
              <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '700' }}>
                {item.amount_cents != null ? formatMoney(item.amount_cents, currency) : '—'}
              </Text>
              <Pressable onPress={() => splitItem(item)} style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}>
                <Text style={{ color: tokens.brand, fontSize: 12.5, fontWeight: '700' }}>Receipt in</Text>
              </Pressable>
              {confirmDeleteItemId === item.id ? (
                <Pressable onPress={() => deleteItem(item)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
                  <Text style={{ color: tokens.danger, fontSize: 12.5, fontWeight: '700' }}>Delete?</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityLabel={`Delete ${item.description}`}
                  onPress={() => setConfirmDeleteItemId(item.id)}
                  style={{ borderColor: tokens.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 }}
                >
                  <Text style={{ color: tokens.ink2, fontSize: 14, fontWeight: '700' }}>×</Text>
                </Pressable>
              )}
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <CardTitle title="Park a charge" />
        {parking ? (
          <>
            <TextInput
              placeholder="Store or description"
              placeholderTextColor={tokens.ink3}
              value={parkDesc}
              onChangeText={setParkDesc}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Amount (e.g. 42.50)"
              placeholderTextColor={tokens.ink3}
              value={parkAmount}
              onChangeText={setParkAmount}
              keyboardType="decimal-pad"
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Date (YYYY-MM-DD)"
              placeholderTextColor={tokens.ink3}
              value={parkDate}
              onChangeText={setParkDate}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <PrimaryButton label={parkBusy ? 'Parking…' : 'Park it'} disabled={!parkDesc.trim() || parkBusy} onPress={parkItem} />
            <Pressable onPress={() => setParking(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => setParking(true)} style={{ paddingVertical: 6 }}>
            <Text style={{ color: tokens.brand, fontWeight: '700' }}>
              + Park a charge while you wait on the receipt
            </Text>
          </Pressable>
        )}
      </Card>

      <RowButton
        title="Reimbursement Log"
        subtitle="Gross amounts, for taxes — refunds never appear here"
        onPress={() => navigation.navigate('ReimbursementLog')}
      />

      {noMonth ? (
        <Card>
          <EmptyState title="Nothing logged this month" body="No month row exists yet. Add a projected income source on the Plan tab, or log your first transaction." />
        </Card>
      ) : transactions.length === 0 ? (
        <Card>
          <EmptyState title="No transactions yet" body="Tap + to log your first transaction for this month." />
        </Card>
      ) : (
        sortedDates.map((date) => (
          <View key={date}>
            <Text style={[styles.dateHeader, { color: tokens.ink2 }]}>{formatDate(date, dateFormat)}</Text>
            <View style={[styles.group, { backgroundColor: tokens.surface, borderColor: tokens.line }]}>
              {groups.get(date)!.map((t) => (
                <TransactionRow key={t.id} t={t} currency={currency} onPress={() => setSelected(t)} />
              ))}
            </View>
          </View>
        ))
      )}
      <View style={{ height: 24 }} />

      <TransactionSheet
        transaction={selected}
        labels={labels}
        accounts={accounts}
        currency={currency}
        dateFormat={dateFormat}
        onClose={() => setSelected(null)}
        onSaved={() => {
          setSelected(null);
          load();
        }}
      />
    </ScrollView>
  );
}

function TransactionRow({
  t,
  currency,
  onPress,
}: {
  t: Transaction;
  currency: Parameters<typeof formatMoney>[1];
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const label = t.label;
  const negative = t.amount_cents < 0;
  return (
    <Pressable onPress={onPress} style={[styles.row, { borderTopColor: tokens.line }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }} numberOfLines={1}>
          {t.merchant || t.description}
        </Text>
        <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
          {[label?.label, t.account?.name].filter(Boolean).join(' · ') || 'No label'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 5 }}>
          {negative ? (
            <Text style={[styles.tag, { backgroundColor: tokens.dangerSoft, color: tokens.danger }]}>Negative</Text>
          ) : null}
          {t.kind !== 'standard' ? (
            <Text style={[styles.tag, { backgroundColor: tokens.surface2, color: tokens.ink2 }]}>{t.kind}</Text>
          ) : null}
        </View>
      </View>
      <Text style={{ color: negative ? tokens.danger : tokens.ink, fontSize: 14.5, fontWeight: '700' }}>
        {formatMoney(t.amount_cents, currency)}
      </Text>
    </Pressable>
  );
}

function TransactionSheet({
  transaction,
  labels,
  accounts,
  currency,
  dateFormat,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null;
  labels: Label[];
  accounts: Account[];
  currency: Parameters<typeof formatMoney>[1];
  dateFormat: Parameters<typeof formatDate>[1];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tokens } = useTheme();
  const [description, setDescription] = useState('');
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [labelId, setLabelId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form whenever a different transaction is opened.
  const [openedId, setOpenedId] = useState<string | null>(null);
  if (transaction && transaction.id !== openedId) {
    setOpenedId(transaction.id);
    setDescription(transaction.description);
    setMerchant(transaction.merchant ?? '');
    setAmount((Math.abs(transaction.amount_cents) / 100).toFixed(2));
    setDate(transaction.txn_date);
    setLabelId(transaction.label_id);
    setAccountId(transaction.account_id ?? '');
    setError(null);
    setConfirmDelete(false);
  }
  if (!transaction && openedId !== null) setOpenedId(null);

  if (!transaction) return null;

  const save = async () => {
    const cents = dollarsToCents(amount);
    if (cents == null || cents <= 0 || !labelId) {
      setError('Enter an amount above zero and pick a label.');
      return;
    }
    const signed = transaction.amount_cents < 0 ? -cents : cents;
    setBusy(true);
    setError(null);
    const patch: Record<string, unknown> = {
      description: description.trim() || transaction.description,
      merchant: merchant.trim() || null,
      amount_cents: signed,
      txn_date: date || transaction.txn_date,
      label_id: labelId,
      account_id: accountId || null,
    };
    const res = await updateTransaction(transaction.id, patch);
    const err = resultError(res);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    await logAudit('transaction.updated', 'transactions', transaction.id, {
      description: patch.description,
      amount_cents: signed,
    }).catch(() => undefined);
    setBusy(false);
    onSaved();
  };

  const remove = async () => {
    setBusy(true);
    const res = await deleteTransaction(transaction.id);
    const err = resultError(res);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    await logAudit('transaction.deleted', 'transactions', transaction.id, {
      description: transaction.description,
      amount_cents: transaction.amount_cents,
    }).catch(() => undefined);
    setBusy(false);
    onSaved();
  };

  return (
    <Modal visible={!!transaction} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.sheet}>
        <Text style={[styles.sheetTitle, { color: tokens.ink }]}>Transaction</Text>
        <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 4 }}>
          {formatDate(transaction.txn_date, dateFormat)} · {transaction.label?.label ?? 'No label'} ·{' '}
          {formatMoney(transaction.amount_cents, currency)}
          {transaction.amount_cents < 0 ? ' · Negative — the kind is derived, never chosen' : ''}
        </Text>

        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Description</Text>
        <TextInput value={description} onChangeText={setDescription} style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]} />
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Merchant</Text>
        <TextInput value={merchant} onChangeText={setMerchant} style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]} />
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Amount (absolute value; the +/− stays as logged)</Text>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]} />
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Date (YYYY-MM-DD)</Text>
        <TextInput value={date} onChangeText={setDate} style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]} />

        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Label</Text>
        <View style={{ gap: 6 }}>
          {labels
            .filter((l) => l.is_active)
            .map((l) => (
              <Pressable
                key={l.id}
                onPress={() => setLabelId(l.id)}
                style={[styles.pick, { backgroundColor: labelId === l.id ? tokens.brandSoft : tokens.surface, borderColor: tokens.line }]}
              >
                <Text style={{ color: labelId === l.id ? tokens.brand : tokens.ink, fontWeight: '600' }}>
                  {l.label} · {l.section}
                </Text>
              </Pressable>
            ))}
        </View>

        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Account</Text>
        <View style={{ gap: 6 }}>
          {accounts
            .filter((a) => a.is_active)
            .map((a) => (
              <Pressable
                key={a.id}
                onPress={() => setAccountId(a.id)}
                style={[styles.pick, { backgroundColor: accountId === a.id ? tokens.brandSoft : tokens.surface, borderColor: tokens.line }]}
              >
                <Text style={{ color: accountId === a.id ? tokens.brand : tokens.ink, fontWeight: '600' }}>
                  {a.name}
                  {a.last_four ? ` ··${a.last_four}` : ''}
                </Text>
              </Pressable>
            ))}
        </View>

        <ErrorText message={error} />
        <PrimaryButton label={busy ? 'Saving…' : 'Save changes'} disabled={busy} onPress={save} />
        {confirmDelete ? (
          <PrimaryButton label="Tap again to confirm delete" danger onPress={remove} />
        ) : (
          <Pressable onPress={() => setConfirmDelete(true)} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ color: tokens.danger, fontWeight: '700' }}>Delete transaction</Text>
          </Pressable>
        )}
        <Pressable onPress={onClose} style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Close</Text>
        </Pressable>
        <View style={{ height: 32 }} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  dateHeader: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginTop: 16, textTransform: 'uppercase' },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  group: { borderRadius: 14, borderWidth: 1, marginTop: 6, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 6, paddingHorizontal: 12, paddingVertical: 10 },
  navBtn: { alignItems: 'center', borderRadius: 10, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  navRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  openRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 10, marginTop: 10, paddingTop: 10 },
  pick: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  sheet: { padding: 20 },
  sheetTitle: { fontSize: 22, fontWeight: '800' },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tag: { borderRadius: 6, fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
});
