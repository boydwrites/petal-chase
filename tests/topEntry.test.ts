import { describe, expect, it } from "vitest";

import {
  createNormalPetalConfig,
  getNormalPetalRenderIdentity,
} from "@/game/PetalField";

// Regression guard for the "petals spawn mid-screen" bug. A negative animation-delay
// starts a petal partway through its fall (mid-screen), which is un-dodgeable — the
// player gets no time to react. In the GAME (startFromTop=true) every normal petal must
// enter from the very TOP, i.e. a NON-NEGATIVE delay. Decorative fields keep the
// vertically-distributed (negative-delay) look.
describe("createNormalPetalConfig — game petals enter from the top", () => {
  const SAMPLES = 200;

  it("never gives a game-mode petal a negative (mid-fall) delay", () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      const petal = createNormalPetalConfig(index, SAMPLES, 1, /* startFromTop */ true);
      expect(petal.delay).toBeGreaterThanOrEqual(0);
    }
  });

  it("staggers the top entry within a single fall cycle (no long blank gaps)", () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      const petal = createNormalPetalConfig(index, SAMPLES, 1, true);
      expect(petal.delay).toBeLessThanOrEqual(petal.duration);
    }
  });

  it("leaves decorative petals vertically distributed (non-positive delay)", () => {
    for (let index = 0; index < SAMPLES; index += 1) {
      const petal = createNormalPetalConfig(index, SAMPLES);
      expect(petal.delay).toBeLessThanOrEqual(0);
    }
  });
});

// Regression guard for the "petals teleport mid-screen at high speed" bug. The real cause
// is NOT the initial delay above: a looping petal's animation-duration was being mutated on
// a live, running CSS animation when difficulty bumped its fall speed, which re-bases the
// animation's progress to fract(elapsed / newDuration) and snaps the petal mid-screen. The
// fix embeds the live fall speed in the React key so a speed change REMOUNTS the petal (a
// fresh animation that starts at the top) instead of restyling the live one — and drops the
// stagger delay to 0 on re-entry so there's no blank gap. See getNormalPetalRenderIdentity.
describe("getNormalPetalRenderIdentity — speed change remounts (no mid-screen re-base)", () => {
  // A run's fall-speed multiplier ratchets up through a handful of distinct values
  // (1 → ~3.75); each must produce a distinct key so React remounts on the change.
  const SPEED_SEQUENCE = [1, 1.5, 2.4, 3.75];

  it("gives a distinct key for each distinct fall speed (forces a remount)", () => {
    const keys = SPEED_SEQUENCE.map(
      (speed) => getNormalPetalRenderIdentity(0, 2, speed).key,
    );
    expect(new Set(keys).size).toBe(SPEED_SEQUENCE.length);
  });

  it("is stable: same index + same speed yields the same key", () => {
    const first = getNormalPetalRenderIdentity(3, 2, 2.4).key;
    const second = getNormalPetalRenderIdentity(3, 2, 2.4).key;
    expect(first).toBe(second);
  });

  it("keeps different petals' keys distinct at the same speed", () => {
    const a = getNormalPetalRenderIdentity(0, 2, 3.75).key;
    const b = getNormalPetalRenderIdentity(1, 2, 3.75).key;
    expect(a).not.toBe(b);
  });

  it("keeps the stagger delay on first appearance (speed === 1)", () => {
    const configDelay = 4.2;
    expect(getNormalPetalRenderIdentity(0, configDelay, 1).delay).toBe(configDelay);
  });

  it("drops the delay to 0 on re-entry after a speed bump (no blank gap)", () => {
    const configDelay = 4.2;
    for (const speed of SPEED_SEQUENCE.filter((value) => value !== 1)) {
      expect(getNormalPetalRenderIdentity(0, configDelay, speed).delay).toBe(0);
    }
  });
});
