declare const __COMIK_NATIVE_BUILD__: boolean;

/** True inside the packaged Android and desktop shells, which serve the app from a local origin. */
export const isNativeShell = typeof __COMIK_NATIVE_BUILD__ !== "undefined" && __COMIK_NATIVE_BUILD__;

/** Absolute link to an in-app route such as `/community?post=1`, shaped for the router the current build uses. */
export function appLink(route: string, origin = location.origin): string {
  return isNativeShell ? `${origin}/web/index.html#${route}` : `${origin}/web${route}`;
}
