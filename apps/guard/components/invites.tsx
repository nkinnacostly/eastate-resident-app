import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { listGuardInvites, respondToGuardInvite, type GuardInvite } from '@/lib/invites';
import { useShift } from '@/lib/shift';

import { Card, PrimaryButton } from './ui';

/** What a network failure reads as. "TypeError: Network request failed" is not a sentence. */
const OFFLINE =
  'This phone is offline. Answering an invitation needs a connection — try again when it is back.';

/**
 * What start-shift shows somebody who is signed in but is not a guard anywhere.
 *
 * That is exactly where an invited guard lands. An admin can no longer attach
 * an existing account to their estate by typing its email; onboard-guard files
 * an invitation instead, and until the person accepts it here they have no
 * post, so the Gate keeps them on start-shift. Each pending invitation is
 * offered with Accept and Decline.
 *
 * With nothing pending this is the notice start-shift has always shown, word
 * for word, so a user without invitations sees the screen they saw before.
 *
 * Keyed by user at the call site: a different account signing in on the same
 * screen must not see the previous account's invitations for a render.
 */
export function PendingInvites() {
  const { online, recheckPost } = useShift();
  // Null until the server has answered once -- distinct from "none".
  const [invites, setInvites] = useState<GuardInvite[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<{ inviteId: string; accept: boolean } | null>(null);
  const [failure, setFailure] = useState<{ inviteId: string; message: string } | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  // Every ask is numbered and only the latest may write, so an answer that
  // lands after a newer one cannot paint an old list over a fresh one -- the
  // case being a decline's re-list racing the reconnect's.
  const asked = useRef(0);
  const load = useCallback(async () => {
    const mine = ++asked.current;
    try {
      const rows = await listGuardInvites();
      if (mine !== asked.current) return;
      setInvites(rows);
      setLoadFailed(false);
    } catch (e) {
      if (mine !== asked.current) return;
      // A list we already have is kept: losing signal does not withdraw an
      // invitation, and wiping the cards would hide the buttons for nothing.
      console.warn('[invites] could not list invitations', (e as Error).message);
      setLoadFailed(true);
    }
  }, []);

  // Asked on arrival and again whenever the connection changes -- a guard who
  // opens the app at a gate with no signal should not have to find a button
  // to see the invitation once the signal comes back.
  useEffect(() => {
    void load();
  }, [load, online]);

  const respond = async (invite: GuardInvite, accept: boolean) => {
    setBusy({ inviteId: invite.invite_id, accept });
    setFailure(null);
    try {
      const answer = await respondToGuardInvite(invite.invite_id, accept);
      if (answer === 'accepted') {
        setJoined(invite.estate_name);
        // The membership exists now, but nothing about the SESSION changed,
        // and the post is resolved per session. Ask again; the Gate moves
        // them on to the keypad the moment it resolves.
        recheckPost();
        return;
      }
      // 'declined' is gone for good. 'not_found' is gone too -- answered on
      // another phone, withdrawn, or the estate closed -- and the server will
      // not say which, so the list on screen is out of date: ask again rather
      // than guess what else changed.
      setInvites((prev) => prev?.filter((i) => i.invite_id !== invite.invite_id) ?? null);
      if (answer === 'not_found') await load();
    } catch (e) {
      const message = online ? (e as Error).message : OFFLINE;
      // On the card as well as in the alert, so the reason survives the
      // guard dismissing it -- the same rule the sign-in form follows.
      setFailure({ inviteId: invite.invite_id, message });
      Alert.alert(accept ? 'Could not accept' : 'Could not decline', message);
    } finally {
      setBusy(null);
    }
  };

  if (joined) {
    return (
      <Card className="mt-4 bg-lime p-4">
        <Text className="font-jk-b text-sub text-ink">You are now a guard at {joined}.</Text>
        <Text className="mt-1 font-jk text-sub text-ink">
          Opening your post… Still here?{' '}
          <Text className="font-jk-b underline" onPress={recheckPost}>
            Try again
          </Text>
        </Text>
      </Card>
    );
  }

  if (!invites?.length) {
    return (
      <Card className="mt-4 bg-coral-wash p-4">
        <Text className="font-jk-md text-sub text-coral-ink">
          This account is signed in but is not an active guard at any estate. An admin has to
          assign you to a post.
        </Text>
        {/* Only when there is no list at all. "None" and "could not ask" must
            not read the same: one is an answer, the other is a phone at a gate
            with no signal and an invitation it cannot see yet. */}
        {loadFailed && invites === null ? (
          <Text className="mt-2 font-jk text-sub text-coral-ink">
            Could not check for invitations.{' '}
            <Text className="font-jk-b" onPress={() => void load()}>
              Check again
            </Text>
          </Text>
        ) : null}
      </Card>
    );
  }

  return (
    <View className="mt-4 gap-3">
      {invites.map((invite) => {
        // True while accepting this one, false while declining it.
        const answering = busy?.inviteId === invite.invite_id ? busy.accept : null;
        return (
          <Card key={invite.invite_id} className="p-4">
            <Text className="font-jk-b text-body text-ink">
              {invite.estate_name} invited you to work the gate
            </Text>
            <Text className="mt-1 font-jk text-sub text-muted">
              Only accept an estate you actually work for. Accepting puts you on its gate straight
              away.
            </Text>
            <View className="mt-3 flex-row gap-2.5">
              <PrimaryButton
                title={answering === true ? 'Accepting…' : 'Accept'}
                // Named for the estate: with two invitations on screen, a
                // screen reader would otherwise announce two identical
                // "Accept" buttons with nothing to tell them apart.
                accessibilityLabel={`Accept ${invite.estate_name}`}
                onPress={() => void respond(invite, true)}
                // Every button, not only this card's: accepting two at once
                // races two memberships into existence, and which one becomes
                // the post would be down to which committed first.
                disabled={busy !== null}
                className="flex-1"
              />
              <PrimaryButton
                title={answering === false ? 'Declining…' : 'Decline'}
                accessibilityLabel={`Decline ${invite.estate_name}`}
                onPress={() => void respond(invite, false)}
                disabled={busy !== null}
                className="flex-1 bg-field"
              />
            </View>
            {failure?.inviteId === invite.invite_id ? (
              <Text className="mt-2 font-jk-md text-micro text-coral-ink">{failure.message}</Text>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
