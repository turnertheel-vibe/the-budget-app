/**
 * Labels — Chart of accounts (spec §2.8).
 * Add / rename / retire labels. Retire deactivates, never hard-deletes, so
 * history keeps resolving. Retired labels leave pickers but stay on old rows.
 * New Expense labels ask Needs/Wants (default Wants, v3 D3).
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import { supabase } from '../lib/supabase';
import { listLabels } from '../lib/queries';
import { logAudit } from '../lib/queries';
import { insertLabel, renameLabel, retireLabel } from '../lib/reference';
import { resultError, useHousehold } from '../components/useBudget';
import { Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, SegControl } from '../components/ui';
import type { Label, LabelSection, NeedsWants } from '../lib/types';

const SECTIONS: LabelSection[] = ['Expense', 'Income', 'Savings', 'Rewards'];

export function LabelsScreen() {
  const { tokens } = useTheme();
  const { householdId, loading: hhLoading, error: hhError } = useHousehold();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState<'All' | LabelSection>('All');
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [section, setSection] = useState<LabelSection>('Expense');
  const [needsWants, setNeedsWants] = useState<NeedsWants>('Wants');
  const [editing, setEditing] = useState<Label | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    const { data, error: err } = await listLabels(householdId);
    if (err) setError(err);
    setLabels(data ?? []);
    setLoading(false);
  }, [householdId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return labels.filter((l) => {
      if (!showRetired && !l.is_active) return false;
      if (sectionFilter !== 'All' && l.section !== sectionFilter) return false;
      if (q && !l.label.toLowerCase().includes(q) && !l.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [labels, search, sectionFilter, showRetired]);

  const addLabel = async () => {
    if (!householdId || !name.trim() || !category.trim()) {
      setError('Name and category are both required.');
      return;
    }
    const res = await insertLabel({
      label: name.trim(),
      category: category.trim(),
      section,
      needsWants: section === 'Expense' ? needsWants : null,
      householdId,
    });
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setName('');
    setCategory('');
    setAdding(false);
    load();
  };

  const saveRename = async () => {
    // The data layer renames by name only; the category stays as created.
    if (!editing || !editName.trim()) return;
    const res = await renameLabel(editing.id, editName.trim(), householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setEditing(null);
    load();
  };

  const retire = async (l: Label) => {
    const res = await retireLabel(l.id, householdId);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    load();
  };

  const restore = async (l: Label) => {
    // No data-layer restore yet — reactivation is a plain update.
    const { error: err } = await supabase.from('labels').update({ is_active: true }).eq('id', l.id);
    if (err) {
      setError(err.message);
      return;
    }
    await logAudit('label.restored', 'labels', l.id, { label: l.label }).catch(() => undefined);
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
      <Text style={[styles.title, { color: tokens.ink }]}>Chart of accounts</Text>
      <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 4 }}>
        Labels are user-editable reference data, never hardcoded.
      </Text>
      <ErrorText message={error} />

      <TextInput
        placeholder="Search labels…"
        placeholderTextColor={tokens.ink3}
        value={search}
        onChangeText={setSearch}
        style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
      />
      <View style={styles.chipRow}>
        {(['All', ...SECTIONS] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setSectionFilter(s)}
            style={[styles.chip, { backgroundColor: sectionFilter === s ? tokens.brand : tokens.surface2 }]}
          >
            <Text style={{ color: sectionFilter === s ? tokens.brandInk : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
              {s}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setShowRetired(!showRetired)}
          style={[styles.chip, { backgroundColor: showRetired ? tokens.brand : tokens.surface2 }]}
        >
          <Text style={{ color: showRetired ? tokens.brandInk : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
            Retired
          </Text>
        </Pressable>
      </View>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState title="No labels match" body="Try a different search or section, or add a label below." />
        </Card>
      ) : (
        filtered.map((l) => (
          <View key={l.id} style={[styles.row, { backgroundColor: tokens.surface, borderColor: tokens.line }]}>
            {editing?.id === l.id ? (
              <View style={{ flex: 1 }}>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  style={[styles.inlineInput, { color: tokens.ink, borderColor: tokens.line }]}
                />
                <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
                  Category stays “{editing.category}” — renaming changes the name only.
                </Text>
                <View style={styles.rowActions}>
                  <Pressable onPress={saveRename} style={[styles.smallBtn, { backgroundColor: tokens.brand }]}>
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
                  <Text style={{ color: l.is_active ? tokens.ink : tokens.ink3, fontSize: 14.5, fontWeight: '600' }}>
                    {l.label}
                    {!l.is_active ? ' · retired' : ''}
                  </Text>
                  <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>
                    {l.category} · {l.section}
                    {l.needs_wants ? ` · ${l.needs_wants}` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setEditing(l);
                    setEditName(l.label);
                  }}
                  style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}
                >
                  <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Rename</Text>
                </Pressable>
                {l.is_active ? (
                  <Pressable onPress={() => retire(l)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
                    <Text style={{ color: tokens.danger, fontWeight: '700', fontSize: 13 }}>Retire</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => restore(l)} style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}>
                    <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Restore</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        ))
      )}

      <Card>
        <CardTitle title="Add a label" />
        {adding ? (
          <>
            <TextInput
              placeholder="Label name"
              placeholderTextColor={tokens.ink3}
              value={name}
              onChangeText={setName}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <TextInput
              placeholder="Category"
              placeholderTextColor={tokens.ink3}
              value={category}
              onChangeText={setCategory}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Section</Text>
            <View style={{ marginTop: 6 }}>
              <SegControl options={SECTIONS} value={section} onChange={setSection} />
            </View>
            {section === 'Expense' ? (
              <>
                <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Needs or Wants?</Text>
                <View style={{ marginTop: 6 }}>
                  <SegControl
                    options={['Needs', 'Wants'] as const}
                    value={needsWants}
                    onChange={setNeedsWants}
                  />
                </View>
              </>
            ) : null}
            <PrimaryButton label="Add label" disabled={!name.trim() || !category.trim()} onPress={addLabel} />
            <Pressable onPress={() => setAdding(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={{ paddingVertical: 6 }}>
            <Text style={{ color: tokens.brand, fontWeight: '700' }}>+ Add a label</Text>
          </Pressable>
        )}
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
          Retiring a label never deletes it — old transactions keep resolving to it, and it leaves the pickers.
        </Text>
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  container: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  inlineInput: { borderRadius: 8, borderWidth: 1, marginTop: 6, paddingHorizontal: 10, paddingVertical: 7 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10 },
  row: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 8, padding: 12 },
  rowActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
});
