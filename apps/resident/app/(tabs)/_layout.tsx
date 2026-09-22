import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ClockIcon, HomeIcon, KeyIcon, PersonIcon } from '@/components/icons';
import { useCodes } from '@/lib/codes';

const TABS = [
  { name: 'index', label: 'Home', Icon: HomeIcon },
  { name: 'codes', label: 'Codes', Icon: KeyIcon },
  { name: 'history', label: 'History', Icon: ClockIcon },
  { name: 'you', label: 'You', Icon: PersonIcon },
] as const;

const INK = '#16181c';
const MUTED = '#8b9096';

/**
 * Floating glass bar with a lime pill behind the active icon.
 *
 * WHY THIS IS NOT THE OLD BOUNCY PILL
 *
 * The previous bar animated its layout: the active pill grew, the others
 * shrank, and a spring (damping 18, stiffness 180) carried the pill between
 * tabs. It read as playful, and at that stiffness it visibly overshot and
 * settled — which is exactly what makes an interface feel junior. Navigation
 * is the most-repeated gesture in the app; anything that draws attention to
 * itself on the hundredth tap is a cost, not a delight.
 *
 * So there is no layout animation at all now. Every tab keeps its width, the
 * lime pill cross-fades in place, and nothing overshoots. Motion is 160ms of
 * opacity and nothing else.
 *
 * WHY LABELS ARE ALWAYS VISIBLE
 *
 * The old bar showed only the active label, because the growing pill needed
 * the room the other three labels were using. With fixed widths that trade is
 * gone, so all four are legible at rest — which is what the reference does and
 * what a destination bar should do anyway: you should not have to tap a tab to
 * learn where it goes.
 *
 * WHY THE BLUR IS iOS-ONLY
 *
 * expo-blur's Android path renders through a different mechanism whose quality
 * varies by device and OS version, and a bar that looks muddy on half the
 * handsets is worse than one that is honestly opaque. Android gets a near
 * solid surface; iOS gets the real material. Both keep the same geometry, so
 * the layout is identical either way.
 */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { live } = useCodes();

  return (
    // Outer view carries the shadow; the inner one clips the blur. They cannot
    // be the same view — on iOS `overflow: hidden` clips the shadow away too.
    <View
      className="absolute inset-x-3.5 bottom-5"
      style={{
        shadowColor: INK,
        shadowOpacity: 0.1,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      }}
    >
      <View className="h-[66px] overflow-hidden rounded-[33px] border border-[#16181c0f]">
        {Platform.OS === 'ios' ? (
          <BlurView intensity={55} tint="light" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        ) : null}
        {/* Sits over the blur to lift it towards white. Without this the bar
            takes its value from whatever scrolls under it and the labels lose
            contrast against a dark card. */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.96)',
          }}
        />

        <View className="flex-1 flex-row items-center px-2">
          {state.routes.map((route, index) => {
            const tab = TABS.find((t) => t.name === route.name);
            if (!tab) return null;
            const focused = state.index === index;
            const { Icon } = tab;
            // A dot means codes are live now; the screen body states how many.
            const showBadge = tab.name === 'codes' && live.length > 0 && !focused;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.label}
                onPress={() => {
                  const e = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
                }}
                className="flex-1 items-center justify-center gap-[3px] py-1.5"
              >
                <View className="h-8 w-[52px] items-center justify-center">
                  {focused ? (
                    <Animated.View
                      entering={FadeIn.duration(160)}
                      exiting={FadeOut.duration(120)}
                      className="absolute inset-0 rounded-2xl bg-lime"
                    />
                  ) : null}
                  <View>
                    <Icon color={focused ? INK : MUTED} />
                    {showBadge ? (
                      <Animated.View
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(150)}
                        // Ringed in the bar's own surface so it reads as a dot
                        // rather than smudging into the icon behind it. Lime on
                        // white needs the ink ring to be visible at 8px.
                        className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-ink bg-lime"
                      />
                    ) : null}
                  </View>
                </View>
                <Text
                  className={
                    focused
                      ? 'font-jk-b text-[10.5px] leading-[13px] text-ink'
                      : 'font-jk-md text-[10.5px] leading-[13px] text-muted'
                  }
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: '#f7f9fb' },
        // 'fade' rather than 'shift'. Shift slides the outgoing screen sideways,
        // which pairs with a bar whose indicator also travels; now that nothing
        // in the bar moves, a slide is the only thing left swinging. One of the
        // v7 presets (fade | shift | none), verified against the React
        // Navigation 7 docs.
        animation: 'fade',
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
