/** Sign-in screen — Google only. No password exists for this app. */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { signInWithGoogle } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';

export function SignInScreen() {
  const { tokens } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    setBusy(true);
    setError(null);
    const message = await signInWithGoogle();
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.title, { color: tokens.ink }]}>The Budget App</Text>
      <Text style={[styles.subtitle, { color: tokens.ink2 }]}>
        A mobile-first budget you can control with AI — monthly budgets, custom labels, and receipt-level detail.
      </Text>
      {!isSupabaseConfigured && (
        <View style={[styles.warn, { backgroundColor: tokens.dangerSoft, borderColor: tokens.danger }]}>
          <Text style={{ color: tokens.danger, fontSize: 14, lineHeight: 20 }}>
            Supabase is not configured yet. Copy .env.example to .env and fill in your own values, then restart the app.
          </Text>
        </View>
      )}
      <Pressable
        disabled={busy || !isSupabaseConfigured}
        onPress={onSignIn}
        style={[styles.button, { backgroundColor: busy || !isSupabaseConfigured ? tokens.unallocated : tokens.brand }]}
      >
        <Text style={[styles.buttonText, { color: tokens.brandInk }]}>
          {busy ? 'Opening Google…' : 'Sign in with Google'}
        </Text>
      </Pressable>
      {error && (
        <Text style={[styles.error, { color: tokens.danger }]}>{error}</Text>
      )}
      <Text style={[styles.note, { color: tokens.ink3 }]}>
        You sign in with your Google account — no separate password for this app.
      </Text>
      <Text style={[styles.note, { color: tokens.ink3 }]}>
        Remaining setup (not code): sign-in works end to end only once the Google Cloud OAuth client is
        created and the Google provider is enabled in the Supabase dashboard, with this app&apos;s redirect
        URI allow-listed. Until then, sign-in fails at the provider step and the error above is shown.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', borderRadius: 12, marginTop: 24, paddingVertical: 14, width: '100%' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  container: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  error: { fontSize: 14, lineHeight: 20, marginTop: 16, textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  warn: { borderRadius: 12, borderWidth: 1, marginTop: 20, padding: 12, width: '100%' },
});
