import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { CheckIcon, LogIcon, ShiftIcon } from '@/components/icons';
import { TAB_BAR_BOTTOM, TAB_BAR_HEIGHT } from '@/components/ui';
import { useShift } from '@/lib/shift';

const TABS = [
  { name: 'index', label: 'Check', Icon: CheckIcon },
  { name: 'log', label: 'Log', Icon: LogIcon },
  { name: 'shift', label: 'Shift', Icon: ShiftIcon },
] as const;

const INK = '#16181c';
const DIM = '#868c93';

/**
 * Three destinations only. A CORAL dot on Log means verifications are queued to
 * upload — coral, not lime, because it is the same "not yet authoritative"
 * signal as the offline badge.
 *
 * WHY NOTHING SPRINGS ANY MORE
 *
 * This bar used to animate its layout: the focused tab grew to fit a label, the
 * other two shrank to absorb it, and a spring (damping 18, stiffness 180)
 * carried the change. At that stiffness it visibly overshot and settled. The
 * resident app had the same bar and the same problem, and the fix is the same
 * here — navigation is the most-repeated gesture in either app, and anything
 * that draws attention to itself on the hundredth tap is a cost.
 *
 * So there is no layout animation. Each tab keeps a third of the bar, the lime
 * pill cross-fades in place, and nothing moves. 160ms of opacity, nothing else.
 *
 * WHY ALL THREE LABELS ARE VISIBLE
 *
 * Only the focused label used to be drawn, because the growing pill needed the
 * room the other two were using. With fixed widths that trade is gone. A guard
 * reading this bar at a gate at 2am should not have to tap a tab to find out
 * where it goes.
 *
 * WHY THE BAR IS STILL DARK
 *
 * The resident app's bar is light glass; this one is ink, and that difference
 * is deliberate rather than an oversight. It is the same reason coral appears
 * nowhere near an admit screen: a guard reads this app in the dark, one-handed,
 * with someone waiting, and the two apps must not be mistakable for each other
 * at a glance.
 */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { queued } = useShift();

  return (
    <View
      className="absolute inset-x-3.5 flex-row items-center rounded-nav bg-ink px-2"
      style={{ bottom: TAB_BAR_BOTTOM, height: TAB_BAR_HEIGHT }}
    >
      {state.routes.map((route, index) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;
        const { Icon } = tab;
        const showBadge = tab.name === 'log' && queued > 0 && !focused;

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
                <Icon color={focused ? INK : DIM} />
                {showBadge ? (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(150)}
                    // Ringed in the bar's own ink so it reads as a dot rather
                    // than smudging into the icon behind it.
                    className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-ink bg-coral"
                  />
                ) : null}
              </View>
            </View>
            <Text
              className={
                focused
                  ? 'font-jk-b text-[10.5px] leading-[13px] text-canvas'
                  : 'font-jk-md text-[10.5px] leading-[13px]'
              }
              // The dim grey is the same value the unfocused icon uses, so a
              // resting tab reads as one object rather than an icon and a
              // label at two different weights of grey.
              style={focused ? undefined : { color: DIM }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
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
        // 'fade' rather than 'shift'. Shift slides the outgoing screen
        // sideways, which paired with an indicator that also travelled; now
        // that nothing in the bar moves, a slide is the only thing left
        // swinging. One of the v7 presets (fade | shift | none).
        animation: 'fade',
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
