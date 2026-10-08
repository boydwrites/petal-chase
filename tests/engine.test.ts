import { describe, expect, it } from "vitest";

import {
  GOLDEN_CHAIN_WINDOW_MS,
  GOLDEN_PETAL_FIRST_BURST_DELAY_MS,
  GOLDEN_PETAL_MAX_BURST_INTERVAL_MS,
  GOLDEN_PETAL_MIN_BURST_INTERVAL_MS,
  GOLDEN_PETAL_TOUCH_BOUNCE_KICK,
  GOLDEN_PETAL_TOUCH_CROSSWIND_MAX,
  GOLDEN_PETAL_TOUCH_VERTICAL_GUST_MAX,
  PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE,
  PETAL_DIFFICULTY_NORMAL_RAMP_TARGET,
  PETAL_TOUCH_BOUNCE_KICK,
  calculatePetalDifficulty,
  calculatePetalRepulsionNudge,
  calculatePetalTouchImpulse,
  createGoldenPetal,
  createPetalGameSnapshot,
  getEffectiveGoldenChain,
  getGoldenPetalBurstDelayMs,
  getGoldenPetalScoreId,
  getGoldenPetalTouchPoints,
  getNormalPetalScoreId,
  getPetalTouchDistance,
  hasPetalNudge,
  nextRunDifficultyLevel,
  scorePetalTouch,
  selectEvenlyDistributedPetalIndexes,
  selectScoredPetalEdge,
  tracePetalTouchEntries,
  type PetalBounds,
  type PetalEdge,
} from "@/game/engine";

const bounds: PetalBounds = {
  left: 100,
  top: 100,
  width: 40,
  height: 40,
};

describe("calculatePetalRepulsionNudge", () => {
  it("does not move petals outside the repulsion radius", () => {
    const nudge = calculatePetalRepulsionNudge(
      { x: 400, y: 400 },
      bounds,
      { radius: 140, maxShift: 32, maxTilt: 14 },
    );

    expect(nudge).toEqual({ x: 0, y: 0, rotate: 0 });
  });

  it("nudges the petal away from the cursor", () => {
    const nudge = calculatePetalRepulsionNudge(
      { x: 80, y: 120 },
      bounds,
      { radius: 140, maxShift: 32, maxTilt: 14 },
    );

    expect(nudge.x).toBeGreaterThan(0);
    expect(Math.abs(nudge.y)).toBeLessThan(0.0001);
    expect(nudge.rotate).toBeGreaterThan(0);
  });

  it("clamps the strongest nudge to the configured max offset", () => {
    const nudge = calculatePetalRepulsionNudge(
      { x: 120, y: 120 },
      bounds,
      { radius: 140, maxShift: 32, maxTilt: 14 },
    );

    expect(Math.hypot(nudge.x, nudge.y)).toBeLessThanOrEqual(32);
    expect(Math.abs(nudge.rotate)).toBeLessThanOrEqual(14);
  });

  it("identifies whether a nudge is active", () => {
    expect(hasPetalNudge({ x: 0, y: 0, rotate: 0 })).toBe(false);
    expect(hasPetalNudge({ x: 0.01, y: 0, rotate: 0 })).toBe(true);
  });
});

describe("getPetalTouchDistance", () => {
  it("detects touches inside the petal hitbox", () => {
    expect(getPetalTouchDistance({ x: 120, y: 120 }, bounds)).toBeCloseTo(0.8);
  });

  it("ignores misses outside the hitbox", () => {
    expect(getPetalTouchDistance({ x: 100, y: 120 }, bounds)).toBeNull();
    expect(getPetalTouchDistance({ x: 70, y: 120 }, bounds)).toBeNull();
  });

  it("returns null when the pointer is missing", () => {
    expect(getPetalTouchDistance(null, bounds)).toBeNull();
  });
});

describe("tracePetalTouchEntries", () => {
  const touchOptions = {
    padding: 0,
    hitScaleX: 0.5,
    hitScaleY: 0.5,
    hitShiftX: 0,
    hitShiftY: 0,
  };

  it("preserves multiple rapid leave/re-enter touches inside one frame", () => {
    const trace = tracePetalTouchEntries(
      [
        { x: 80, y: 120 },
        { x: 120, y: 120 },
        { x: 160, y: 120 },
        { x: 120, y: 120 },
      ],
      bounds,
      touchOptions,
    );

    expect(trace.entries).toHaveLength(2);
    expect(trace.entries.map((entry) => entry.sampleNo)).toEqual([1, 3]);
    expect(trace.touching).toBe(true);
  });

  it("counts a fast outside-to-outside segment that crosses the hitbox", () => {
    const trace = tracePetalTouchEntries(
      [
        { x: 70, y: 120 },
        { x: 170, y: 120 },
      ],
      bounds,
      touchOptions,
    );

    expect(trace.entries).toHaveLength(1);
    expect(trace.entries[0]?.sampleNo).toBe(1);
    expect(trace.entries[0]?.pointer).toEqual({ x: 120, y: 120 });
    expect(trace.touching).toBe(false);
  });

  it("does not duplicate a touch while the pointer remains inside", () => {
    const trace = tracePetalTouchEntries(
      [
        { x: 120, y: 120 },
        { x: 122, y: 121 },
      ],
      bounds,
      touchOptions,
      true,
    );

    expect(trace.entries).toHaveLength(0);
    expect(trace.touching).toBe(true);
  });

  it("rearms when the pointer trace is absent", () => {
    expect(tracePetalTouchEntries([], bounds, touchOptions, true)).toEqual({
      entries: [],
      touching: false,
    });
  });
});

describe("petal difficulty ramp", () => {
  it("keeps base difficulty unchanged at chain level zero", () => {
    expect(calculatePetalDifficulty(0, 8)).toEqual({
      obstacleCount: 8,
      fallSpeed: 1,
      spawnRate: 1,
      maxGolden: 2,
    });
  });

  it("eases in gently — the first distinct golden barely changes the screen", () => {
    // Quadratic ease-in normalized to the RAMP cap (5): ramp = (1/5)^2 = 0.04.
    const level1 = calculatePetalDifficulty(1, 8);
    expect(level1.fallSpeed).toBeCloseTo(1 + 2.75 * 0.04);
    expect(level1.fallSpeed).toBeLessThan(1.15);
    expect(level1.obstacleCount).toBeLessThanOrEqual(11);
  });

  it("ramps well toward chaos by the fourth distinct golden", () => {
    const difficulty = calculatePetalDifficulty(4, 8);

    // ramp = (4/5)^2 = 0.64.
    expect(difficulty.obstacleCount).toBe(48);
    expect(difficulty.fallSpeed).toBeCloseTo(1 + 2.75 * 0.64);
    expect(difficulty.spawnRate).toBeCloseTo(1 + 2.75 * 0.64);
    expect(difficulty.maxGolden).toBe(11);
  });

  it("reaches base chaos at the ramp cap (5 distinct goldens)", () => {
    const difficulty = calculatePetalDifficulty(5, 8);

    expect(difficulty.obstacleCount).toBe(PETAL_DIFFICULTY_NORMAL_RAMP_TARGET);
    expect(difficulty.fallSpeed).toBeCloseTo(3.75);
    expect(difficulty.maxGolden).toBe(14);
  });

  it("keeps escalating in the overdrive band past base chaos (chain 10)", () => {
    // Overdrive progress = (10 - 5) / 10 = 0.5: density, fall speed, and golden cap all climb
    // beyond the chain-5 plateau toward the impossible endgame.
    const difficulty = calculatePetalDifficulty(10, 8);

    // 8 + (70-8)*1 + (110-70)*0.5 = 90.
    expect(difficulty.obstacleCount).toBe(90);
    expect(difficulty.fallSpeed).toBeCloseTo(3.75 + (7 - 3.75) * 0.5);
    expect(difficulty.spawnRate).toBeCloseTo(3.75 + (6 - 3.75) * 0.5);
    expect(difficulty.maxGolden).toBe(18);
  });

  it("caps density, fall speed, and active golden petals at the level cap (impossible)", () => {
    // The difficulty level clamps at 15 (PETAL_DIFFICULTY_LEVEL_CAP); the golden chain itself
    // keeps climbing for scoring but the screen tops out here.
    const difficulty = calculatePetalDifficulty(99, 8);

    expect(difficulty.obstacleCount).toBe(PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE);
    expect(difficulty.obstacleCount).toBe(110);
    expect(difficulty.fallSpeed).toBeCloseTo(7);
    expect(difficulty.spawnRate).toBeCloseTo(6);
    expect(difficulty.maxGolden).toBe(22);
  });

  it("resets effective difficulty after the golden chain window expires", () => {
    const snapshot = scorePetalTouch(
      createPetalGameSnapshot(),
      "g1.0",
      "golden",
      100,
    );

    expect(getEffectiveGoldenChain(snapshot, 100 + GOLDEN_CHAIN_WINDOW_MS)).toBe(1);
    expect(getEffectiveGoldenChain(snapshot, 100 + GOLDEN_CHAIN_WINDOW_MS + 1)).toBe(0);
  });

  it("ratchets run difficulty up as the golden chain deepens", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    expect(nextRunDifficultyLevel(0, snapshot, 100)).toBe(1);

    snapshot = scorePetalTouch(snapshot, "g2.0", "golden", 200); // chain 2
    expect(nextRunDifficultyLevel(1, snapshot, 200)).toBe(2);

    snapshot = scorePetalTouch(snapshot, "g3.0", "golden", 300); // chain 3
    expect(nextRunDifficultyLevel(2, snapshot, 300)).toBe(3);
  });

  it("holds earned difficulty when the golden chain window lapses (no auto-decay)", () => {
    const snapshot = scorePetalTouch(
      createPetalGameSnapshot(),
      "g1.0",
      "golden",
      100,
    );

    // Long after the chain window expired and no golden is live, the effective chain is 0 —
    // but the run keeps the difficulty it already earned. Only a hard reset clears it.
    const lapsed = 100 + GOLDEN_CHAIN_WINDOW_MS + 1;
    expect(getEffectiveGoldenChain(snapshot, lapsed)).toBe(0);
    expect(nextRunDifficultyLevel(4, snapshot, lapsed)).toBe(4);
  });

  it("never lowers difficulty below the level already reached", () => {
    const snapshot = createPetalGameSnapshot();
    expect(nextRunDifficultyLevel(5, snapshot, 1000)).toBe(5);
  });

  it("tracks difficulty with the golden chain past the old cap of 8 (up to the level cap)", () => {
    let snapshot = createPetalGameSnapshot();
    // A deep, sustained chain keeps ratcheting difficulty into the overdrive band.
    for (let i = 1; i <= 12; i += 1) {
      snapshot = scorePetalTouch(snapshot, `g${i}.0`, "golden", i * 100);
    }
    expect(snapshot.chain).toBe(12);
    // Effective chain (and thus difficulty) follows the chain — no longer frozen at 8.
    expect(nextRunDifficultyLevel(0, snapshot, 12 * 100)).toBe(12);

    // ...but the difficulty level itself clamps at the cap even as the chain runs away.
    let deep = createPetalGameSnapshot();
    for (let i = 1; i <= 30; i += 1) {
      deep = scorePetalTouch(deep, `g${i}.0`, "golden", i * 100);
    }
    expect(deep.chain).toBe(30);
    expect(nextRunDifficultyLevel(0, deep, 30 * 100)).toBe(15);
  });

  it("selects active normal petals across the full pool as density increases", () => {
    const baseIndexes = selectEvenlyDistributedPetalIndexes(42, 8);
    expect(baseIndexes).toHaveLength(8);
    expect(baseIndexes[0]).toBe(0);
    expect(baseIndexes[baseIndexes.length - 1]).toBe(41);

    const denserIndexes = selectEvenlyDistributedPetalIndexes(42, 26);
    expect(denserIndexes).toHaveLength(26);
    expect(denserIndexes[0]).toBe(0);
    expect(denserIndexes[denserIndexes.length - 1]).toBe(41);
    expect(new Set(denserIndexes).size).toBe(denserIndexes.length);
    baseIndexes.forEach((index) => {
      expect(denserIndexes).toContain(index);
    });
    expect(selectEvenlyDistributedPetalIndexes(42, 42)).toHaveLength(42);
  });
});

describe("calculatePetalTouchImpulse", () => {
  it("keeps normal petals on the existing gentle bounce", () => {
    const impulse = calculatePetalTouchImpulse({
      kind: "normal",
      center: { x: 130, y: 120 },
      pointer: { x: 120, y: 120 },
      sideRandom: 1,
      liftRandom: 0,
    });

    expect(impulse.x).toBeCloseTo(PETAL_TOUCH_BOUNCE_KICK);
    expect(impulse.y).toBeCloseTo(0);
  });

  it("adds bounded gusts to golden petal impulses", () => {
    const lowGust = calculatePetalTouchImpulse({
      kind: "golden",
      center: { x: 130, y: 120 },
      pointer: { x: 120, y: 120 },
      sideRandom: 0,
      liftRandom: 0,
    });
    const highGust = calculatePetalTouchImpulse({
      kind: "golden",
      center: { x: 130, y: 120 },
      pointer: { x: 120, y: 120 },
      sideRandom: 1,
      liftRandom: 1,
    });
    const maxGust =
      GOLDEN_PETAL_TOUCH_CROSSWIND_MAX +
      GOLDEN_PETAL_TOUCH_VERTICAL_GUST_MAX;

    expect(lowGust.x).toBeCloseTo(GOLDEN_PETAL_TOUCH_BOUNCE_KICK);
    expect(highGust.x).toBeCloseTo(GOLDEN_PETAL_TOUCH_BOUNCE_KICK);
    expect(lowGust.y).toBeCloseTo(-maxGust);
    expect(highGust.y).toBeCloseTo(maxGust);
    expect(Math.abs(lowGust.y)).toBeLessThanOrEqual(maxGust);
    expect(Math.abs(highGust.y)).toBeLessThanOrEqual(maxGust);
  });

  it("keeps golden petal impulses stronger and pointed away from the cursor", () => {
    const center = { x: 130, y: 130 };
    const pointer = { x: 120, y: 120 };
    const length = Math.hypot(center.x - pointer.x, center.y - pointer.y);
    const awayX = (center.x - pointer.x) / length;
    const awayY = (center.y - pointer.y) / length;

    for (const randomValue of [0, 0.5, 1]) {
      const impulse = calculatePetalTouchImpulse({
        kind: "golden",
        center,
        pointer,
        sideRandom: randomValue,
        liftRandom: randomValue,
      });
      const awayComponent = impulse.x * awayX + impulse.y * awayY;

      expect(Math.hypot(impulse.x, impulse.y)).toBeGreaterThan(
        PETAL_TOUCH_BOUNCE_KICK,
      );
      expect(awayComponent).toBeGreaterThan(PETAL_TOUCH_BOUNCE_KICK);
    }
  });
});

describe("getGoldenPetalTouchPoints", () => {
  it("ramps golden points quadratically so deep chains pay off fast", () => {
    // base 2 + chain^2: 3, 6, 11, 18, 27, 38, 51, 66 across chain levels 1..8.
    expect(getGoldenPetalTouchPoints(1)).toBe(3);
    expect(getGoldenPetalTouchPoints(2)).toBe(6);
    expect(getGoldenPetalTouchPoints(3)).toBe(11);
    expect(getGoldenPetalTouchPoints(4)).toBe(18);
    expect(getGoldenPetalTouchPoints(8)).toBe(66);
  });

  it("keeps ramping past the old chain cap (no ceiling)", () => {
    // base 2 + chain^2 stays quadratic for arbitrarily deep chains.
    expect(getGoldenPetalTouchPoints(12)).toBe(146);
    expect(getGoldenPetalTouchPoints(20)).toBe(402);
  });
});

describe("petal score ids", () => {
  it("creates unique score ids for every generated normal petal", () => {
    const ids = Array.from({ length: 8 }, (_, index) =>
      getNormalPetalScoreId(index, 0),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(getNormalPetalScoreId(2, 1)).not.toBe(getNormalPetalScoreId(2, 0));
  });

  it("creates unique score ids across golden petal spawns", () => {
    const ids = [1, 2, 3].map((spawnId) => getGoldenPetalScoreId(spawnId, 0));

    expect(new Set(ids).size).toBe(ids.length);
    expect(getGoldenPetalScoreId(3, 0)).toBe("g3.0");
  });
});

describe("scorePetalTouch (edge-triggered scoring)", () => {
  it("scores nothing for a normal petal — they're obstacles, not points", () => {
    const snapshot = scorePetalTouch(createPetalGameSnapshot(), "n2.0", "normal", 100);

    expect(snapshot.score).toBe(0);
    expect(snapshot.best).toBe(0);
    expect(snapshot.lastObstacleId).toBe("n2.0");
    expect(snapshot.lastKind).toBe("normal");
    expect(snapshot.touchedAt).toBe(100);
  });

  it("resets the run to zero when a normal petal is touched", () => {
    // Build up a score on goldens, then brush a normal petal: the run ends at zero.
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    snapshot = scorePetalTouch(snapshot, "g2.0", "golden", 200);
    const best = snapshot.best;
    expect(best).toBeGreaterThan(0);

    snapshot = scorePetalTouch(snapshot, "n5.0", "normal", 300);

    expect(snapshot.score).toBe(0);
    expect(snapshot.chain).toBe(0);
    expect(snapshot.lastObstacleId).toBe("n5.0");
    expect(snapshot.best).toBe(best);
  });

  it("starts a fresh chain on the first golden after a normal touch", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "n2.0", "normal", 100);
    snapshot = scorePetalTouch(snapshot, "g1.0", "golden", 200);

    expect(snapshot.score).toBe(getGoldenPetalTouchPoints(1));
    expect(snapshot.lastKind).toBe("golden");
    expect(snapshot.chain).toBe(1);
  });

  it("keeps scoring a re-touched golden without advancing the chain", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    expect(snapshot.chain).toBe(1);

    // Re-touching the SAME golden (extendChain: false) keeps awarding points at the
    // current chain level but never ramps difficulty — fast players farm one petal safely.
    snapshot = scorePetalTouch(snapshot, "g1.0", "golden", 1000, {
      extendChain: false,
    });
    snapshot = scorePetalTouch(snapshot, "g1.0", "golden", 1100, {
      extendChain: false,
    });

    expect(snapshot.chain).toBe(1);
    expect(snapshot.score).toBe(getGoldenPetalTouchPoints(1) * 3);
  });

  it("re-touch points track the current chain level", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    snapshot = scorePetalTouch(snapshot, "g2.0", "golden", 200); // chain 2
    const before = snapshot.score;

    // A re-touch at chain 2 scores getGoldenPetalTouchPoints(2), no advance.
    snapshot = scorePetalTouch(snapshot, "g1.0", "golden", 300, {
      extendChain: false,
    });

    expect(snapshot.chain).toBe(2);
    expect(snapshot.score - before).toBe(getGoldenPetalTouchPoints(2));
  });

  it("escalates the chain as distinct golden petals are collected", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    snapshot = scorePetalTouch(snapshot, "g2.0", "golden", 1000);
    snapshot = scorePetalTouch(snapshot, "g3.0", "golden", 2000);

    expect(snapshot.chain).toBe(3);
    expect(snapshot.score).toBe(
      getGoldenPetalTouchPoints(1) +
        getGoldenPetalTouchPoints(2) +
        getGoldenPetalTouchPoints(3),
    );
  });

  it("resets the golden chain after the chain window expires", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    snapshot = scorePetalTouch(
      snapshot,
      "g2.0",
      "golden",
      100 + GOLDEN_CHAIN_WINDOW_MS + 1,
    );

    expect(snapshot.chain).toBe(1);
  });

  it("keeps the golden chain climbing without a cap", () => {
    let snapshot = createPetalGameSnapshot();
    // Each distinct golden inside the window advances the chain. The chain is uncapped, so it
    // keeps counting as long as the player sustains the streak.
    for (let i = 0; i < 12; i += 1) {
      snapshot = scorePetalTouch(snapshot, `g${i}.0`, "golden", i * 100);
    }

    expect(snapshot.chain).toBe(12);
    // Quadratic bonus keeps paying off well past the old cap of 8.
    expect(snapshot.score).toBe(
      Array.from({ length: 12 }, (_, i) => getGoldenPetalTouchPoints(i + 1)).reduce(
        (sum, points) => sum + points,
        0,
      ),
    );
  });

  it("breaks the golden chain when a normal petal is touched", () => {
    let snapshot = scorePetalTouch(createPetalGameSnapshot(), "g1.0", "golden", 100);
    snapshot = scorePetalTouch(snapshot, "n2.0", "normal", 200);

    expect(snapshot.chain).toBe(0);
    expect(snapshot.lastCatchAt).toBeNull();
    expect(snapshot.score).toBe(0);
    expect(snapshot.best).toBe(getGoldenPetalTouchPoints(1));
  });
});

function edge(overrides: Partial<PetalEdge> = {}): PetalEdge {
  return { scoreId: "n2.0", kind: "normal", distance: 5, ...overrides };
}

describe("selectScoredPetalEdge", () => {
  it("returns null when nothing was entered", () => {
    expect(
      selectScoredPetalEdge({ edges: [], lastObstacleId: null, obstacleInGrace: false }),
    ).toBeNull();
  });

  it("starts a streak on the nearest normal petal when none is active", () => {
    const scored = selectScoredPetalEdge({
      edges: [
        edge({ scoreId: "n2.0", distance: 8 }),
        edge({ scoreId: "n7.0", distance: 3 }),
      ],
      lastObstacleId: null,
      obstacleInGrace: false,
    });

    expect(scored?.scoreId).toBe("n7.0");
  });

  it("prefers the active streak petal over a different normal petal", () => {
    const scored = selectScoredPetalEdge({
      edges: [
        edge({ scoreId: "n2.0", distance: 9 }),
        edge({ scoreId: "n7.0", distance: 1 }),
      ],
      lastObstacleId: "n2.0",
      obstacleInGrace: false,
    });

    expect(scored?.scoreId).toBe("n2.0");
  });

  it("prefers a golden petal over everything", () => {
    const scored = selectScoredPetalEdge({
      edges: [
        edge({ scoreId: "n2.0", distance: 1 }),
        edge({ scoreId: "g1.0", kind: "golden", distance: 9 }),
      ],
      lastObstacleId: "n2.0",
      obstacleInGrace: true,
    });

    expect(scored?.scoreId).toBe("g1.0");
  });

  it("does NOT switch to a different normal petal while the streak is within grace", () => {
    const scored = selectScoredPetalEdge({
      edges: [edge({ scoreId: "n7.0", distance: 2 })],
      lastObstacleId: "n2.0",
      obstacleInGrace: true,
    });

    expect(scored).toBeNull();
  });

  it("switches to a different normal petal once the grace has lapsed", () => {
    const scored = selectScoredPetalEdge({
      edges: [edge({ scoreId: "n7.0", distance: 2 })],
      lastObstacleId: "n2.0",
      obstacleInGrace: false,
    });

    expect(scored?.scoreId).toBe("n7.0");
  });
});

describe("golden petal cadence", () => {
  it("uses a fixed first-spawn delay", () => {
    expect(GOLDEN_PETAL_FIRST_BURST_DELAY_MS).toBe(2_500);
    expect(getGoldenPetalBurstDelayMs(0.5, true)).toBe(
      GOLDEN_PETAL_FIRST_BURST_DELAY_MS,
    );
  });

  it("keeps later spawns inside the randomized interval", () => {
    expect(GOLDEN_PETAL_MIN_BURST_INTERVAL_MS).toBe(2_000);
    expect(GOLDEN_PETAL_MAX_BURST_INTERVAL_MS).toBe(5_500);
    expect(getGoldenPetalBurstDelayMs(0, false)).toBe(
      GOLDEN_PETAL_MIN_BURST_INTERVAL_MS,
    );
    expect(getGoldenPetalBurstDelayMs(1, false)).toBe(
      GOLDEN_PETAL_MAX_BURST_INTERVAL_MS,
    );
  });

  it("scales golden spawn delays by the active difficulty rate", () => {
    expect(getGoldenPetalBurstDelayMs(0.5, true, 2)).toBe(
      Math.round(GOLDEN_PETAL_FIRST_BURST_DELAY_MS / 2),
    );
    expect(getGoldenPetalBurstDelayMs(0, false, 2)).toBe(
      Math.round(GOLDEN_PETAL_MIN_BURST_INTERVAL_MS / 2),
    );
    expect(getGoldenPetalBurstDelayMs(1, false, 2)).toBe(
      Math.round(GOLDEN_PETAL_MAX_BURST_INTERVAL_MS / 2),
    );
  });

  it("creates a single golden petal with natural sizing and drift", () => {
    const petal = createGoldenPetal(42);

    expect(petal.burstSlot).toBe(0);
    expect(petal.delay).toBe(0);
    expect(petal.startX).toBeGreaterThanOrEqual(6);
    expect(petal.startX).toBeLessThanOrEqual(94);
    expect(petal.size).toBeGreaterThanOrEqual(18);
    expect(petal.size).toBeLessThanOrEqual(24);
    expect(Math.abs(petal.swayMidX)).toBeGreaterThanOrEqual(28);
    expect(Math.abs(petal.swayMidX)).toBeLessThanOrEqual(70);
    expect(petal.swayDuration).toBeGreaterThanOrEqual(3.6);
    expect(petal.swayDuration).toBeLessThanOrEqual(6);
  });

  it("spreads consecutive golden spawns across the screen via the burst sequence", () => {
    // Consecutive bursts (sequence = spawnId) walk a golden-ratio lane sequence so they
    // land in different columns instead of stacking — the fix for the "cluster" feel.
    const lanes = [1, 2, 3, 4, 5, 6].map(
      (spawnId) => createGoldenPetal(1000 + spawnId, spawnId).startX,
    );
    const uniqueLanes = new Set(lanes.map((lane) => Math.round(lane)));

    expect(uniqueLanes.size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeGreaterThan(30);
  });
});
