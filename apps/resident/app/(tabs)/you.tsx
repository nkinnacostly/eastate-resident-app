import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, View, Pressable } from 'react-native';

import { ChevronRight } from '@/components/icons';
import { Card, Chip, Screen, SecondaryButton } from '@/components/ui';
import { applyLockPreference, lockEnabledNow } from '@/lib/app-lock';
import { useAuth } from '@/lib/auth';
import {
  authenticate,
  getCapability,
  methodLabel,
  type BiometricCapability,
} from '@/lib/biometrics';

export default function You() {
  const { session, memberships, activeEstateId, setActiveEstateId, signOut, deleteAccount } =
    useAuth();
  const [deleting, setDeleting] = useState(false);

  // Biometric app lock. `cap` is null until we know what the device offers —
  // the row stays hidden until then rather than flashing a control that may
  // not apply to this phone.
  const [cap, setCap] = useState<BiometricCapability | null>(null);
  const [lockOn, setLockOn] = useState(lockEnabledNow());
  const [lockBusy, setLockBusy] = useState(false);

  useEffect(() => {
    void getCapability().then(setCap);
  }, []);

  /**
   * Turning the lock ON requires passing it first.
   *
   * Otherwise someone could enable a lock they cannot themselves open — an
   * enrolled face that is not theirs, a sensor that no longer reads their
   * finger — and hand the next launch a barrier nobody can clear. Proving it
   * works once, here, is the cheapest possible moment to find that out.
   *
   * Turning it OFF deliberately does NOT require a prompt: the app is already
   * unlocked and in their hands, so demanding proof to REMOVE a lock only
   * punishes the person whose biometrics have stopped working — exactly the
   * person who most needs to switch it off.
   */
  const toggleLock = async (next: boolean) => {
    if (lockBusy) return;
    setLockBusy(true);
    try {
      if (next) {
        const res = await authenticate('Confirm to turn on app lock');
        if (!res.success) {
          if (!res.cancelled) {
            Alert.alert(
              'Could not turn on app lock',
              'That did not verify, so the lock has been left off. Nothing has changed.',
            );
          }
          return;
        }
      }
      await applyLockPreference(next);
      setLockOn(next);
    } finally {
      setLockBusy(false);
    }
  };

  const meta = session?.user.user_metadata ?? {};
  const fullName = (meta.full_name as string | undefined) ?? 'Resident';
  const email = session?.user.email ?? '';

  // Resolved from the HOUSE the admin approved them into. `user_metadata` still
  // carries whatever was typed at sign-up, but that is a REQUEST, not a fact —
  // showing it would tell a resident they live somewhere the estate has no
  // record of.
  const active = memberships.find((m) => m.estate_id === activeEstateId) ?? null;
  const activeHouse = active?.house_number ?? null;


  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      'This erases your profile, your estate access and every code you have ' +
        'generated. It cannot be undone.\n\nEntries already recorded at the gate ' +
        'stay in the estate\u2019s security log, with no link back to you.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const result = await deleteAccount();
            setDeleting(false);
            // On success the session is already cleared, so the gate sends this
            // screen back to sign-in on its own — nothing to navigate here.
            if (result.status === 'error') {
              Alert.alert('Account not deleted', result.message);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-28">
        <View className="mt-2 h-[120px] rounded-hero bg-lime" />
        <View className="-mt-8 ml-1 h-16 w-16 rounded-[22px] border-4 border-canvas bg-hair" />

        <View className="mt-4">
          <Text className="font-jk-xb text-title tracking-tight text-ink">{fullName}</Text>
          <Text className="mt-1.5 font-jk text-sub text-muted">
            {email}
            {activeHouse ? ` · House ${activeHouse}` : ''}
          </Text>
        </View>

        <Text className="mt-6 font-jk-xb text-label tracking-label text-muted">YOUR ESTATES</Text>

        <View className="mt-3 gap-2.5">
          {memberships.map((m) => {
            const current = m.estate_id === activeEstateId;
            return (
              <Pressable key={m.id} onPress={() => setActiveEstateId(m.estate_id)}>
                <Card className="flex-row items-center justify-between p-4">
                  <View>
                    <Text className="font-jk-xb text-body text-ink">{m.estate_name}</Text>
                    {/* Each row shows its OWN unit — using the active estate's
                        unit here would mislabel every other estate. */}
                    <Text className="mt-1 font-jk text-micro capitalize text-muted">
                      {m.role}
                      {m.house_number ? ` · House ${m.house_number}` : ''}
                    </Text>
                  </View>
                  {current ? <Chip label="Current" /> : <ChevronRight color="#8b9096" size={16} />}
                </Card>
              </Pressable>
            );
          })}

          {memberships.length === 0 ? (
            <Card className="p-4">
              <Text className="font-jk text-sub text-muted">
                No estate access yet. An admin has to approve you before codes work.
              </Text>
            </Card>
          ) : null}
        </View>

        {/* Several residents share one house, each on their own phone. This is
            how the second person gets in — so the code has to be visible to
            someone already approved, not just to the landlord. */}
        {active?.house_code ? (
          <>
            <Text className="mt-8 font-jk-xb text-label tracking-label text-muted">
              SOMEONE ELSE IN YOUR HOUSE?
            </Text>
            <Card className="mt-3 p-4">
              <Text className="font-jk text-sub leading-[19px] text-muted">
                They sign up, then enter this estate&apos;s code and your house code. An admin
                approves them the same way they approved you.
              </Text>
              <View className="mt-3 flex-row items-center gap-2.5">
                <View className="rounded-field bg-field px-3.5 py-2">
                  <Text className="font-jk-xb tracking-code text-[17px] text-ink">
                    {active.house_code}
                  </Text>
                </View>
                <Text className="font-jk text-micro text-muted">House {active.house_number}</Text>
              </View>
            </Card>
          </>
        ) : null}

        <SecondaryButton title="Sign out" onPress={signOut} className="mt-8" />

        {/* Required in-app by App Store guideline 5.1.1(v) and Google Play's
            account deletion policy. Both reject a flow that only deactivates,
            and Apple rejects one that makes you email support, so this has to
            sit in plain sight rather than behind a menu. */}
        {cap?.available ? (
          <>
            <Text className="mt-10 font-jk-xb text-label tracking-label text-muted">SECURITY</Text>
            <Card className="mt-3 p-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-4">
                  <Text className="font-jk-xb text-body capitalize text-ink">
                    {methodLabel(cap)} lock
                  </Text>
                  <Text className="mt-1.5 font-jk text-sub leading-[19px] text-muted">
                    Ask for {methodLabel(cap)} before showing your codes, when you open the app
                    and after it has been in the background for a minute.
                  </Text>
                </View>
                <Switch
                  value={lockOn}
                  onValueChange={(v) => void toggleLock(v)}
                  disabled={lockBusy}
                  accessibilityLabel={`${methodLabel(cap)} lock`}
                  trackColor={{ false: '#e2e8ef', true: '#cdf24a' }}
                  thumbColor="#ffffff"
                />
              </View>
              <Text className="mt-3 font-jk text-micro leading-[17px] text-muted">
                Your phone passcode still works if {methodLabel(cap)} does not, and you can
                always sign out from the lock screen. This protects the app on this device — it
                is not a second password on your account.
              </Text>
            </Card>
          </>
        ) : null}

        <Text className="mt-10 font-jk-xb text-label tracking-label text-muted">ACCOUNT</Text>
        <Card className="mt-3 p-4">
          <Text className="font-jk text-sub leading-[19px] text-muted">
            Deleting your account erases your profile, your estate access and every code you
            have generated. Entries already recorded at the gate stay in the estate&apos;s
            security log, with no link back to you.
          </Text>
          <Pressable
            onPress={confirmDelete}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            className="mt-4 h-11 flex-row items-center justify-center rounded-field bg-coral-wash active:opacity-70"
          >
            {deleting ? (
              <ActivityIndicator color="#a33c2b" />
            ) : (
              <Text className="font-jk-xb text-body text-coral-ink">Delete my account</Text>
            )}
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}
