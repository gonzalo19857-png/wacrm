"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Whether new inbound messages should play a sound. Device-scoped
 * (localStorage), same persistence model as the appearance panel's
 * theme/mode — no server round-trip, applies immediately. Defaults to
 * off: this is an opt-in the agent turns on, not a surprise sound
 * that starts playing the first time they open the inbox.
 */
const STORAGE_KEY = "wacrm:notifications:sound-enabled";

/** Synchronous read for call sites that can't use the hook (e.g. a
 *  realtime event handler deep in the inbox page) — always reflects
 *  the latest value, including a toggle flipped in another tab. */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useNotificationSound() {
  // Lazy initializer (not an effect + setState) — same pattern as
  // ThemeProvider's readInitialTheme, so the stored value is picked up
  // on the very first client render instead of flashing the default
  // for one paint.
  const [enabled, setEnabledState] = useState<boolean>(
    isNotificationSoundEnabled,
  );

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts;
      // the in-memory state still updates for the current tab.
    }
  }, []);

  // Sync from other tabs, same pattern as ThemeProvider's storage listener.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setEnabledState(e.newValue === "true");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { enabled, setEnabled };
}
