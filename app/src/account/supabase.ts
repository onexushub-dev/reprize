import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

/** The session (access and refresh tokens) lives in its own MMKV file, apart from the recordings. */
const storage = createMMKV({ id: 'reprize-auth' });

const extra = (Constants.expoConfig && Constants.expoConfig.extra) || {};
const config: { url?: string; key?: string } = extra.supabase || {};

let client: SupabaseClient | null = null;

/** False in builds without REPRIZE_SUPABASE_URL / REPRIZE_SUPABASE_KEY: there is no account then. */
export function supabaseConfigured(): boolean {
  return Boolean(config.url && config.key);
}

/** The app's Supabase client, created on first use. Throws where the build has no Supabase settings. */
export function supabase(): SupabaseClient {
  if (client !== null) return client;
  if (!config.url || !config.key) throw new Error('Supabase is not configured in this build');
  const created = createClient(config.url, config.key, {
    auth: {
      storage: {
        getItem: (key: string) => storage.getString(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => void storage.remove(key),
      },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  // Tokens are refreshed only while the app is in front (Supabase's advice for React Native).
  AppState.addEventListener('change', (state) => {
    if (state === 'active') created.auth.startAutoRefresh();
    else created.auth.stopAutoRefresh();
  });
  client = created;
  return created;
}
