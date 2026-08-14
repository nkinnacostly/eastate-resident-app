import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { ClockIcon, HomeIcon, KeyIcon, PersonIcon } from '@/components/icons';
import { useCodes } from '@/lib/codes';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TABS = [
  { name: 'index', label: 'Home', Icon: HomeIcon },
  { name: 'codes', label: 'Codes', Icon: KeyIcon },
  { name: 'history', label: 'History', Icon: ClockIcon },
  { name: 'you', label: 'You', Icon: PersonIcon },
] as const;

/**
 * Floating dark bar with a lime pill for the active tab.
 *
 * Generating is an ACTION, not a destination, so it stays a button inside Home
 * rather than becoming a fifth tab or a centre plus. Only the active tab shows
 * its label — dropping the other three labels buys the room for the pill.
 */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { live } = useCodes();

  return (
    <View className="absolute inset-x-3.5 bottom-5 h-[62px] flex-row items-center gap-1 rounded-nav bg-ink px-2.5">
      {state.routes.map((route, index) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;
        const { Icon } = tab;
        // A dot means codes are live now; the screen body states how many.
        const showBadge = tab.name === 'codes' && live.length > 0 && !focused;

        return (
          <AnimatedPressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            onPress={() => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            // The pill grows and the others shrink; a spring on layout lets it
            // travel between tabs instead of teleporting.
            layout={LinearTransition.springify().damping(18).stiffness(180)}
            className={
              focused
                ? 'h-11 flex-row items-center justify-center gap-2 rounded-2xl bg-lime px-4'
                : 'h-11 flex-1 flex-row items-center justify-center rounded-2xl'
            }
          >
            <View>
              <Icon color={focused ? '#16181c' : '#868c93'} />
              {showBadge ? (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  exiting={FadeOut.duration(150)}
                  className="absolute -right-1 -top-1 h-[7px] w-[7px] rounded-full border-2 border-ink bg-lime"
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
        // Tabs hard-cut by default. 'shift' is one of the v7 presets
        // (fade | shift | none) — verified against the React Navigation 7 docs.
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
