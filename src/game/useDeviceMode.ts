import { useEffect, useState } from "react";

import {
  PLAYABLE_MEDIA_QUERY,
  REDUCED_MOTION_MEDIA_QUERY,
} from "@/game/PetalField";

/** What this device can support: the full game, falling petals only, or nothing (reduced motion). */
export type DeviceMode = "none" | "decorative" | "game";

const NARROW_QUERY = "(max-width: 640px)";

export type DeviceProfile = {
  /** "game" only where PetalField's own play gate would also pass. */
  mode: DeviceMode;
  /** true on ≤640px — callers thin the decorative petal count. */
  narrow: boolean;
};

/**
 * The single source of truth for "what kind of petals can this device run",
 * measured with the exact media queries PetalField gates its game loop on
 * so the game/decorative split lines up with where the game can actually run.
 * Tracked live, so a resize or a newly-connected mouse re-resolves.
 *
 * Returns null until the first client measurement (SSR + first paint), which
 * callers must treat as "render nothing yet".
 */
export function useDeviceMode(): DeviceProfile | null {
  const [profile, setProfile] = useState<DeviceProfile | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const playQuery = window.matchMedia(PLAYABLE_MEDIA_QUERY);
    const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
    const narrowQuery = window.matchMedia(NARROW_QUERY);

    const update = () => {
      const mode: DeviceMode = reducedMotionQuery.matches
        ? "none"
        : playQuery.matches
          ? "game"
          : "decorative";
      const narrow = narrowQuery.matches;
      // Three listeners fire on a single resize; keep the object identity stable
      // when nothing actually changed so mid-flight petals don't re-render thrice.
      setProfile((current) =>
        current &&
        current.mode === mode &&
        current.narrow === narrow
          ? current
          : { mode, narrow },
      );
    };

    update();
    playQuery.addEventListener("change", update);
    reducedMotionQuery.addEventListener("change", update);
    narrowQuery.addEventListener("change", update);

    return () => {
      playQuery.removeEventListener("change", update);
      reducedMotionQuery.removeEventListener("change", update);
      narrowQuery.removeEventListener("change", update);
    };
  }, []);

  return profile;
}
