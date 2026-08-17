import type { Database } from '@estate/db';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy them from apps/web/.env.local.',
  );
}

/**
 * The anon key ships in the bundle and that is correct — RLS is what protects
 * the data, not the key. The SERVICE ROLE key bypasses RLS entirely and must
 * never appear in anything a browser downloads.
 *
 * Unlike the mobile clients there is no custom storage adapter: the browser has
 * no 2048-byte limit to work around, so the default localStorage is fine.
 */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // The dashboard has no OAuth redirect flow, so there is no fragment to parse
    // and leaving this on would strip query params the router may want.
    detectSessionInUrl: false,
  },
});
