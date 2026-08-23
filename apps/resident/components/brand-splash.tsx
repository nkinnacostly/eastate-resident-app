import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

/**
 * The splash the user actually looks at.
 *
 * There are two, and only this one can carry a photograph. Android 12 replaced
 * the old full-screen splash with a system API that draws exactly one thing: a
 * centre-masked icon on a SOLID colour. No image, no wordmark, no gradient — it
 * is not styleable beyond those. iOS is more permissive, but matching the two
 * by hand means maintaining two splashes that drift.
 *
 * So the native splash is deliberately minimal — the mark on ink — and hands
 * over to this component the moment React can paint.
 */

/**
 * Matched to the system splash icon, which Android draws at 160dp inside its
 * 240dp canvas. The mark has to land in the same place at the same size in both
 * splashes or the handover shows two logos sliding past each other — which is
 * exactly what it did when this was 104dp and offset upwards.
 */
const MARK = 160;

export function BrandSplash({ onLayout }: { onLayout?: (e: LayoutChangeEvent) => void }) {
  return (
    <View className="flex-1 bg-ink" onLayout={onLayout}>
      <Image
        source={require('@/assets/images/splash-gate.jpg')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        // The photograph is the mood, not the message — it must never delay the
        // first paint. Ink underneath means a slow decode reads as a dark
        // screen, which is what the native splash just showed anyway.
        transition={260}
        accessible={false}
      />

      {/*
        Deliberately light. An earlier, heavier wash (95% ink at the top) put
        the gate out entirely and the whole screen read as flat charcoal — if
        the photograph cannot be seen there is no reason to ship one. This is
        just enough to seat the mark and keep the wordmark legible.
      */}
      <LinearGradient
        colors={['#16181cD9', '#16181c8C', '#16181c40', '#16181c73']}
        locations={[0, 0.34, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* The mark is centred on the screen, matching the system splash. */}
      <View className="flex-1 items-center justify-center">
        <Image
          source={require('@/assets/images/splash-icon.png')}
          style={{ width: MARK, height: MARK }}
          contentFit="contain"
          accessible={false}
        />

        {/* Absolutely positioned so the wordmark hangs BELOW the mark without
            pushing it off centre — laid out in flow, its height would shift the
            mark upwards and break the alignment above. */}
        <View
          style={{ position: 'absolute', top: '50%', marginTop: MARK / 2 + 22 }}
          className="w-full items-center px-8"
        >
          <Text
            className="font-jk-xb text-canvas"
            style={{ fontSize: 20, letterSpacing: 3 }}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            MY ESTATE ACCESS
          </Text>
        </View>
      </View>
    </View>
  );
}
