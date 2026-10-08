import { supabase } from './supabase';

/**
 * An estate asking this user to work its gate.
 *
 * Exists because an admin can no longer attach an EXISTING account as a guard
 * on their say-so. Typing somebody's email into the dashboard used to make
 * them a guard at that estate without asking them; onboard-guard now files an
 * invitation instead, and only the person themselves -- signed in with their
 * own password -- can accept it.
 */
export interface GuardInvite {
  invite_id: string;
  estate_id: string;
  estate_name: string;
  invited_at: string;
}

export type InviteAnswer = 'accepted' | 'declined' | 'not_found';

/**
 * This user's PENDING invitations, oldest first.
 *
 * No user id is sent: my_guard_invites reads it from the session, so there is
 * no parameter through which one person could list another's.
 */
export async function listGuardInvites(): Promise<GuardInvite[]> {
  const { data, error } = await supabase.rpc('my_guard_invites');
  if (error) throw new Error(error.message);
  return (data ?? []) as GuardInvite[];
}

/**
 * Accept or decline one invitation.
 *
 * 'accepted' means the membership exists by the time this returns, but the
 * post on screen does not know yet -- see recheckPost in shift.tsx.
 *
 * 'not_found' covers every reason the invitation is no longer this user's to
 * answer (already answered on another phone, withdrawn, the estate closed),
 * and deliberately does not say which: someone else's invitation answers the
 * same way, so an id cannot be probed.
 */
export async function respondToGuardInvite(
  inviteId: string,
  accept: boolean,
): Promise<InviteAnswer> {
  const { data, error } = await supabase.rpc('respond_to_guard_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  if (data === 'accepted' || data === 'declined' || data === 'not_found') return data;
  // Typed as plain text by the generator. Anything else is a contract change
  // on the server, and guessing at it could tell a guard they have a post
  // they do not.
  throw new Error(`Unexpected answer from the server: ${String(data)}`);
}
