/**
 * Settings — in spec order (spec §2.7): Appearance, Household, AI access,
 * Theme, Defaults & formats, Notifications, Your data, Account.
 * Appearance and theme persist per-device (AsyncStorage), never in Supabase.
 * Defaults, notification timing, and household data live in Supabase.
 * Month-start day is NOT here — deferred by Turner.
 */
import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { RootStackNavigation } from '../navigation/AppNavigator';
import { useTheme, THEME_PRESETS, isValidHex, parseHexScheme, type ThemeColors } from '../theme';
import { signOut, useSession } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatDate, formatMoney, todayIso } from '../lib/money';
import {
  listAccounts,
  listAuditLog,
  listHouseholdMembers,
  listLabels,
  listSavingsFunds,
  listSavingsMovements,
  listTransactions,
} from '../lib/queries';
import { getMonth } from '../lib/queries';
import { logAudit, saveHouseholdPreferences } from '../lib/queries';
import { resultError, useHousehold } from '../components/useBudget';
import { Card, CardTitle, EmptyState, ErrorText, LoadingView, PrimaryButton, RowButton, SegControl } from '../components/ui';
import type { AuditLogEntry, Currency, DateFormat, HouseholdMember, JanuaryReminderTiming } from '../lib/types';

const AI_MODIFY_KEY = '@budget-app/ai-modify';
const RECEIPTS_LOCATION_KEY = '@budget-app/receipts-location';
const OVERSPEND_KEY = '@budget-app/overspend-alerts';

const AGENT_INSTRUCTIONS = `Shared agent instructions — the manual every connected agent takes in on connection, so the experience is the same no matter which agent you use.

You are the household's budget agent. You can read everything: transactions, per-label planned vs. actual, the plan and its split, savings buckets and their movements, yearly goals, and the reimbursement log. When the user asks for a report — month in review, year in review, where the money went, goal check-ins, or biggest leaks — generate it from the full data using your own tools and present it in the conversation, in plain language with the numbers that matter, then offer a follow-up ("want the label-by-label cut?"). If the monthly briefing is on, send the month in review on the 1st without being asked.

Receipts: the app never stores receipt files. It keeps only a reference (filename or link) to the user's own storage. Receipts live where the household set up in Settings → AI access. When a receipt is missing, hold the charge in Open Items. Statements: twice a month, ask for CSV/spreadsheet exports per account, walk the user through downloading them from their bank, and reconcile against logged transactions using the descriptor mappings — catching missing, duplicate, or mismatched entries.

Every write you make goes through the same tables and lands in the audit log. Never invent a reason for a bucket-paid expense: bucket-paid spends have no reason. Only pool↔bucket moves carry a user-typed reason. Money is integer cents; a negative entry is a reimbursement (note starts REIMB), a refund (REFUND), or a repayment on an income label — never choose the kind yourself, derive it from the label and the note.`;

const HEX_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'brand', label: 'Primary' },
  { key: 'needs', label: 'Needs' },
  { key: 'wants', label: 'Wants' },
  { key: 'bg', label: 'Background' },
  { key: 'card', label: 'Card' },
];

export function SettingsScreen() {
  const { tokens, appearance, setAppearance, preset, setPreset, customColors, setCustomColors, resetTheme } = useTheme();
  const navigation = useNavigation<RootStackNavigation>();
  const session = useSession();
  const { householdId, prefs, currency, dateFormat, loading: hhLoading, error: hhError, refresh } = useHousehold();
  const [loading, setLoading] = useState(true);
  // Only the first load shows the loading screen; later tab focuses refresh
  // silently in the background so the tab stays where you left it.
  const hasLoaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [aiModify, setAiModify] = useState(true);
  const [receiptsLocation, setReceiptsLocation] = useState('');
  const [receiptsEditing, setReceiptsEditing] = useState(false);
  const [overspend, setOverspend] = useState(true);
  const [showInstructions, setShowInstructions] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [hexDraft, setHexDraft] = useState<Record<keyof ThemeColors, string>>({
    brand: '',
    needs: '',
    wants: '',
    bg: '',
    card: '',
  });
  const [pasteText, setPasteText] = useState('');
  const [themeMsg, setThemeMsg] = useState<string | null>(null);
  const [defaultAccountId, setDefaultAccountId] = useState<string>('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [csv, setCsv] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    if (!hasLoaded.current) setLoading(true);
    setError(null);
    const [membersRes, auditRes, accountsRes] = await Promise.all([
      listHouseholdMembers(householdId),
      listAuditLog(householdId, 20),
      listAccounts(householdId),
    ]);
    if (membersRes.error) setError(membersRes.error);
    if (auditRes.error) setError(auditRes.error);
    setMembers(membersRes.data ?? []);
    setAudit(auditRes.data ?? []);
    const accts = (accountsRes.data ?? []).filter((a) => a.is_active);
    setAccounts(accts.map((a) => ({ id: a.id, name: a.name })));
    const [modify, receipts, over] = await Promise.all([
      AsyncStorage.getItem(AI_MODIFY_KEY),
      AsyncStorage.getItem(RECEIPTS_LOCATION_KEY),
      AsyncStorage.getItem(OVERSPEND_KEY),
    ]);
    setAiModify(modify !== 'off');
    setReceiptsLocation(receipts ?? '');
    setOverspend(over !== 'off');
    setDefaultAccountId(prefs?.default_account_id ?? '');
    hasLoaded.current = true;
    setLoading(false);
  }, [householdId, prefs?.default_account_id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const savePrefs = async (patch: Partial<{ default_account_id: string | null; currency: Currency; date_format: DateFormat; january_reminder_timing: JanuaryReminderTiming }>) => {
    if (!householdId) return;
    const res = await saveHouseholdPreferences(householdId, patch);
    const err = resultError(res);
    if (err) {
      setError(err);
      return;
    }
    setSavedMsg('Saved.');
    refresh();
  };

  const invite = async () => {
    if (!householdId || !inviteEmail.trim()) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteMsg('Enter a valid email address.');
      return;
    }
    if (members.some((m) => m.profile?.display_name?.toLowerCase() === email)) {
      setInviteMsg('That person is already a member.');
      return;
    }
    const { error: err } = await supabase.from('household_invitations').insert({
      household_id: householdId,
      email,
      role: 'member',
    });
    if (err) {
      setInviteMsg(err.message);
      return;
    }
    await logAudit('household.invited', 'household_invitations', null, { email }).catch(() => undefined);
    setInviteMsg(`Invite sent to ${email}.`);
    setInviteEmail('');
  };

  const changeRole = async (m: HouseholdMember, role: 'owner' | 'member') => {
    if (role === 'member' && m.role === 'owner' && members.filter((x) => x.role === 'owner').length <= 1) {
      setError('A household always keeps at least one owner.');
      return;
    }
    // household_members has no `id` column — its key is household_id + user_id.
    const { error: err } = await supabase
      .from('household_members')
      .update({ role })
      .eq('household_id', m.household_id)
      .eq('user_id', m.user_id);
    if (err) {
      setError(err.message);
      return;
    }
    await logAudit('household.role_changed', 'household_members', m.user_id, { role }).catch(() => undefined);
    load();
  };

  const removeMember = async (m: HouseholdMember) => {
    if (m.role === 'owner' && members.filter((x) => x.role === 'owner').length <= 1) {
      setError('A household always keeps at least one owner.');
      return;
    }
    const { error: err } = await supabase
      .from('household_members')
      .delete()
      .eq('household_id', m.household_id)
      .eq('user_id', m.user_id);
    if (err) {
      setError(err.message);
      return;
    }
    await logAudit('household.member_removed', 'household_members', m.user_id, {}).catch(() => undefined);
    load();
  };

  const applyHexDraft = async () => {
    const colors: ThemeColors = {
      brand: hexDraft.brand.trim(),
      needs: hexDraft.needs.trim(),
      wants: hexDraft.wants.trim(),
      bg: hexDraft.bg.trim(),
      card: hexDraft.card.trim(),
    };
    if (!Object.values(colors).every(isValidHex)) {
      setThemeMsg('All five fields need a valid hex color, like #4F6B3A.');
      return;
    }
    await setCustomColors(colors);
    setThemeMsg('Custom theme applied.');
  };

  const applyPaste = async () => {
    const parsed = parseHexScheme(pasteText);
    if (!parsed) {
      setThemeMsg('Could not read that scheme — paste five hex codes in order Primary, Needs, Wants, Background, Card, or a JSON object with those keys.');
      return;
    }
    await setCustomColors(parsed);
    setHexDraft(parsed);
    setThemeMsg('Theme applied from the pasted scheme.');
  };

  const exportCsv = async () => {
    if (!householdId) return;
    const { data: m } = await getMonth(householdId, `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`);
    const [txRes, labelsRes, accountsRes, fundsRes, movRes] = await Promise.all([
      m ? listTransactions(householdId, m.id) : Promise.resolve({ data: [], error: null }),
      listLabels(householdId),
      listAccounts(householdId),
      listSavingsFunds(householdId),
      listSavingsMovements(householdId),
    ]);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines: string[] = ['section,date,description,merchant,label,account,amount_cents,kind'];
    for (const t of txRes.data ?? []) {
      lines.push(
        ['transaction', t.txn_date, esc(t.description), esc(t.merchant ?? ''), esc(t.label?.label ?? ''), esc(t.account?.name ?? ''), String(t.amount_cents), t.kind].join(','),
      );
    }
    lines.push('');
    lines.push('label,category,section,needs_wants,active');
    for (const l of labelsRes.data ?? []) {
      lines.push([esc(l.label), esc(l.category), l.section, l.needs_wants ?? '', String(l.is_active)].join(','));
    }
    lines.push('');
    lines.push('account,name,last_four,type,active');
    for (const a of accountsRes.data ?? []) {
      lines.push([a.id, esc(a.name), a.last_four ?? '', a.account_type, String(a.is_active)].join(','));
    }
    lines.push('');
    lines.push('bucket,name,target_pct,active');
    for (const f of fundsRes.data ?? []) {
      lines.push([f.id, esc(f.name), String(f.target_pct ?? ''), String(f.is_active)].join(','));
    }
    lines.push('');
    lines.push('movement,fund_id,type,amount_cents,reason,created_at');
    for (const mv of movRes.data ?? []) {
      lines.push([mv.id, mv.fund_id, mv.movement_type, String(mv.amount_cents), esc(mv.reason ?? ''), mv.created_at].join(','));
    }
    const text = lines.join('\n');
    setCsv(text);
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([text], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `budget-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Falls back to the selectable text below.
      }
    }
  };

  const doSignOut = async () => {
    setSigningOut(true);
    const msg = await signOut();
    setSigningOut(false);
    if (msg) setError(msg);
  };

  if (hhLoading || loading) return <LoadingView />;
  if (hhError || !householdId) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.bg }]}>
        <ErrorText message={hhError ?? 'No household found.'} />
      </View>
    );
  }

  const userEmail = session.status === 'signedIn' ? session.user.email ?? '' : '';
  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const timing = prefs?.january_reminder_timing ?? 'Jan 1';

  return (
    <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.title, { color: tokens.ink }]}>Settings</Text>
      <ErrorText message={error} />
      {savedMsg ? <Text style={{ color: tokens.brand, fontSize: 13, marginTop: 8 }}>{savedMsg}</Text> : null}

      <Card>
        <CardTitle title="Appearance" />
        <SegControl
          options={['Light', 'System', 'Dark'] as const}
          value={appearance === 'light' ? 'Light' : appearance === 'dark' ? 'Dark' : 'System'}
          onChange={(v) => setAppearance(v === 'Light' ? 'light' : v === 'Dark' ? 'dark' : 'system')}
        />
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
          Per-device — it never leaves this phone.
        </Text>
      </Card>

      <Card>
        <CardTitle title="Household" right={`${members.length} member${members.length === 1 ? '' : 's'}`} />
        {members.map((m) => (
          <View key={m.user_id} style={[styles.memberRow, { borderTopColor: tokens.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }}>
                {m.profile?.display_name ?? m.user_id}
              </Text>
              <Text style={{ color: tokens.ink3, fontSize: 12.5, marginTop: 2 }}>
                {m.role === 'owner' ? 'Owner' : 'Member'}
                {ownerCount === 1 && m.role === 'owner' ? ' · the household’s only owner' : ''}
              </Text>
            </View>
            {m.role === 'owner' ? (
              <Pressable
                onPress={() => changeRole(m, 'member')}
                disabled={ownerCount <= 1}
                style={[styles.smallBtn, { backgroundColor: tokens.surface2 }]}
              >
                <Text style={{ color: ownerCount <= 1 ? tokens.ink3 : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
                  Make member
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => changeRole(m, 'owner')} style={[styles.smallBtn, { backgroundColor: tokens.brandSoft }]}>
                <Text style={{ color: tokens.brand, fontWeight: '700', fontSize: 13 }}>Make owner</Text>
              </Pressable>
            )}
            <Pressable onPress={() => removeMember(m)} style={[styles.smallBtn, { backgroundColor: tokens.dangerSoft }]}>
              <Text style={{ color: tokens.danger, fontWeight: '700', fontSize: 13 }}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Invite by email</Text>
        <TextInput
          placeholder="person@example.com"
          placeholderTextColor={tokens.ink3}
          value={inviteEmail}
          onChangeText={setInviteEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
        />
        <PrimaryButton label="Send invite" disabled={!inviteEmail.trim()} onPress={invite} />
        {inviteMsg ? <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 8 }}>{inviteMsg}</Text> : null}
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 8 }}>
          Removing a member never deletes household data, and a household always keeps at least one owner.
        </Text>
      </Card>

      <Card>
        <CardTitle title="AI access" />
        <View style={styles.toggleRow}>
          <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600', flex: 1 }}>
            Agents can modify data
          </Text>
          <SegControl
            options={['Off', 'On'] as const}
            value={aiModify ? 'On' : 'Off'}
            onChange={async (v) => {
              const on = v === 'On';
              setAiModify(on);
              await AsyncStorage.setItem(AI_MODIFY_KEY, on ? 'on' : 'off');
            }}
          />
        </View>
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
          Off means read-only — agents can answer and report, but not change anything.
        </Text>
        <RowButton title="View agent instructions" subtitle="The shared manual every agent takes in on connection" onPress={() => setShowInstructions(!showInstructions)} />
        {showInstructions ? (
          <Text selectable style={{ color: tokens.ink2, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
            {AGENT_INSTRUCTIONS}
          </Text>
        ) : null}
        <RowButton
          title="Receipts location"
          subtitle={receiptsLocation || 'Not set — tap to set where receipts live'}
          onPress={() => setReceiptsEditing(!receiptsEditing)}
        />
        {receiptsEditing ? (
          <View>
            <TextInput
              placeholder="e.g. Drive / Receipts_Storage, or a folder path"
              placeholderTextColor={tokens.ink3}
              value={receiptsLocation}
              onChangeText={setReceiptsLocation}
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
            />
            <PrimaryButton
              label="Save receipts location"
              onPress={async () => {
                await AsyncStorage.setItem(RECEIPTS_LOCATION_KEY, receiptsLocation.trim());
                setReceiptsEditing(false);
              }}
            />
            <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
              The app only ever stores a receipt reference (filename or link), never the file itself.
            </Text>
          </View>
        ) : null}
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Recent agent activity</Text>
        {audit.length === 0 ? (
          <Text style={{ color: tokens.ink3, fontSize: 13, marginTop: 6 }}>No agent activity logged yet.</Text>
        ) : (
          audit.slice(0, 10).map((a) => (
            <View key={a.id} style={[styles.auditRow, { borderTopColor: tokens.line }]}>
              <Text style={{ color: tokens.ink, fontSize: 13.5, fontWeight: '600', flex: 1 }}>{a.action}</Text>
              <Text style={{ color: tokens.ink3, fontSize: 12 }}>
                {a.created_at.slice(0, 10)}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <CardTitle title="Theme" right={customColors ? 'Custom' : preset.name} />
        <View style={styles.presetGrid}>
          {THEME_PRESETS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setPreset(p.id)}
              style={[
                styles.preset,
                {
                  backgroundColor: p.colors.bg,
                  borderColor: preset.id === p.id && !customColors ? tokens.brand : tokens.line,
                  borderWidth: preset.id === p.id && !customColors ? 2 : 1,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {[p.colors.brand, p.colors.needs, p.colors.wants].map((c) => (
                  <View key={c} style={{ backgroundColor: c, borderRadius: 6, height: 12, width: 12 }} />
                ))}
              </View>
              <Text style={{ color: '#33382A', fontSize: 12.5, fontWeight: '700', marginTop: 6 }}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setAdvanced(!advanced)} style={{ paddingVertical: 8 }}>
          <Text style={{ color: tokens.brand, fontWeight: '700' }}>
            {advanced ? 'Hide Advanced ▲' : 'Advanced — custom hex & agent paste ▼'}
          </Text>
        </Pressable>
        {advanced ? (
          <View>
            {HEX_FIELDS.map(({ key, label }) => (
              <View key={key} style={styles.hexRow}>
                <Text style={{ color: tokens.ink, fontSize: 14, fontWeight: '600', width: 96 }}>{label}</Text>
                <TextInput
                  value={hexDraft[key] || (customColors?.[key] ?? preset.colors[key])}
                  onChangeText={(v) => setHexDraft((d) => ({ ...d, [key]: v }))}
                  autoCapitalize="none"
                  placeholder="#000000"
                  placeholderTextColor={tokens.ink3}
                  style={[styles.hexInput, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface }]}
                />
                <View style={{ backgroundColor: hexDraft[key] || customColors?.[key] || preset.colors[key], borderRadius: 8, height: 28, width: 28 }} />
              </View>
            ))}
            <PrimaryButton label="Apply custom colors" onPress={applyHexDraft} />
            <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Agent paste flow</Text>
            <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
              Ask your AI agent to describe a theme in words — it replies with five hex codes (Primary,
              Needs, Wants, Background, Card) or a JSON object. Paste them here; the app never generates
              themes itself.
            </Text>
            <TextInput
              placeholder="#4F6B3A #7D8F5F #C07F45 #ECE7D8 #FFFDF7"
              placeholderTextColor={tokens.ink3}
              value={pasteText}
              onChangeText={setPasteText}
              multiline
              autoCapitalize="none"
              style={[styles.input, { color: tokens.ink, borderColor: tokens.line, backgroundColor: tokens.surface, minHeight: 64 }]}
            />
            <PrimaryButton label="Apply pasted scheme" disabled={!pasteText.trim()} onPress={applyPaste} />
            {themeMsg ? <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 8 }}>{themeMsg}</Text> : null}
            <Pressable onPress={async () => { await resetTheme(); setThemeMsg('Back to Sage Meadow.'); }} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: tokens.ink2, fontWeight: '700' }}>Reset to Sage Meadow</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>

      <Card>
        <CardTitle title="Defaults & formats" />
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Default account for new transactions</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {accounts.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => {
                setDefaultAccountId(a.id);
                savePrefs({ default_account_id: a.id });
              }}
              style={[styles.chip, { backgroundColor: defaultAccountId === a.id ? tokens.brand : tokens.surface2 }]}
            >
              <Text style={{ color: defaultAccountId === a.id ? tokens.brandInk : tokens.ink2, fontWeight: '700', fontSize: 13 }}>
                {a.name}
              </Text>
            </Pressable>
          ))}
          {accounts.length === 0 ? <Text style={{ color: tokens.ink3, fontSize: 13 }}>No accounts yet — add one from Accounts.</Text> : null}
        </View>
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Currency</Text>
        <View style={{ marginTop: 6 }}>
          <SegControl
            options={['USD', 'EUR', 'GBP'] as const}
            value={currency}
            onChange={(v) => savePrefs({ currency: v })}
          />
        </View>
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>Date format</Text>
        <View style={{ marginTop: 6 }}>
          <SegControl
            options={['mdy', 'dmy', 'slash', 'iso'] as const}
            value={dateFormat}
            onChange={(v) => savePrefs({ date_format: v })}
          />
        </View>
        <Text style={{ color: tokens.ink2, fontSize: 13, marginTop: 8 }}>
          Preview: {formatDate(todayIso(), dateFormat)} · {formatMoney(123456, currency)}
        </Text>
      </Card>

      <Card>
        <CardTitle title="Notifications" />
        <Text style={[styles.fieldLabel, { color: tokens.ink2 }]}>January goals reminder</Text>
        <View style={{ marginTop: 6 }}>
          <SegControl
            options={['Jan 1', 'first weekend', 'Jan 15'] as const}
            value={timing}
            onChange={(v) => savePrefs({ january_reminder_timing: v })}
          />
        </View>
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
          Same reminder you see on the Year tab — it stays until that year&apos;s goals are set.
        </Text>
        <View style={styles.toggleRow}>
          <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600', flex: 1 }}>Overspending alerts</Text>
          <SegControl
            options={['Off', 'On'] as const}
            value={overspend ? 'On' : 'Off'}
            onChange={async (v) => {
              const on = v === 'On';
              setOverspend(on);
              await AsyncStorage.setItem(OVERSPEND_KEY, on ? 'on' : 'off');
            }}
          />
        </View>
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
          A heads-up when a label goes over its planned amount. In-app in this version; push delivery comes later.
        </Text>
      </Card>

      <Card>
        <CardTitle title="Your data" />
        <Text style={{ color: tokens.ink2, fontSize: 13, lineHeight: 19 }}>
          Download your data as CSV — this month&apos;s transactions, labels, accounts, buckets, and movements.
        </Text>
        <PrimaryButton label="Build CSV export" onPress={exportCsv} />
        {csv ? (
          <Text selectable style={{ color: tokens.ink2, fontSize: 12, lineHeight: 16, marginTop: 10 }}>
            {csv}
          </Text>
        ) : null}
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 6 }}>
          On the web the file downloads automatically; on mobile, long-press the text above to copy it.
        </Text>
      </Card>

      <Card>
        <CardTitle title="Account" />
        <Text style={{ color: tokens.ink, fontSize: 14.5, fontWeight: '600' }}>
          {userEmail ? `Signed in with Google as ${userEmail}` : 'Signed in with Google'}
        </Text>
        <Text style={{ color: tokens.ink3, fontSize: 12, marginTop: 4 }}>
          Signing out never deletes household data.
        </Text>
        <PrimaryButton label={signingOut ? 'Signing out…' : 'Sign out'} disabled={signingOut} onPress={doSignOut} />
      </Card>

      <Card>
        <CardTitle title="More" />
        <RowButton title="Chart of accounts" subtitle="Labels — add, rename, retire" onPress={() => navigation.navigate('Labels')} />
        <RowButton title="Accounts & statement names" subtitle="Accounts and descriptor mappings" onPress={() => navigation.navigate('Accounts')} />
        <RowButton title="Monthly plan" subtitle="Projected income, split, budgets by label" onPress={() => navigation.navigate('Main', { screen: 'Plan' } as never)} />
        <RowButton title="Year overview & goals" subtitle="Annual view, January reminder, reports" onPress={() => navigation.navigate('Main', { screen: 'Year' } as never)} />
        <RowButton title="Reimbursement Log" subtitle="Gross amounts, for taxes" onPress={() => navigation.navigate('ReimbursementLog')} />
      </Card>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  auditRow: { borderTopWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  container: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginTop: 14 },
  hexInput: { borderRadius: 8, borderWidth: 1, flex: 1, fontSize: 14, paddingHorizontal: 10, paddingVertical: 8 },
  hexRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 15, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  memberRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 10 },
  preset: { borderRadius: 12, borderWidth: 1, padding: 10, width: '31%' },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  smallBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 12 },
});
