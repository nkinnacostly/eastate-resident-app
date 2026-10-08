/**
 * Every link that opens this app from OUTSIDE passes through here first.
 *
 * expo-router calls `redirectSystemPath` with each incoming URL -- the one that
 * launched the app (`initial: true`) and any that arrive while it is running
 * (`initial: false`) -- and routes to whatever it returns. Verified against the
 * expo-router 6 (SDK 54) source and the "Customizing links" guide
 * (docs.expo.dev/router/advanced/native-intent/). `+native-intent` is not a
 * route: getRoutes ignores it by name.
 *
 * The one thing it does is refuse links to the verdict screen. The keypad is
 * the only legitimate way there, and it navigates in-app, which never passes
 * through this function. A verdict screen opened from a message is somebody
 * trying to show the guard an answer the guard did not ask for. lib/verdicts
 * already makes such a link land on "No verdict to show" -- this keeps it off
 * the screen altogether, so the attempt never looks like a verdict at all.
 *
 * Everything else passes through untouched.
 */

/**
 * Does this link name the verdict screen, in any spelling the router might
 * still resolve?
 *
 * `path` is whatever the OS handed over, and the docs are explicit that it is
 * not guaranteed to be a path or even a valid URL. So no URL parsing -- React
 * Native's URL is not one to bet a gate on -- just the part before any query
 * or fragment, percent-decoded (a few times, so `%2576` cannot smuggle a `v`
 * past a single decode), lower-cased, and searched. That catches
 * `estateguard://verdict`, `estateguard:///verdict`, `exp://host/--/verdict`,
 * `/(tabs)/../verdict` and `%76erdict` alike. The match is deliberately
 * broad: nothing legitimate ever links into this app with "verdict" in it.
 */
export function isVerdictLink(path: string): boolean {
  let route = path.split(/[?#]/, 1)[0] ?? '';
  for (let i = 0; i < 3; i++) {
    const decoded = decodeURIComponent(route);
    if (decoded === route) break;
    route = decoded;
  }
  return route.toLowerCase().includes('verdict');
}

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  // The docs warn that throwing here can crash the app, and decodeURIComponent
  // throws on a malformed escape. A link too broken to read is not one to
  // follow anywhere but home.
  try {
    return isVerdictLink(path) ? '/' : path;
  } catch {
    return '/';
  }
}
