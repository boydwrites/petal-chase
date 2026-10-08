export type PetalPointer = {
  x: number;
  y: number;
};

export type PetalBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PetalNudge = {
  x: number;
  y: number;
  rotate: number;
};

export type PetalTouchImpulse = {
  x: number;
  y: number;
};

export type PetalDifficulty = {
  obstacleCount: number;
  fallSpeed: number;
  spawnRate: number;
  maxGolden: number;
};

export type PetalKind = "normal" | "golden";

/**
 * Authoritative game state for Petal Chase.
 *
 * Scoring is *edge-triggered*: the player earns points each time their cursor freshly
 * enters a petal's hitbox (the petal bounces away on contact, so chasing it and
 * re-entering is the core loop). Golden petals are the only scoring targets and add
 * points on every touch; normal petals are obstacles that end the run. The last normal
 * id is retained only to provide a brief contact-grace window in dense clusters.
 */
export type PetalGameSnapshot = {
  /** Current run score. */
  score: number;
  /** Best score reached this session. */
  best: number;
  /** Most recently touched normal obstacle, used for contact grace, or null. */
  lastObstacleId: string | null;
  /** Kind of the most recent game touch (drives golden HUD styling). */
  lastKind: PetalKind | null;
  /** Consecutive golden touches inside the chain window. */
  chain: number;
  /** Timestamp of the last golden touch, for the chain window. */
  lastCatchAt: number | null;
  /** Timestamp of the last game touch, so the HUD can replay its tick/reset. */
  touchedAt: number;
};

export type PetalRepulsionOptions = {
  radius: number;
  maxShift: number;
  maxTilt: number;
};

export type PetalTouchOptions = {
  padding: number;
  hitScaleX: number;
  hitScaleY: number;
  hitShiftX: number;
  hitShiftY: number;
};

export type PetalTouchEntry = {
  /** Pointer position that entered or crossed the hitbox. */
  pointer: PetalPointer;
  /** Pixel distance from the hitbox center at the detected contact. */
  distance: number;
  /** Index of the pointer sample that completed this entry/crossing. */
  sampleNo: number;
  /** Position within the segment ending at sampleNo (0..1), for path ordering. */
  sampleT: number;
};

export type PetalTouchTrace = {
  /** Every outside -> inside/cross-through transition in sample order. */
  entries: PetalTouchEntry[];
  /** Whether the final sample remains inside the hitbox. */
  touching: boolean;
};

/** A petal whose hitbox the cursor freshly entered this frame. */
export type PetalEdge = {
  scoreId: string;
  kind: PetalKind;
  distance: number;
};

export type GoldenPetalBurstPetal = {
  burstSlot: number;
  delay: number;
  duration: number;
  startX: number;
  size: number;
  swayStartX: number;
  swayMidX: number;
  swayEndX: number;
  swayMidY: number;
  swayDuration: number;
};

// Normal repulsion only adds gentle liveliness as the cursor nears. Golden petals are
// intentionally windier because they are bonus targets and should take more chase effort.
export const NORMAL_PETAL_REPULSION: PetalRepulsionOptions = {
  radius: 150,
  maxShift: 22,
  maxTilt: 14,
};

export const GOLDEN_PETAL_REPULSION: PetalRepulsionOptions = {
  radius: 190,
  maxShift: 42,
  maxTilt: 24,
};

export const ZERO_PETAL_NUDGE: PetalNudge = {
  x: 0,
  y: 0,
  rotate: 0,
};

// Catch zone covers most of the visible petal body so chasing reliably lands touches.
export const PETAL_TOUCH_OPTIONS: PetalTouchOptions = {
  padding: 0,
  hitScaleX: 0.42,
  hitScaleY: 0.4,
  hitShiftX: 0,
  hitShiftY: -0.02,
};

export const GOLDEN_PETAL_TOUCH_OPTIONS: PetalTouchOptions = {
  padding: 0,
  hitScaleX: 0.46,
  hitScaleY: 0.44,
  hitShiftX: 0,
  hitShiftY: 0,
};

// Golden points ramp *quadratically* with the chain so deep golden chains spike the
// score dramatically — chasing golden petals in a row is where the big numbers come
// from. Chain 1..8 -> 3, 6, 11, 18, 27, 38, 51, 66 points per touch.
export const PETAL_GOLDEN_BASE_POINTS = 2;
export const PETAL_GOLDEN_CHAIN_BONUS_POINTS = 1;
// The golden chain is UNCAPPED: as long as a player keeps tagging distinct goldens inside the
// window, the chain (and its quadratic point bonus + the HUD ×N badge) keeps climbing. Difficulty
// has its own, separate ceiling (PETAL_DIFFICULTY_LEVEL_CAP) so the screen maxes out while the
// score multiplier can run away.
// Generous window so a second golden touch reliably chains.
export const GOLDEN_CHAIN_WINDOW_MS = 11000;
// While the streak petal has been touched within this window, brushing a *different*
// normal petal will not steal the run — kills the "reset for no reason" feeling during
// a fast chase. Only a deliberate touch of another petal after you've let go resets.
export const PETAL_ACTIVE_GRACE_MS = 500;

// Spawn cadence — golden petals drift in one at a time on a randomized interval so
// they feel sprinkled casually into the normal rain rather than arriving in clusters.
// Spawning is purely timer-driven (see PetalField); the spawn-rate multiplier below
// tightens this interval as the chain climbs so goldens flood in fast enough to keep a
// deep chain alive into the endgame.
export const GOLDEN_PETAL_FIRST_BURST_DELAY_MS = 2_500;
export const GOLDEN_PETAL_MIN_BURST_INTERVAL_MS = 2_000;
export const GOLDEN_PETAL_MAX_BURST_INTERVAL_MS = 5_500;
export const GOLDEN_PETAL_MAX_ACTIVE = 2;

// Difficulty climbs in two bands keyed on the golden chain:
//   1. Ease-in (chain 0 -> RAMP_CAP): a quadratic ramp toward "base chaos" — a packed ~70-petal
//      screen at 3.75× fall. This is the original curve; the first few touches stay calm and the
//      screen reaches base chaos after ~5 distinct goldens.
//   2. Overdrive (chain RAMP_CAP -> RAMP_CAP+OVERDRIVE_SPAN): a linear push *past* base chaos
//      toward the impossible endgame — up to 110 petals, 7× fall, 6× golden spawn. This is what
//      keeps the screen getting harder for a skilled player instead of plateauing at chain 5.
// The difficulty level itself is clamped at PETAL_DIFFICULTY_LEVEL_CAP; the golden chain (scoring)
// is uncapped and runs past it.
export const PETAL_DIFFICULTY_LEVEL_CAP = 15;
// The chain level at which the ease-in band reaches base chaos. Kept low so the screen feels
// intense after only ~5 distinct goldens; the overdrive band takes over from here.
export const PETAL_DIFFICULTY_RAMP_CAP = 5;
// How many chain levels the overdrive band spans (RAMP_CAP -> RAMP_CAP + OVERDRIVE_SPAN = 5 -> 15).
export const PETAL_DIFFICULTY_OVERDRIVE_SPAN = 10;
// Base chaos (reached at RAMP_CAP): base count 8 × 8.75 ≈ 70 petals at 3.75× fall / spawn.
export const PETAL_DIFFICULTY_NORMAL_RAMP_TARGET = 70;
export const PETAL_DIFFICULTY_NORMAL_MAX_MULTIPLIER = 8.75;
export const PETAL_DIFFICULTY_FALL_SPEED_MAX_MULTIPLIER = 3.75;
export const PETAL_DIFFICULTY_GOLDEN_SPAWN_MAX_MULTIPLIER = 3.75;
// Overdrive ceilings (reached at the level cap): the impossible endgame.
export const PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE = 110;
export const PETAL_DIFFICULTY_FALL_SPEED_HARD_MULTIPLIER = 7.0;
export const PETAL_DIFFICULTY_GOLDEN_SPAWN_HARD_MULTIPLIER = 6.0;

export const PETAL_TOUCH_BOUNCE_KICK = 9;
export const GOLDEN_PETAL_TOUCH_BOUNCE_KICK = 15;
export const GOLDEN_PETAL_TOUCH_CROSSWIND_MAX = 7;
export const GOLDEN_PETAL_TOUCH_VERTICAL_GUST_MAX = 4;

export function clampPetalDifficultyLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(PETAL_DIFFICULTY_LEVEL_CAP, Math.floor(level));
}

export function getEffectiveGoldenChain(
  snapshot: PetalGameSnapshot,
  now: number,
): number {
  if (
    snapshot.lastCatchAt === null ||
    !Number.isFinite(now) ||
    now - snapshot.lastCatchAt > GOLDEN_CHAIN_WINDOW_MS
  ) {
    return 0;
  }

  return clampPetalDifficultyLevel(snapshot.chain);
}

/**
 * Difficulty ratchets up with the golden chain and never decays on its own — it only drops
 * back to 0 when the run resets (a normal-petal touch, or the game going inactive). Persisting
 * the earned level is what lets a pure-dodging player hold a packed screen alive between golden
 * taps instead of watching the chaos collapse on an 11s timer.
 */
export function nextRunDifficultyLevel(
  currentLevel: number,
  snapshot: PetalGameSnapshot,
  now: number,
): number {
  const chain = getEffectiveGoldenChain(snapshot, now);
  return Math.max(clampPetalDifficultyLevel(currentLevel), chain);
}

export function calculatePetalDifficulty(
  level: number,
  baseNormalCount: number,
): PetalDifficulty {
  const chainLevel = clampPetalDifficultyLevel(level);
  const safeBaseCount =
    Number.isFinite(baseNormalCount) && baseNormalCount > 0
      ? Math.floor(baseNormalCount)
      : 1;

  // Band 1 — ease-in (chain 0 -> RAMP_CAP). Quadratic ease normalized to the RAMP cap: the first
  // distinct golden barely changes the screen and intensity accelerates toward *base chaos* by
  // ~5 goldens. Keeps an accidental/early golden from snapping the page calm -> chaos.
  const progress =
    PETAL_DIFFICULTY_RAMP_CAP > 0
      ? Math.min(1, chainLevel / PETAL_DIFFICULTY_RAMP_CAP)
      : 0;
  const ramp = progress * progress;

  // Band 2 — overdrive (chain RAMP_CAP -> RAMP_CAP + OVERDRIVE_SPAN). A linear push *past* base
  // chaos toward the impossible endgame, so a skilled player who keeps chaining never plateaus.
  const overdriveProgress =
    PETAL_DIFFICULTY_OVERDRIVE_SPAN > 0
      ? Math.min(
          1,
          Math.max(0, chainLevel - PETAL_DIFFICULTY_RAMP_CAP) /
            PETAL_DIFFICULTY_OVERDRIVE_SPAN,
        )
      : 0;

  // Base-chaos density target (reached at RAMP_CAP), then overdrive lifts it to the hard cap.
  const rampTargetCount = Math.min(
    PETAL_DIFFICULTY_NORMAL_RAMP_TARGET,
    Math.round(safeBaseCount * PETAL_DIFFICULTY_NORMAL_MAX_MULTIPLIER),
  );
  const obstacleCount = Math.min(
    PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE,
    Math.max(
      safeBaseCount,
      Math.round(
        safeBaseCount +
          (rampTargetCount - safeBaseCount) * ramp +
          (PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE - rampTargetCount) *
            overdriveProgress,
      ),
    ),
  );

  const fallSpeed =
    1 +
    (PETAL_DIFFICULTY_FALL_SPEED_MAX_MULTIPLIER - 1) * ramp +
    (PETAL_DIFFICULTY_FALL_SPEED_HARD_MULTIPLIER -
      PETAL_DIFFICULTY_FALL_SPEED_MAX_MULTIPLIER) *
      overdriveProgress;
  const spawnRate =
    1 +
    (PETAL_DIFFICULTY_GOLDEN_SPAWN_MAX_MULTIPLIER - 1) * ramp +
    (PETAL_DIFFICULTY_GOLDEN_SPAWN_HARD_MULTIPLIER -
      PETAL_DIFFICULTY_GOLDEN_SPAWN_MAX_MULTIPLIER) *
      overdriveProgress;

  return {
    obstacleCount,
    fallSpeed,
    spawnRate,
    maxGolden:
      chainLevel >= 12
        ? 22
        : chainLevel >= 9
          ? 18
          : chainLevel >= 7
            ? 16
            : chainLevel >= 5
              ? 14
              : chainLevel >= 4
                ? 11
                : chainLevel >= 3
                  ? 8
                  : chainLevel >= 2
                    ? 5
                    : GOLDEN_PETAL_MAX_ACTIVE,
  };
}

function buildProgressivePetalIndexOrder(totalCount: number): number[] {
  const safeTotal =
    Number.isFinite(totalCount) && totalCount > 0 ? Math.floor(totalCount) : 0;
  if (safeTotal === 0) return [];

  const order: number[] = [];
  const seen = new Set<number>();
  const ranges: Array<[number, number]> = [];
  const addIndex = (index: number) => {
    if (index < 0 || index >= safeTotal || seen.has(index)) return;
    seen.add(index);
    order.push(index);
  };

  addIndex(0);
  addIndex(safeTotal - 1);
  ranges.push([0, safeTotal - 1]);

  while (order.length < safeTotal && ranges.length > 0) {
    ranges.sort((left, right) => {
      const leftWidth = left[1] - left[0];
      const rightWidth = right[1] - right[0];
      return rightWidth - leftWidth || left[0] - right[0];
    });

    const [left, right] = ranges.shift() ?? [0, 0];
    if (right - left <= 1) continue;

    const middle = Math.floor((left + right) / 2);
    addIndex(middle);
    ranges.push([left, middle], [middle, right]);
  }

  return order;
}

export function selectEvenlyDistributedPetalIndexes(
  totalCount: number,
  activeCount: number,
): number[] {
  const safeTotal =
    Number.isFinite(totalCount) && totalCount > 0 ? Math.floor(totalCount) : 0;
  if (safeTotal === 0) return [];

  const safeActive =
    Number.isFinite(activeCount) && activeCount > 0
      ? Math.min(safeTotal, Math.floor(activeCount))
      : 0;
  if (safeActive === 0) return [];
  if (safeActive >= safeTotal) {
    return Array.from({ length: safeTotal }, (_, index) => index);
  }

  return buildProgressivePetalIndexOrder(safeTotal)
    .slice(0, safeActive)
    .sort((left, right) => left - right);
}

export function calculatePetalRepulsionNudge(
  pointer: PetalPointer | null,
  bounds: PetalBounds,
  options: PetalRepulsionOptions = NORMAL_PETAL_REPULSION,
): PetalNudge {
  if (
    !pointer ||
    options.radius <= 0 ||
    options.maxShift <= 0 ||
    options.maxTilt <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return ZERO_PETAL_NUDGE;
  }

  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  let dx = centerX - pointer.x;
  let dy = centerY - pointer.y;
  let distance = Math.hypot(dx, dy);

  if (distance >= options.radius) {
    return ZERO_PETAL_NUDGE;
  }

  if (distance === 0) {
    dx = 0;
    dy = -1;
    distance = 1;
  }

  const falloff = 1 - distance / options.radius;
  const strength = Math.min(1, Math.max(0, falloff * falloff));
  const offset = options.maxShift * strength;
  const x = (dx / distance) * offset;
  const y = (dy / distance) * offset;
  const rotate = (x / options.maxShift) * options.maxTilt;

  return { x, y, rotate };
}

export function hasPetalNudge(nudge: PetalNudge): boolean {
  return nudge.x !== 0 || nudge.y !== 0 || nudge.rotate !== 0;
}

/**
 * Returns the cursor's distance to the petal center when inside the elliptical hitbox,
 * or null when outside it.
 */
export function getPetalTouchDistance(
  pointer: PetalPointer | null,
  bounds: PetalBounds,
  options: PetalTouchOptions = PETAL_TOUCH_OPTIONS,
): number | null {
  if (!pointer || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const { centerX, centerY, radiusX, radiusY } = getPetalTouchGeometry(
    bounds,
    options,
  );
  const dx = pointer.x - centerX;
  const dy = pointer.y - centerY;
  const normalizedDistance = Math.hypot(dx / radiusX, dy / radiusY);

  if (normalizedDistance > 1) {
    return null;
  }

  return Math.hypot(dx, dy);
}

function getPetalTouchGeometry(
  bounds: PetalBounds,
  options: PetalTouchOptions,
) {
  return {
    centerX: bounds.left + bounds.width * (0.5 + options.hitShiftX),
    centerY: bounds.top + bounds.height * (0.5 + options.hitShiftY),
    radiusX: Math.max(1, bounds.width * options.hitScaleX + options.padding),
    radiusY: Math.max(1, bounds.height * options.hitScaleY + options.padding),
  };
}

/**
 * Return the closest point when an outside -> outside pointer segment crosses the
 * elliptical hitbox. Fast mouse passes can skip from one side of a small petal to
 * the other without the browser ever reporting an inside coordinate; treating the
 * segment itself as the path makes that real visual crossing count as a touch.
 */
function getPetalSegmentCrossing(
  from: PetalPointer,
  to: PetalPointer,
  bounds: PetalBounds,
  options: PetalTouchOptions,
): { pointer: PetalPointer; distance: number; sampleT: number } | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const { centerX, centerY, radiusX, radiusY } = getPetalTouchGeometry(
    bounds,
    options,
  );
  const fromX = (from.x - centerX) / radiusX;
  const fromY = (from.y - centerY) / radiusY;
  const deltaX = (to.x - from.x) / radiusX;
  const deltaY = (to.y - from.y) / radiusY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return null;

  const closestT = Math.min(
    1,
    Math.max(0, -(fromX * deltaX + fromY * deltaY) / lengthSquared),
  );
  const closestNormalizedX = fromX + deltaX * closestT;
  const closestNormalizedY = fromY + deltaY * closestT;
  if (Math.hypot(closestNormalizedX, closestNormalizedY) > 1) return null;

  const pointer = {
    x: from.x + (to.x - from.x) * closestT,
    y: from.y + (to.y - from.y) * closestT,
  };
  return {
    pointer,
    distance: Math.hypot(pointer.x - centerX, pointer.y - centerY),
    sampleT: closestT,
  };
}

/**
 * Detect every fresh hitbox entry represented by a high-frequency pointer trace.
 *
 * Unlike a single requestAnimationFrame sample, this preserves rapid leave/re-enter
 * motion that happens between frames. It also recognizes an outside -> outside line
 * segment that crosses the hitbox, making small targets forgiving at high cursor speed.
 * An empty trace means the pointer is absent and rearms the hitbox.
 */
export function tracePetalTouchEntries(
  samples: PetalPointer[],
  bounds: PetalBounds,
  options: PetalTouchOptions = PETAL_TOUCH_OPTIONS,
  wasTouching = false,
): PetalTouchTrace {
  const entries: PetalTouchEntry[] = [];
  let touching = wasTouching;
  let previousPointer: PetalPointer | null = null;
  let previousWasOutside = true;

  samples.forEach((pointer, sampleNo) => {
    const distance = getPetalTouchDistance(pointer, bounds, options);
    const sampleTouching = distance !== null;

    if (sampleTouching) {
      if (!touching) {
        entries.push({ pointer, distance, sampleNo, sampleT: 1 });
      }
      touching = true;
    } else {
      if (!touching && previousPointer && previousWasOutside) {
        const crossing = getPetalSegmentCrossing(
          previousPointer,
          pointer,
          bounds,
          options,
        );
        if (crossing) {
          entries.push({ ...crossing, sampleNo });
        }
      }
      touching = false;
    }

    previousPointer = pointer;
    previousWasOutside = !sampleTouching;
  });

  return {
    entries,
    touching: samples.length > 0 ? touching : false,
  };
}

export function getPetalBoundsCenter(bounds: PetalBounds): PetalPointer {
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
}

function clampUnitRandom(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function calculatePetalTouchImpulse({
  kind,
  center,
  pointer,
  sideRandom = 0.5,
  liftRandom = 0.5,
}: {
  kind: PetalKind;
  center: PetalPointer;
  pointer: PetalPointer;
  sideRandom?: number;
  liftRandom?: number;
}): PetalTouchImpulse {
  const dx = center.x - pointer.x;
  const dy = center.y - pointer.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;

  if (kind !== "golden") {
    return {
      x: unitX * PETAL_TOUCH_BOUNCE_KICK,
      y: unitY * PETAL_TOUCH_BOUNCE_KICK,
    };
  }

  const crosswind =
    (clampUnitRandom(sideRandom) * 2 - 1) *
    GOLDEN_PETAL_TOUCH_CROSSWIND_MAX;
  const verticalGust =
    (clampUnitRandom(liftRandom) * 2 - 1) *
    GOLDEN_PETAL_TOUCH_VERTICAL_GUST_MAX;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;

  return {
    x:
      unitX * GOLDEN_PETAL_TOUCH_BOUNCE_KICK +
      perpendicularX * crosswind,
    y:
      unitY * GOLDEN_PETAL_TOUCH_BOUNCE_KICK +
      perpendicularY * crosswind +
      verticalGust,
  };
}

export function getNormalPetalScoreId(poolIndex: number, lifeId: number): string {
  return `n${poolIndex}.${lifeId}`;
}

export function getGoldenPetalScoreId(
  spawnId: number,
  burstSlot: number,
): string {
  return `g${spawnId}.${burstSlot}`;
}

export function createPetalGameSnapshot(): PetalGameSnapshot {
  return {
    score: 0,
    best: 0,
    lastObstacleId: null,
    lastKind: null,
    chain: 0,
    lastCatchAt: null,
    touchedAt: 0,
  };
}

export function getGoldenPetalTouchPoints(chain: number): number {
  const chainLevel =
    Number.isFinite(chain) && chain > 0
      ? Math.floor(chain)
      : 1;

  // Quadratic ramp: each deeper link in the chain is worth meaningfully more, so a long
  // golden chase pays off in a hurry.
  return (
    PETAL_GOLDEN_BASE_POINTS +
    chainLevel * chainLevel * PETAL_GOLDEN_CHAIN_BONUS_POINTS
  );
}

/**
 * Apply a single edge-triggered touch to the game state.
 *
 * Golden petals are the *only* scoring petals: they score on *every* touch (rapid
 * re-tapping a golden to rack up points is core to the game). A normal petal is a pure
 * obstacle — touching one ends the run (score and golden chain reset to zero).
 *
 * `extendChain` separates *scoring* from *difficulty*: a brand-new distinct golden
 * passes `true` to extend the chain (which drives the difficulty + the points multiplier);
 * a re-touch of an already-collected golden passes `false` to keep scoring at the current
 * chain level without ramping. This is what stops one petal — tapped 10-15× by a fast
 * mouse — from slamming the game to max difficulty.
 *
 * The decision of *whether* a different normal petal is allowed to reset (grace window,
 * golden priority) is made by {@link selectScoredPetalEdge} before this is called.
 */
export function scorePetalTouch(
  snapshot: PetalGameSnapshot,
  scoreId: string,
  kind: PetalKind,
  now: number,
  options?: { extendChain?: boolean },
): PetalGameSnapshot {
  if (kind === "golden") {
    const advanceChain = options?.extendChain ?? true;
    const withinWindow =
      snapshot.lastCatchAt !== null &&
      now - snapshot.lastCatchAt <= GOLDEN_CHAIN_WINDOW_MS;
    const chain = advanceChain
      ? withinWindow
        ? snapshot.chain + 1
        : 1
      : withinWindow
        ? Math.max(1, snapshot.chain)
        : 1;
    const points = getGoldenPetalTouchPoints(chain);
    const score = snapshot.score + points;

    return {
      score,
      best: Math.max(snapshot.best, score),
      lastObstacleId: snapshot.lastObstacleId,
      lastKind: "golden",
      chain,
      lastCatchAt: now,
      touchedAt: now,
    };
  }

  // Normal petals don't score — touching one ends the run: the score drops to zero and
  // the golden chain breaks. (The caller also resets on-screen difficulty to calm.)
  return {
    score: 0,
    best: snapshot.best,
    lastObstacleId: scoreId,
    lastKind: "normal",
    chain: 0,
    lastCatchAt: null,
    touchedAt: now,
  };
}

/**
 * Pick which freshly-entered petal (if any) should score this frame.
 *
 * Priority: a golden petal (always exciting, never resets) > the active normal obstacle
 * > a different normal obstacle. A different normal only emits a reset event when the
 * active normal is NOT within its grace window. This prevents a dense cluster from
 * repeatedly registering obstacle touches during the same brief contact.
 */
export function selectScoredPetalEdge({
  edges,
  lastObstacleId,
  obstacleInGrace,
}: {
  edges: PetalEdge[];
  lastObstacleId: string | null;
  obstacleInGrace: boolean;
}): PetalEdge | null {
  const nearest = (kind: PetalKind, predicate: (edge: PetalEdge) => boolean) =>
    edges
      .filter((edge) => edge.kind === kind && predicate(edge))
      .sort((left, right) => left.distance - right.distance)[0] ?? null;

  const goldenEdge = nearest("golden", () => true);
  if (goldenEdge) return goldenEdge;

  const streakEdge =
    lastObstacleId !== null
      ? nearest("normal", (edge) => edge.scoreId === lastObstacleId)
      : null;
  if (streakEdge) return streakEdge;

  if (obstacleInGrace) return null;

  return nearest("normal", (edge) => edge.scoreId !== lastObstacleId);
}

export function getGoldenPetalBurstDelayMs(
  randomValue: number,
  isFirstBurst: boolean,
  spawnRateMultiplier = 1,
): number {
  const safeSpawnRateMultiplier =
    Number.isFinite(spawnRateMultiplier) && spawnRateMultiplier > 0
      ? spawnRateMultiplier
      : 1;

  if (isFirstBurst) {
    return Math.round(GOLDEN_PETAL_FIRST_BURST_DELAY_MS / safeSpawnRateMultiplier);
  }

  const clampedRandom = Math.min(1, Math.max(0, randomValue));
  const baseDelay =
    GOLDEN_PETAL_MIN_BURST_INTERVAL_MS +
      (GOLDEN_PETAL_MAX_BURST_INTERVAL_MS - GOLDEN_PETAL_MIN_BURST_INTERVAL_MS) *
        clampedRandom;

  return Math.round(baseDelay / safeSpawnRateMultiplier);
}

function seededUnit(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const GOLDEN_LANE_RATIO = 0.61803398875;

/**
 * A single golden petal drifting down from a lane chosen so consecutive goldens spread
 * evenly across the screen instead of stacking in the same column. The lane walks a
 * golden-ratio (low-discrepancy) sequence keyed on `sequence` (the spawn's burst id),
 * jittered slightly by the seed so it never looks mechanical.
 */
export function createGoldenPetal(
  seed: number,
  sequence = 0,
): GoldenPetalBurstPetal {
  const safeSequence =
    Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 0;
  const laneFraction =
    (safeSequence * GOLDEN_LANE_RATIO + seededUnit(seed, 30) * 0.18) % 1;
  const lane = 12 + laneFraction * 76;
  const direction = seededUnit(seed, 1) > 0.5 ? 1 : -1;
  const swayMagnitude = 28 + seededUnit(seed, 2) * 42;

  return {
    burstSlot: 0,
    delay: 0,
    duration: 13 + seededUnit(seed, 3) * 7,
    startX: Math.max(6, Math.min(94, lane)),
    // The pink petal art sits in a square frame with room to tumble, while the golden art
    // fills its frame. So `size` here is the golden petal's height (its width follows
    // GOLDEN_PETAL_ASPECT_RATIO), and 16–22 px keeps it about as big on screen as the others.
    size: 16 + seededUnit(seed, 5) * 6,
    swayStartX: -direction * swayMagnitude * 0.35,
    swayMidX: direction * swayMagnitude,
    swayEndX: -direction * swayMagnitude * 0.65,
    swayMidY: 10 + seededUnit(seed, 6) * 18,
    swayDuration: 3.6 + seededUnit(seed, 7) * 2.4,
  };
}
