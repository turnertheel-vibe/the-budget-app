/**
 * Auth — Supabase Auth with Google sign-in (expo-auth-session).
 *
 * REMAINING SETUP (not code): sign-in cannot work end to end until the
 * Google Cloud OAuth client is created and the Google provider is enabled
 * in the Supabase dashboard (Authentication → Providers → Google), with
 * this app's redirect URI allow-listed. Until then, signInWithGoogle will
 * fail at the provider step and the error is surfaced to the user.
 * The app has no password of its own — users sign in with Google only.
 */
import { useCallback, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Household } from './types';

WebBrowser.maybeCompleteAuthSession();

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session; user: User };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setState(
          data.session
            ? { status: 'signedIn', session: data.session, user: data.session.user }
            : { status: 'signedOut' },
        );
      })
      .catch(() => {
        if (mounted) setState({ status: 'signedOut' });
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setState(
        session ? { status: 'signedIn', session, user: session.user } : { status: 'signedOut' },
      );
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Sign in with Google via the system browser.
 * Flow: ask Supabase for the provider URL (skipBrowserRedirect), open it
 * with WebBrowser, then exchange the tokens in the redirect URL for a
 * session. Returns an error message string on failure, null on success.
 */
export async function signInWithGoogle(): Promise<string | null> {
  try {
    const redirectTo = AuthSession.makeRedirectUri({ scheme: 'the-budget-app', path: 'auth/callback' });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return error.message;
    if (!data.url) return 'Google sign-in did not return a URL. Check the Supabase Google provider setup.';
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return result.type === 'cancel' || result.type === 'dismiss' ? 'Sign-in was cancelled.' : 'Sign-in did not complete.';
    }
    // Supabase returns the tokens in the redirect URL (hash fragment on
    // native, query string on web). Parse both — no expo-auth-session
    // QueryParams helper is exported in this SDK version.
    const parsed = new URL(result.url);
    const params = new URLSearchParams(`${parsed.search.slice(1)}&${parsed.hash.replace(/^#/, '')}`);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) {
      return 'Google sign-in finished but returned no session. Check the Google Cloud OAuth client and the Supabase Google provider setup.';
    }
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) return sessionError.message;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Google sign-in failed.';
  }
}

export async function signOut(): Promise<string | null> {
  const { error } = await supabase.auth.signOut();
  return error ? error.message : null;
}

/** Current session (or null when signed out). Thin wrapper over supabase.auth.getSession. */
export async function getSession(): Promise<{ session: Session | null; error: string | null }> {
  const { data, error } = await supabase.auth.getSession();
  return { session: data.session ?? null, error: error ? error.message : null };
}

/** Signed-in user's id, or null when there is no session. */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export type HouseholdResult = {
  data: Household | null;
  error: string | null;
};

/**
 * Resolve the signed-in user's household (household_members → households).
 * v1 assumes one household per user and picks the earliest membership.
 * Returns an error (not a throw) when signed out or when the user belongs
 * to no household yet — callers surface that instead of querying data.
 */
export async function getMyHousehold(): Promise<HouseholdResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: 'Not signed in.' };
  const { data: memberships, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (memberError) return { data: null, error: memberError.message };
  const householdId = (memberships as { household_id: string }[] | null)?.[0]?.household_id;
  if (!householdId) return { data: null, error: 'No household found for this user.' };
  const { data, error } = await supabase
    .from('households')
    .select('*')
    .eq('id', householdId)
    .single();
  return { data: (data ?? null) as Household | null, error: error ? error.message : null };
}

/** Household id for the signed-in user, or null when there is none. */
export async function getMyHouseholdId(): Promise<string | null> {
  const { data } = await getMyHousehold();
  return data?.id ?? null;
}

/**
 * Resolve the household id for a data-layer call: use the explicit id when
 * the caller passes one, otherwise the signed-in user's household.
 * Returns an error string instead of throwing so callers can return it in
 * their { data, error } result.
 */
export async function resolveHouseholdId(
  provided?: string | null,
): Promise<{ householdId: string | null; error: string | null }> {
  if (provided) return { householdId: provided, error: null };
  const householdId = await getMyHouseholdId();
  if (!householdId) return { householdId: null, error: 'No household found for this user.' };
  return { householdId, error: null };
}

/** Stable hook wrapper so screens call `const { signIn } = useAuthActions()`. */
export function useAuthActions() {
  const signIn = useCallback(() => signInWithGoogle(), []);
  const signOutUser = useCallback(() => signOut(), []);
  return { signIn, signOut: signOutUser };
}
