import type { Database } from '@estate/db';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { LargeSecureStore } from './secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than with an opaque network error later.
  // Expo only inlines vars prefixed EXPO_PUBLIC_, and reads .env files from
  // the app directory (apps/resident), not the workspace root.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Expected in apps/resident/.env.local — restart the dev server after adding them.',
  );
}

/**
 * The anon key is compiled into the client bundle, and that is correct — it is
 * a public identifier. Row Level Security is what actually protects the data
 * (Technical Design §2.9). The service role key bypasses RLS entirely and must
 * never appear in this app.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    // No URL to parse on native; leaving this on causes spurious work.
    detectSessionInUrl: false,
  },
});

/**
 * React Native suspends timers in the background, so the refresh loop has to be
 * driven by foreground state. Without this a session can expire while
 * backgrounded and the first action after resuming fails with a 401.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
