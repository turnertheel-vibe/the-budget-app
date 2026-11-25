/**
 * Supabase client — the app's only backend (Postgres + Auth + RLS).
 *
 * Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY from the
 * environment (Expo env vars). The anon key is the *publishable* key — it is
 * safe to ship in the app because Row Level Security restricts every table
 * to the signed-in user's household. NEVER put the service role key
 * (Supabase's "secret key") in the app, in .env, or anywhere in this repo.
 *
 * If the env vars are missing, the client is created against a clearly
 * marked placeholder so the app can still boot and show a configuration
 * message; all auth/data calls will fail until the vars are set.
 * See .env.example — the coordinator writes the real .env separately.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_ANON_KEY = 'placeholder-anon-key';

export const supabaseUrl: string = process.env.EXPO_PUBLIC_SUPABASE_URL ?? PLACEHOLDER_URL;
export const supabaseAnonKey: string = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? PLACEHOLDER_ANON_KEY;

/** True when real Supabase env vars are present. False → show config help, not data. */
export const isSupabaseConfigured: boolean =
  supabaseUrl !== PLACEHOLDER_URL && supabaseAnonKey !== PLACEHOLDER_ANON_KEY;

if (!isSupabaseConfigured && typeof __DEV__ !== 'undefined' && __DEV__) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env and fill in your own values. Auth and data will not work until then.',
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // We handle the OAuth redirect ourselves (see src/lib/auth.ts) instead
    // of letting supabase-js parse the URL.
    detectSessionInUrl: false,
  },
});
