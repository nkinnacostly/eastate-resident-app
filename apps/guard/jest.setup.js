// expo-router is exercised through mocks so tests assert NAVIGATION INTENT
// rather than rendering a whole navigator.
jest.mock('expo-router', () => ({
  useRouter: () => global.__router,
  useLocalSearchParams: () => global.__params ?? {},
  useSegments: () => [],
  // Screens under test are rendered outside a navigator, so there is no focus
  // to wait for — run the effect on mount.
  useFocusEffect: (cb) => require('react').useEffect(cb, [cb]),
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
}));

// Deterministic ids: a client_event_id is the dedupe key, so tests need to be
// able to assert on the exact value that was claimed.
let mockUuidSeq = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `evt-${++mockUuidSeq}`,
  getRandomBytes: (n) => new Uint8Array(n).fill(7),
}));
global.__resetUuidSeq = () => {
  mockUuidSeq = 0;
};

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true, type: 'WIFI' }),
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));

jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({
  useFonts: () => [true],
  PlusJakartaSans_400Regular: 'x',
  PlusJakartaSans_500Medium: 'x',
  PlusJakartaSans_600SemiBold: 'x',
  PlusJakartaSans_700Bold: 'x',
  PlusJakartaSans_800ExtraBold: 'x',
}));
