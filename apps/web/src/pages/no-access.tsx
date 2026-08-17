import { useAuth } from '../lib/auth';

/**
 * Signed in, but not an admin anywhere.
 *
 * Residents and guards share this login. Rather than a blank dashboard or a
 * misleading error, say plainly that the account is fine but has no estate to
 * administer.
 */
export function NoAccess() {
  const { session, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-[440px] rounded-pane bg-canvas p-8">
        <h1 className="text-[24px] font-extrabold tracking-tight">No estate to manage</h1>
        <p className="mt-2 text-[13.5px] leading-[21px] text-muted">
          You are signed in as <strong className="text-ink">{session?.user.email}</strong>, but this
          account is not an admin at any estate. Residents and guards use the mobile apps — this
          dashboard is for estate admins.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 h-11 rounded-chip bg-field px-5 text-[13px] font-extrabold text-muted"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
