import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { CheckIcon, LogIcon, ShiftIcon } from '@/components/icons';
import { useShift } from '@/lib/shift';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TABS = [
  { name: 'index', label: 'Check', Icon: CheckIcon },
  { name: 'log', label: 'Log', Icon: LogIcon },
  { name: 'shift', label: 'Shift', Icon: ShiftIcon },
] as const;

/**
 * Three destinations only. A CORAL dot on Log means verifications are queued to
 * upload — coral, not lime, because it is the same "not yet authoritative"
 * signal as the offline badge.
 */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { queued } = useShift();

  return (
    <View className="absolute inset-x-3.5 bottom-5 h-[58px] flex-row items-center gap-1 rounded-nav bg-ink px-2.5">
      {state.routes.map((route, index) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;
        const { Icon } = tab;
        const showBadge = tab.name === 'log' && queued > 0 && !focused;

        return (
          <AnimatedPressable
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
            layout={LinearTransition.springify().damping(18).stiffness(180)}
            className={
              focused
                ? 'h-[42px] flex-row items-center justify-center gap-2 rounded-[15px] bg-lime px-4'
                : 'h-[42px] flex-1 flex-row items-center justify-center rounded-[15px]'
            }
          >
            <View>
              <Icon color={focused ? '#16181c' : '#868c93'} />
              {showBadge ? (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  exiting={FadeOut.duration(150)}
                  className="absolute -right-1 -top-1 h-[7px] w-[7px] rounded-full border-2 border-ink bg-coral"
                />
              ) : null}
            </View>
            {focused ? (
              <Animated.Text
                entering={FadeIn.duration(160).delay(60)}
                className="font-jk-b text-sub text-ink"
              >
                {tab.label}
              </Animated.Text>
            ) : null}
          </AnimatedPressable>
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
        animation: 'shift',
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
