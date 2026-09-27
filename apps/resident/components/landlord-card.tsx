import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { Card, Eyebrow } from './ui';

/**
 * Who to contact when the landlord is the one billed.
 *
 * In a house-billed estate a tenant cannot settle a bill they were never
 * given — and telling them "your dues are unpaid" while offering only a Pay
 * button is the version of this screen that makes them resent the app. So this
 * leads with the person who can actually fix it, one tap away.
 *
 * Tap targets, not text. Someone reading this is standing at a gate with a
 * visitor waiting; a phone number they have to memorise and retype is a
 * different product from one they can call.
 */
export function LandlordCard({
  name,
  phone,
  email,
  estateName,
}: {
  name: string | null;
  phone: string | null;
  email: string | null;
  estateName: string;
}) {
  const hasContact = Boolean(phone || email);

  // A house can exist with no landlord on record — the column is nullable, and
  // backfilled houses often have nothing. Sending the resident to the estate
  // office is a real answer; an empty card is not.
  if (!hasContact) {
    return (
      <Card className="mt-4 p-5">
        <Eyebrow className="text-muted">WHO TO CONTACT</Eyebrow>
        <Text className="mt-2 font-jk text-sub leading-[20px] text-muted">
          These dues are billed to the owner of your house, and we do not have their contact
          details on record. {estateName} can tell you who to speak to.
        </Text>
      </Card>
    );
  }

  const digits = phone?.replace(/[^\d+]/g, '') ?? '';

  return (
    <Card className="mt-4 p-5">
      <Eyebrow className="text-muted">WHO TO CONTACT</Eyebrow>
      <Text className="mt-2 font-jk-b text-body text-ink">{name ?? 'Your landlord'}</Text>
      <Text className="mt-1 font-jk text-sub leading-[20px] text-muted">
        These dues are billed to the owner of your house, not to you. Ask them to settle it and
        your codes come back straight away.
      </Text>

      <View className="mt-4 gap-2">
        {phone ? (
          <>
            <Action label={`Call ${phone}`} onPress={() => void Linking.openURL(`tel:${digits}`)} />
            <Action
              label="WhatsApp"
              onPress={() => {
                // wa.me wants the number without a leading +, and it is the app
                // most landlords here actually answer on.
                const wa = digits.replace(/^\+/, '');
                void Linking.openURL(`https://wa.me/${wa}`);
              }}
            />
            {/* iOS and Android disagree on the separator before the body. */}
            <Action
              label="Text message"
              onPress={() =>
                void Linking.openURL(
                  `sms:${digits}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(
                    `Hello${name ? ` ${name}` : ''}, the estate dues for our house at ${estateName} are outstanding. Could you settle them? I cannot generate visitor codes until they are paid.`,
                  )}`,
                )
              }
            />
          </>
        ) : null}
        {email ? (
          <Action label={email} onPress={() => void Linking.openURL(`mailto:${email}`)} />
        ) : null}
      </View>
    </Card>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-12 items-center justify-center rounded-2xl bg-field active:opacity-70"
    >
      <Text className="font-jk-b text-sub text-ink">{label}</Text>
    </Pressable>
  );
}
