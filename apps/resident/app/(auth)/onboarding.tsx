import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInRight, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArrowRight } from '@/components/icons';
import { PrimaryButton } from '@/components/ui';
import { markOnboardingSeen } from '@/lib/onboarding';
import { CODE_LENGTH } from '@estate/core';

/**
 * Heroes are bundled, not fetched.
 *
 * This is the first screen of the app and it runs before sign-in, on whatever
 * connection the phone happens to have. Hotlinking (which the marketing site
 * does, correctly, for a page served over broadband) would leave three empty
 * boxes exactly where the product is meant to explain itself. Photo credits
 * are in assets/images/onboarding/CREDITS.md.
 *
 * Slide 2 has no photo on purpose: its claim is about what a code *is* and
 * when it dies, and the real artefact states that better than a stock image
 * of a gate can.
 */
const SLIDES = [
  {
    title: 'Give visitors a code, not your gate',
    body: `${CODE_LENGTH} characters, sent from your phone. No calls to the guard house.`,
    image: require('@/assets/images/onboarding/sending-a-code.jpg'),
    alt: 'A person typing a message on a phone held in both hands.',
  },
  {
    title: "One entry. Six hours. Then it's dead.",
    body: "A used code can't be reused, forwarded on, or screenshotted for later.",
    image: null,
    alt: null,
  },
  {
    title: 'Your visitor installs nothing',
    body: 'Send the code over WhatsApp or SMS. They read it out at the gate.',
    image: require('@/assets/images/onboarding/estate-gate.jpg'),
    alt: 'The entrance to a gated estate, with a boom barrier lowered across the road beside a guard house.',
  },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const router = useRouter();
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  /**
   * Every way out of the carousel goes through here, so none can forget to
   * record it. Not awaited: the write is a local boolean read on the *next*
   * cold start, and blocking a tap on storage would be felt for no gain.
   */
  const leave = (href: '/(auth)/sign-up' | '/(auth)/sign-in') => {
    void markOnboardingSeen();
    router.push(href);
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <View className="flex-1 px-5 pb-6">
        {/* Hero + copy are one centred group, so a tall screen splits its slack
            evenly above and below instead of stranding the copy against the top
            with a void beneath. The hero is proportional (4:3, capped) rather
            than the design's fixed 210px, which filled a quarter of this screen. */}
        {/* Keyed by slide index so each advance remounts and re-runs the
            entrance. Entering only, no exiting — an outgoing sibling stays in
            flow while it animates, which shoves the incoming slide down. */}
        <Animated.View
          key={i}
          entering={FadeInRight.duration(300)}
          className="flex-1 justify-center"
        >
          {slide.image ? (
            // overflow-hidden on the wrapper is what rounds the photo — expo-image
            // has no cssInterop registration here, so className would not reach it.
            // The image is an in-flow 100%/100% child rather than absolutely
            // positioned: Android's rounded-corner clipping is reliable for the
            // former and has historically not been for the latter.
            // bg-field is the colour behind the frame for the frame or two before
            // the bundled asset decodes, not a network placeholder.
            <View className="aspect-[4/3] max-h-[340px] w-full overflow-hidden rounded-hero bg-field">
              <Image
                source={slide.image}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                accessible
                accessibilityRole="image"
                accessibilityLabel={slide.alt ?? undefined}
              />
            </View>
          ) : (
            <View className="aspect-[4/3] max-h-[340px] w-full items-center justify-center gap-3 rounded-hero bg-ink">
              <Text className="font-jk-xb text-[34px] tracking-code text-lime">7K4P92</Text>
              <Text className="font-jk-b text-label tracking-label text-canvas/50">
                EXPIRES IN 5H 12M
              </Text>
            </View>
          )}

          {/* Headline and body share one measure — otherwise the ragged right
              edge of a 205px headline stops relating to full-width copy, and
              the block reads as misaligned even though both are flush left. */}
          <Text className="mt-9 max-w-measure font-jk-xb text-display tracking-tight text-ink">
            {slide.title}
          </Text>
          <Text className="mt-3 max-w-measure font-jk text-body text-muted">{slide.body}</Text>
        </Animated.View>

        {last ? (
          <View className="gap-2.5">
            <PrimaryButton title="Get started" onPress={() => leave('/(auth)/sign-up')} />
            <Pressable
              onPress={() => leave('/(auth)/sign-in')}
              className="h-11 justify-center"
            >
              <Text className="text-center font-jk-sb text-sub text-muted">
                I already have an account
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center justify-between">
            <View className="flex-row gap-1.5">
              {/* The active dot stretches into a bar rather than just
                  recolouring, so progress is legible from the motion alone. */}
              {SLIDES.map((_, n) => (
                <Animated.View
                  key={n}
                  layout={LinearTransition.springify().damping(16).stiffness(180)}
                  className={`h-1.5 rounded-full ${n === i ? 'w-5 bg-ink' : 'w-1.5 bg-ink/20'}`}
                />
              ))}
            </View>
            <View className="flex-row items-center gap-3.5">
              <Pressable
                onPress={() => leave('/(auth)/sign-in')}
                className="h-11 justify-center px-1"
              >
                <Text className="font-jk-sb text-sub text-muted">Skip</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next"
                onPress={() => setI(i + 1)}
                className="h-[46px] w-[46px] items-center justify-center rounded-full bg-ink active:opacity-80"
              >
                <ArrowRight color="#f7f9fb" size={19} />
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
