import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

/**
 * The auth context, its shape, and the hook that reads it.
 *
 * Split out of auth.tsx so that file exports ONLY <AuthProvider>. React Fast
 * Refresh works per module: a file that exports a component alongside anything
 * else cannot be hot-swapped, so every edit to auth.tsx remounted the provider
 * and threw away the session state of whatever screen was open. That is the
 * file you are most often editing when you are working on auth, which is
 * exactly when losing the session hurts.
 *
 * No .tsx: there is no JSX here, and the context has to live somewhere the
 * provider and the hook can both import without either owning the other.
 */

export interface AdminMembership {
  id: string;
  estate_id: string;
  estate_name: string;
  join_code: string;
}

export interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Estates where this user is an ACTIVE ADMIN. Empty for everyone else. */
  estates: AdminMembership[];
  estatesLoaded: boolean;
  activeEstateId: string | null;
  setActiveEstateId: (id: string) => void;
  activeEstate: AdminMembership | null;
  refreshEstates: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** True for a platform owner. Resolved per session, never from a JWT claim. */
  isPlatformAdmin: boolean;
  /**
   * False until the ownership check has answered once.
   *
   * The gate must not route on `isPlatformAdmin` before this: it starts false,
   * and an owner who also administers an estate would be sent to the estate
   * dashboard for the split second before the answer lands — long enough for a
   * catch-all route to rewrite the URL and strip the path they asked for.
   */
  rolesLoaded: boolean;
  /**
   * Set on an account whose password was generated during estate onboarding and
   * read aloud to somebody. Cleared once they choose their own.
   */
  mustChangePassword: boolean;
  changePassword: (next: string) => Promise<{ error: string | null }>;
}

export const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
