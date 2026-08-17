import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Input, PrimaryButton } from '@/components/ui';
import { myPendingJoinRequests, requestHouseAccess, type JoinResult } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Copy for the outcomes that leave someone still outside. */
const REJECTION: Record<string, { title: string; body: string }> = {
  unknown_estate: {
    title: 'Estate code not recognised',
    body: 'Check it with your estate office.',
  },
  unknown_house: {
    title: 'House code not recognised',
    body: 'Check it with your landlord.',
  },
  rate_limited: {
    title: 'Too many tries',
    body: 'Wait a minute and try again.',
  },
};

/**
 * Shown to a signed-in resident who belongs to no estate yet.
 *
 * The two codes are collected at sign-up, so most people arrive here already
 * waiting and this screen only has to say so. It still keeps the form, because
 * it has to serve three other arrivals: someone whose codes did not match,
 * someone who registered before the codes were part of sign-up, and someone
 * moving to a second estate.
 *
 * Whether a request exists is read from the server, not remembered on the
 * device — local state is empty after a restart, and showing a blank form to
 * someone who is simply waiting reads as "nothing was sent".
 */
export default function Join() {
  const { signOut, refreshMemberships, takeSignUpJoinResult } = useAuth();
  const [estateCode, setEstateCode] = useState('');
  const [houseCode, setHouseCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sent, setSent] = useState<{ estate: string; house: string | null } | null>(null);
  const [rejected, setRejected] = useState<{ title: string; body: string } | null>(null);

  const apply = useCallback(
    async (res: JoinResult) => {
      switch (res.result) {
        case 'ok':
        case 'already_pending':
          setRejected(null);
          setSent({ estate: res.estate_name, house: res.house_number });
          return;
        case 'already_a_member':
          // An admin approved them while this was open. Reloading memberships
          // is what lets the gate move them on.
          await refreshMemberships();
          return;
        default:
          setSent(null);
          setRejected(REJECTION[res.result]);
      }
    },
    [refreshMemberships],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      // The sign-up handoff first: it is the only place a "code not recognised"
      // can come from, since a rejected request leaves nothing on the server to
      // read back.
      const fromSignUp = takeSignUpJoinResult();
      if (fromSignUp) await apply(fromSignUp);

      try {
        const pending = await myPendingJoinRequests();
        if (!live) return;
        const first = pending[0];
        if (first) {
          setRejected(null);
          setSent({ estate: first.estate_name, house: first.house_number });
        }
      } catch {
        // A failed lookup is not evidence there is no request — fall through to
        // the form rather than claiming nothing was sent.
      } finally {
        if (live) setChecking(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [apply, takeSignUpJoinResult]);

  const submit = async () => {
    if (!estateCode.trim() || !houseCode.trim()) {
      Alert.alert('Both codes needed', 'Your estate gives you one; your landlord gives you the other.');
      return;
    }
    setBusy(true);
    try {
      await apply(await requestHouseAccess(estateCode.trim(), houseCode.trim()));
    } catch (e) {
      Alert.alert('Could not send the request', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (sent) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 justify-center px-5">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Waiting on approval
          </Text>
          <Text className="mt-3 max-w-measure font-jk text-body text-muted">
            {sent.house ? `House ${sent.house}, ${sent.estate}` : sent.estate}. An estate admin has
            to approve you before you can make codes. You will see this screen until they do.
          </Text>
          <PrimaryButton
            title="Check again"
            onPress={() => void refreshMemberships()}
            className="mt-7"
          />
          <Pressable onPress={signOut} className="mt-4 h-11 justify-center">
            <Text className="text-center font-jk-sb text-sub text-muted">Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-5"
      >
        <View className="flex-1 justify-center">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            {rejected ? rejected.title : 'Join your estate'}
          </Text>
          <Text className="mt-3 max-w-measure font-jk text-body text-muted">
            {rejected
              ? `${rejected.body} Your account is saved — enter the codes again below.`
              : 'Two codes: one from your estate, one from your landlord. Together they place you in the right house.'}
          </Text>

          <View className="mt-7 gap-3">
            <Input
              placeholder="Estate code"
              autoCapitalize="characters"
              autoCorrect={false}
              value={estateCode}
              onChangeText={setEstateCode}
            />
            <Input
              placeholder="House code"
              autoCapitalize="characters"
              autoCorrect={false}
              value={houseCode}
              onChangeText={setHouseCode}
            />
          </View>

          <PrimaryButton
            title={busy ? 'Sending…' : 'Request access'}
            onPress={submit}
            disabled={busy}
            className="mt-5"
          />

          <Pressable onPress={signOut} className="mt-4 h-11 justify-center">
            <Text className="text-center font-jk-sb text-sub text-muted">Sign out</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
