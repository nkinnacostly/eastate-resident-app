import { ScrollView, Text, View, Pressable } from 'react-native';

import { ChevronRight } from '@/components/icons';
import { Card, Chip, Screen, SecondaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function You() {
  const { session, memberships, activeEstateId, setActiveEstateId, signOut } = useAuth();

  const meta = session?.user.user_metadata ?? {};
  const fullName = (meta.full_name as string | undefined) ?? 'Resident';
  const email = session?.user.email ?? '';

  // Resolved from the HOUSE the admin approved them into. `user_metadata` still
  // carries whatever was typed at sign-up, but that is a REQUEST, not a fact —
  // showing it would tell a resident they live somewhere the estate has no
  // record of.
  const active = memberships.find((m) => m.estate_id === activeEstateId) ?? null;
  const activeHouse = active?.house_number ?? null;

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
      </ScrollView>
    </Screen>
  );
}
