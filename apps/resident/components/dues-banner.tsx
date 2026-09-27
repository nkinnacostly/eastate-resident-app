import { formatMoney } from '@estate/core';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { DuesStatus } from '@/lib/dues-status';

/**
 * Tells the resident they owe money BEFORE they find out by being refused.
 *
 * The reason this exists, in full, because it is the kind of thing that gets
 * "simplified" away later: a resident with overdue dues pressed Generate and
 * got "Could not generate a code. Please try again." The refusal was correct.
 * Everything around it was wrong — trying again could never work, nothing
 * beforehand said a penny was owed, and the message named neither the cause
 * nor the cure.
 *
 * So arrears stop being an error discovered at the moment of failure and
 * become state the first screen already shows.
 *
 * ─── Two states, two sets of words ──────────────────────────────────────────
 *
 * An estate may bill dues and restrict nobody — enforcement is a separate,
 * deliberately separate, decision. Telling that resident "codes are paused"
 * would be a lie their next tap disproves, and once an app has lied about
 * something checkable it is not believed about anything else. So:
 *
 *   blocked          — codes ARE paused. Say so plainly, and say what fixes it.
 *   owesButNotBlocked — money is owed, codes still work. A nudge, not a wall.
 */
export function DuesBanner({ status }: { status: DuesStatus }) {
  const router = useRouter();

  if (!status.blocked && !status.owesButNotBlocked) return null;

  const amount = formatMoney(status.totalOwedMinor, status.currency);
  const blocked = status.blocked;

  return (
    <Pressable
      accessibilityRole="button"
      // The whole banner is the target, not a small "Pay" link. Someone reading
      // this is being told they cannot do the thing they opened the app to do;
      // the way out should be impossible to miss.
      onPress={() => router.push('/dues')}
      className={`mt-6 rounded-2xl p-5 active:opacity-80 ${blocked ? 'bg-coral-soft' : 'bg-field'}`}
    >
      <Text
        className={`font-jk-xb text-[11px] tracking-[1.2px] ${blocked ? 'text-coral-ink' : 'text-muted'}`}
      >
        {blocked ? 'CODES PAUSED' : 'DUES OUTSTANDING'}
      </Text>

      <Text
        className={`mt-2 font-jk-b text-[17px] leading-[23px] ${blocked ? 'text-coral-ink' : 'text-ink'}`}
      >
        {blocked
          ? `You cannot make new visitor codes until your ${amount} dues are paid.`
          : `You owe ${amount} in estate dues.`}
      </Text>

      <Text
        className={`mt-2 font-jk text-sub leading-[20px] ${blocked ? 'text-coral-ink' : 'text-muted'}`}
      >
        {blocked
          ? // Named explicitly, because being locked out of your own gate is
            // the fear this sentence exists to remove. Overdue dues pause code
            // GENERATION and nothing else (Technical Design §5.4).
            'Your own access to the estate is not affected, and codes you have already shared still work.'
          : 'Codes still work — this estate does not pause them for unpaid dues.'}
      </Text>

      <View className="mt-4 flex-row items-center">
        <Text className={`font-jk-xb text-sub ${blocked ? 'text-coral-ink' : 'text-ink'}`}>
          {blocked ? 'Pay now' : 'See what is owed'} →
        </Text>
      </View>
    </Pressable>
  );
}
