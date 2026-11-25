/**
 * Accounts & statement names (spec §2.8).
 * Account list (name, last 4, type, note) with add/edit/remove; descriptor
 * mappings (statement text → resolves to) with add/remove. Mappings are
 * what the twice-monthly statements reconciliation flow matches against.
 */
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import { listAccounts, listDescriptorMappings } from '../lib/queries';
import {
  deleteDescriptorMapping,
  insertAccount,
  insertDescriptorMapping,
  updateAccount,
} from '../lib/reference';
import { resultError, useHousehold } from '../components/useBudget';
import { Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, SegControl } from '../components/ui';
import type { Account, AccountType, DescriptorMapping } from '../lib/types';

export function AccountsScreen() {
  const { tokens } = useTheme();
  const { householdId, loading: hhLoading, error: hhError } = useHousehold();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<DescriptorMapping[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [type, setType] = useState<AccountType>('credit');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<Account | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [addingMapping, setAddingMapping] = useState(false);
  const [statementText, setStatementText] = useState('');
  const [resolvesTo, setResolvesTo] = useState('');

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    const [aRes, mRes] = await Promise.all([listAccounts(householdId), listDescriptorMappings(householdId)]);
    if (aRes.error) setError(aRes.error);
    if (mRes.error) setError(mRes.error);
    setAccounts(aRes.data ?? []);
    setMappings(mRes.data ?? []);
    setLoading(false);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const addAccount = async () => {
    if (!householdId || !name.trim()) {
      setError('Account name is required.');
      return;
    }
    const res = await insertAccount({
      name: name.trim(),
      lastFour: lastFour.trim() || null,
      accountType: type,
      notes: notes.trim() || null,
      householdId,
    });
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setName('');
    setLastFour('');
    setNotes('');
    setAdding(false);
    load();
  };

  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    const res = await updateAccount(editing.id, { name: editName.trim(), notes: editNotes.trim() || null }, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setEditing(null);
    load();
  };

  const removeAccount = async (a: Account) => {
    // Deactivate, never hard-delete — history keeps resolving.
    const res = await updateAccount(a.id, { isActive: false }, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    load();
  };

  const restoreAccount = async (a: Account) => {
    const res = await updateAccount(a.id, { isActive: true }, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    load();
  };

  const addMapping = async () => {
    if (!householdId || !statementText.trim() || !resolvesTo.trim()) {
      setError('Statement text and what it resolves to are both required.');
      return;
    }
    const res = await insertDescriptorMapping(statementText.trim(), resolvesTo.trim(), householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setStatementText('');
    setResolvesTo('');
    setAddingMapping(false);
    load();
  };

  const removeMapping = async (m: DescriptorMapping) => {
    const res = await deleteDescriptorMapping(m.id, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
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
      <Text style={[styles.title, { color: tokens.ink }]}>Accounts &amp; statement names</Text>
      <ErrorText message={error} />

      <Card>
        <CardTitle title="Accounts" />
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet" body="Add the accounts statements come from." />
        ) : (
          accounts.map((a) => (
            <View key={a.id} style={[styles.row, { borderTopColor: tokens.line }]}>
              {editing?.id === a.id ? (
                <View style={{ flex: 1 }}>
                  <TextInput value={editName} onChangeText={setEditName} style={[styles.inlineInput, { color: tokens.ink, borderColor: tokens.line }]} />
                  <TextInput
                    value={editNotes}
                    onChangeText={setEditNotes}
                    placeholder="Note"
                    placeholderTextColor={tokens.ink3}
                    style={[styles.inlineInput, { color: tokens.ink, borderColor: tokens.line }]}
                  />
                  <View style={styles.rowActions}>
                    <Pressable onPress={saveEdit} style={[styles.smallBtn, { backgroundColor: tokens.brand }]}>
                      <Text style={{ color: tokens.brandInk, fontWeight: '700', fontSize: 13 }}>Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditing(null)} style={[styles.smallBtn, { backgroundColor: tokens.surface2 }]}>
                      <Text style={{ color: tokens.ink2, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: a.is_active ? tokens.ink : tokens.ink3, fontSize: 14.5, fontWeight: '600' }}>
                      {a.name}
                      {a.last_four ? ` ··${a.last_four}` : ''}
                      {!a.is_active ? ' · removed' : ''}
                    </Text>
                    <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>
                      {a.account_type === 'credit' ? 'Credit' : 'Debit'}
                      {a.notes ? ` · ${a.notes}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setEditing(a);
                      setEditName(a.name);
                      setEditNotes(a.notes ?? '');
                    }}
                    style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}
                  >
                    <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Edit</Text>
                  </Pressable>
                  {a.is_active ? (
                    <Pressable onPress={() => removeAccount(a)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
                      <Text style={{ color: tokens.danger, fontWeight: '700', fontSize: 13 }}>Remove</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => restoreAccount(a)} style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}>
                      <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Restore</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          ))
        )}
        {adding ? (
          <View style={{ marginTop: 12 }}>
            <TextInput
              placeholder="Account name"
              placeholderTextColor={tokens.ink3}
              value={name}
              onChangeText={setName}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Last 4 digits (optional)"
              placeholderTextColor={tokens.ink3}
              value={lastFour}
              onChangeText={(v) => setLastFour(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Type</Text>
            <View style={{ marginTop: 6 }}>
              <SegControl
                options={['credit', 'debit'] as const}
                value={type}
                onChange={setType}
              />
            </View>
            <TextInput
              placeholder="Note (optional)"
              placeholderTextColor={tokens.ink3}
              value={notes}
              onChangeText={setNotes}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <PrimaryButton label="Add account" disabled={!name.trim()} onPress={addAccount} />
            <Pressable onPress={() => setAdding(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={{ paddingVertical: 8, marginTop: 4 }}>
            <Text style={{ color: tokens.brand, fontWeight: '700' }}>+ Add account</Text>
          </Pressable>
        )}
      </Card>

      <Card>
        <CardTitle title="Descriptor mappings" />
        <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 19 }}>
          When a bank statement shows text like the left, the app resolves it to the right — this is what the
          twice-monthly statements reconciliation matches against.
        </Text>
        {mappings.length === 0 ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 8 }}>No mappings yet.</Text>
        ) : (
          mappings.map((m) => (
            <View key={m.id} style={[styles.row, { borderTopColor: tokens.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600' }}>{m.statement_text}</Text>
                <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>→ {m.resolved_name}</Text>
              </View>
              <Pressable onPress={() => removeMapping(m)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
                <Text style={{ color: tokens.danger, fontWeight: '700', fontSize: 13 }}>Remove</Text>
              </Pressable>
            </View>
          ))
        )}
        {addingMapping ? (
          <View style={{ marginTop: 12 }}>
            <TextInput
              placeholder="Statement text (as it appears on the statement)"
              placeholderTextColor={tokens.ink3}
              value={statementText}
              onChangeText={setStatementText}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Resolves to (merchant or label)"
              placeholderTextColor={tokens.ink3}
              value={resolvesTo}
              onChangeText={setResolvesTo}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <PrimaryButton
              label="Add mapping"
              disabled={!statementText.trim() || !resolvesTo.trim()}
              onPress={addMapping}
            />
            <Pressable onPress={() => setAddingMapping(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setAddingMapping(true)} style={{ paddingVertical: 8, marginTop: 4 }}>
            <Text style={{ color: tokens.brand, fontWeight: '700' }}>+ Add mapping</Text>
          </Pressable>
        )}
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  inlineInput: { borderRadius: 8, borderWidth: 1, marginTop: 6, paddingHorizontal: 10, paddingVertical: 7 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  row: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 10 },
  rowActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
});
