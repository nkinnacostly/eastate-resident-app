// expo-router is exercised through mocks so tests assert NAVIGATION INTENT
// rather than rendering a whole navigator.
jest.mock('expo-router', () => ({
  useRouter: () => global.__router,
  useLocalSearchParams: () => global.__params ?? {},
  useSegments: () => [],
  // Screens under test render outside a navigator, so there is no focus event
  // to wait for — run the effect on mount.
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({
  useFonts: () => [true],
  PlusJakartaSans_400Regular: 'x',
  PlusJakartaSans_500Medium: 'x',
  PlusJakartaSans_600SemiBold: 'x',
  PlusJakartaSans_700Bold: 'x',
  PlusJakartaSans_800ExtraBold: 'x',
}));
