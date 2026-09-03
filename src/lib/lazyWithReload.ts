import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "safedrive:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 15_000;

/**
 * True when an error is the "stale chunk" failure a fresh deploy causes: an open
 * tab still holds the previous build's hashed chunk URLs, and the browser 404s
 * on a file the new deploy replaced.
 */
export const isChunkLoadError = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /dynamically imported module/i.test(message)
  );
};

/**
 * Do one full-page reload to pick up the new index.html + chunk names. A
 * sessionStorage timestamp stops it from looping if a module is genuinely
 * broken rather than just renamed by a deploy. Returns true if a reload was
 * triggered.
 */
export const reloadForStaleChunk = (): boolean => {
  let lastReload = 0;
  try {
    lastReload = Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    lastReload = 0;
  }
  if (Date.now() - lastReload <= RELOAD_COOLDOWN_MS) return false;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Private mode - reload anyway; the cooldown just won't persist.
  }
  window.location.reload();
  return true;
};

/**
 * `React.lazy` that recovers from the stale-chunk failure above: on that failure
 * it reloads once instead of surfacing "React App Crashed". Any other import
 * error is rethrown for the error boundary.
 */
export function lazyWithReload(factory: Parameters<typeof lazy>[0]) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      if (isChunkLoadError(error) && reloadForStaleChunk()) {
        // Keep Suspense showing the fallback until the reload takes over.
        return new Promise<{ default: ComponentType }>(() => {});
      }
      throw error;
    }
  });
}
