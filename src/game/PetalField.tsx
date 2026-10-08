import goldenPetalUrl from "@/assets/petal-golden.svg";
import petalA from "@/assets/petal-a.svg";
import petalB from "@/assets/petal-b.svg";
import petalC from "@/assets/petal-c.svg";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  NORMAL_PETAL_REPULSION,
  GOLDEN_PETAL_REPULSION,
  GOLDEN_PETAL_TOUCH_OPTIONS,
  PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE,
  PETAL_ACTIVE_GRACE_MS,
  PETAL_TOUCH_OPTIONS,
  calculatePetalDifficulty,
  calculatePetalRepulsionNudge,
  calculatePetalTouchImpulse,
  clampPetalDifficultyLevel,
  createGoldenPetal,
  createPetalGameSnapshot,
  getGoldenPetalBurstDelayMs,
  getGoldenPetalScoreId,
  getNormalPetalScoreId,
  getPetalBoundsCenter,
  getPetalTouchDistance,
  nextRunDifficultyLevel,
  scorePetalTouch,
  selectEvenlyDistributedPetalIndexes,
  selectScoredPetalEdge,
  tracePetalTouchEntries,
  type PetalBounds,
  type PetalEdge,
  type PetalGameSnapshot,
  type PetalKind,
  type PetalNudge,
  type PetalPointer,
  type PetalRepulsionOptions,
  ZERO_PETAL_NUDGE,
} from "@/game/engine";

export type PetalConfig = {
  key: string;
  kind: PetalKind;
  delay: number;
  duration: number;
  fallSpeed: number;
  startX: number;
  size: number;
  swayStartX: number;
  swayMidX: number;
  swayEndX: number;
  swayMidY: number;
  swayDuration: number;
  loop: boolean;
  normalSlot?: number;
  spawnId?: number;
  burstSlot?: number;
};

type RenderedPetal = PetalConfig & {
  poolIndex: number;
};

type PetalFieldMode = "play";

export type ScoreEvent = {
  /** The authoritative game state after this touch. */
  snapshot: PetalGameSnapshot;
  /** Score id of the petal that was touched. */
  scoreId: string;
  kind: PetalKind;
};

/** A petal that entered the cursor this frame, with the data needed to score + bounce it. */
type FramePetalEdge = PetalEdge & {
  renderKey: string;
  center: PetalPointer;
  pointer: PetalPointer;
  sampleNo: number;
  sampleT: number;
};

export const PLAYABLE_MEDIA_QUERY =
  "(min-width: 821px) and (hover: hover) and (pointer: fine)";
export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";
const PETAL_NUDGE_EASE = 0.22;
const PETAL_NUDGE_SETTLE_THRESHOLD = 0.04;
// The special (chain-multiplier) petal is golden — landscape, frame width/height of the
// tight-cropped asset (src/assets/petal-golden.svg).
const GOLDEN_PETAL_ASPECT_RATIO = 152 / 100;
/** Three blossom shapes, picked by a petal's start position so its look stays put for its whole fall. */
const NORMAL_PETALS = [petalA, petalB, petalC];
const PETAL_SCORE_MIN_OPACITY = 0.18;
const PETAL_SCORE_VIEWPORT_PADDING = 24;
// Pointer events can arrive much faster than requestAnimationFrame. Retain enough of
// the trace to preserve rapid golden crossings during a busy frame while keeping a
// hard bound if the main thread is paused (a normal 16 ms frame contains only a small
// fraction of this many samples).
const GOLDEN_POINTER_SAMPLE_LIMIT = 512;
// On a scoring touch the petal is given a velocity kick away from the cursor and then
// settles on a damped spring — so it flutters off and drifts back like a petal you blew
// on, rather than teleporting. The flutter still carries it out of the hitbox so the
// next entry registers as a fresh point.
export const PETAL_BOUNCE_SPRING = 0.05;
export const PETAL_BOUNCE_DAMPING = 0.12;
export const PETAL_BOUNCE_SPIN = 0.12;

type PetalVector = { x: number; y: number };

const ZERO_VECTOR: PetalVector = { x: 0, y: 0 };

/**
 * Per-petal motion state: eased cursor repulsion + damped-spring bounce + the last
 * nudge actually written to the DOM (null = nothing written for this key yet).
 *
 * Keyed by the petal's render KEY, not its poolIndex: golden pool indexes shift
 * when an earlier golden despawns (poolIndex = pool + array position), so
 * index-keyed state would hand one golden another's in-flight motion and make it
 * visibly jump. Keys are stable for a petal's DOM lifetime and change exactly when
 * a fresh animation starts (remount), which is when motion should reset anyway.
 */
type PetalMotionState = {
  nudge: PetalNudge;
  springOffset: PetalVector;
  springVelocity: PetalVector;
  applied: PetalNudge | null;
};

function getPetalMotionState(
  map: Map<string, PetalMotionState>,
  key: string,
): PetalMotionState {
  let state = map.get(key);
  if (!state) {
    state = {
      nudge: ZERO_PETAL_NUDGE,
      springOffset: ZERO_VECTOR,
      springVelocity: ZERO_VECTOR,
      applied: null,
    };
    map.set(key, state);
  }
  return state;
}

/**
 * Whether a nudge write may be skipped: most of the field sits far from the cursor,
 * fully settled, and re-writing identical zeros every frame invalidates style for
 * ~130 petal subtrees at endgame. Comparing against the last APPLIED value (not the
 * last computed one) caps the standing error at the settle threshold — skipped
 * deltas accumulate until they cross it, then write.
 */
export function shouldWritePetalNudge(
  lastApplied: PetalNudge | null,
  next: PetalNudge,
): boolean {
  if (lastApplied === null) return true;
  return (
    Math.abs(next.x - lastApplied.x) >= PETAL_NUDGE_SETTLE_THRESHOLD ||
    Math.abs(next.y - lastApplied.y) >= PETAL_NUDGE_SETTLE_THRESHOLD ||
    Math.abs(next.rotate - lastApplied.rotate) >= PETAL_NUDGE_SETTLE_THRESHOLD
  );
}

function readPetalBounds(element: HTMLDivElement): PetalBounds {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function isPetalVisibleForScoring(
  element: HTMLDivElement,
  bounds: PetalBounds,
): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) return false;

  const opacity = Number.parseFloat(window.getComputedStyle(element).opacity);
  if (Number.isFinite(opacity) && opacity < PETAL_SCORE_MIN_OPACITY) {
    return false;
  }

  return (
    bounds.left + bounds.width >= -PETAL_SCORE_VIEWPORT_PADDING &&
    bounds.left <= window.innerWidth + PETAL_SCORE_VIEWPORT_PADDING &&
    bounds.top + bounds.height >= -PETAL_SCORE_VIEWPORT_PADDING &&
    bounds.top <= window.innerHeight + PETAL_SCORE_VIEWPORT_PADDING
  );
}

export function easePetalNudge(current: PetalNudge, target: PetalNudge): PetalNudge {
  return {
    x: current.x + (target.x - current.x) * PETAL_NUDGE_EASE,
    y: current.y + (target.y - current.y) * PETAL_NUDGE_EASE,
    rotate: current.rotate + (target.rotate - current.rotate) * PETAL_NUDGE_EASE,
  };
}

export function isPetalNudgeSettled(nudge: PetalNudge): boolean {
  return (
    Math.abs(nudge.x) < PETAL_NUDGE_SETTLE_THRESHOLD &&
    Math.abs(nudge.y) < PETAL_NUDGE_SETTLE_THRESHOLD &&
    Math.abs(nudge.rotate) < PETAL_NUDGE_SETTLE_THRESHOLD
  );
}

function isVectorSettled(vector: PetalVector): boolean {
  return (
    Math.abs(vector.x) < PETAL_NUDGE_SETTLE_THRESHOLD &&
    Math.abs(vector.y) < PETAL_NUDGE_SETTLE_THRESHOLD
  );
}

export function applyPetalNudge(element: HTMLDivElement, nudge: PetalNudge) {
  element.style.setProperty("--push-x", `${nudge.x.toFixed(3)}px`);
  element.style.setProperty("--push-y", `${nudge.y.toFixed(3)}px`);
  element.style.setProperty(
    "--push-rotate",
    `${nudge.rotate.toFixed(3)}deg`,
  );
}

// Game-mode petals enter from the top on a small randomized stagger (seconds) so
// the rain reads as continuous without a synchronized "dump." Kept short so a petal
// that activates mid-run during a difficulty bump shows up promptly.
const NORMAL_PETAL_TOP_ENTRY_STAGGER_S = 6;

// When a difficulty bump activates a whole cohort of new petals at once, spread their top-entry
// over this window (seconds) instead of dropping them all at t=0. The cohort is given evenly-
// distributed delays (0 .. this), with a touch of jitter, so the rain thickens as a smooth
// trickle rather than a synchronized "waterfall" followed by a gap.
const NORMAL_PETAL_ACTIVATION_STAGGER_S = 5;

export function createNormalPetalConfig(
  index: number,
  count: number,
  fallSpeed = 1,
  startFromTop = false,
): PetalConfig {
  const segmentWidth = 100 / count;
  const segmentStart = index * segmentWidth;
  const segmentEnd = (index + 1) * segmentWidth;
  const randomOffset = Math.random() * Math.max(1, segmentEnd - segmentStart - 3);
  const startX = Math.max(3, Math.min(97, segmentStart + randomOffset + 1.5));
  const swayDirection = Math.random() > 0.5 ? 1 : -1;
  const swayMagnitude = 28 + Math.random() * 42;
  const duration = 13 + Math.random() * 7;

  return {
    key: `n-${index}`,
    kind: "normal",
    // Decorative mode starts each petal at a random point in its fall (negative
    // animation-delay) so the rain is evenly distributed from the first frame.
    //
    // The dodge game (startFromTop) cannot do that: a negative delay makes a petal
    // — including ones that newly activate as difficulty ramps — materialize
    // mid-screen, sometimes right on the cursor, which is impossible to avoid and
    // instantly resets the run. Game petals instead enter from the top on a short
    // positive stagger, so every obstacle is visible coming down and dodgeable.
    delay: startFromTop
      ? Math.random() * NORMAL_PETAL_TOP_ENTRY_STAGGER_S
      : -(Math.random() * duration),
    duration,
    fallSpeed,
    startX,
    // Keep the random spread tight so every petal reads as "the same size."
    // A wide range (e.g. 36–58) let some petals draw a small base that, combined
    // with the bottom-of-fall perspective shrink (~0.62×), rendered VERY tiny
    // next to fresh full-size neighbors. ~44–54 keeps a hint of natural variety
    // without outliers.
    size: 44 + Math.random() * 10,
    swayStartX: -swayDirection * swayMagnitude * 0.35,
    swayMidX: swayDirection * swayMagnitude,
    swayEndX: -swayDirection * swayMagnitude * 0.65,
    swayMidY: 10 + Math.random() * 18,
    swayDuration: 3.6 + Math.random() * 2.4,
    loop: true,
    normalSlot: index,
  };
}

/**
 * Render-time identity (React key) + entry delay for a normal, looping petal, derived
 * from its LIVE captured fall speed.
 *
 * The key embeds the fall speed so that a difficulty-driven speed change forces React to
 * REMOUNT the petal — a brand-new CSS animation that starts at elapsed 0, i.e. at the very
 * top (`translateY(-20px)`). The alternative (a stable key) makes React merely restyle the
 * inline `animation-duration` on a still-running `infinite` animation; the browser then
 * keeps the accumulated elapsed time and re-bases progress to `fract(elapsed / newDuration)`,
 * teleporting the petal mid-screen (deeper/more often the faster it gets). See
 * tests/topEntry.test.ts.
 *
 * On a fresh first appearance (speed still 1) the petal keeps its positive stagger delay so
 * the field doesn't "dump" all at once at t=0. Once it has been bumped (speed !== 1) it is a
 * re-entry after a completed cycle, so the delay drops to 0 and it re-enters from the top
 * immediately instead of leaving a multi-second blank gap at the difficulty step.
 */
export function getNormalPetalRenderIdentity(
  index: number,
  configDelay: number,
  fallSpeed: number,
): { key: string; delay: number } {
  return {
    key: `n-${index}@${fallSpeed}`,
    delay: fallSpeed === 1 ? configDelay : 0,
  };
}

/**
 * Return `current` with `index` set to `speed` (normalized to `poolCount` entries) —
 * or **the same reference** when nothing would change, so a `setState(withUpdated…)`
 * bails out of the render entirely. This matters: a petal's cycle end fires this once
 * per fall loop, and at endgame (~110 petals at 7× speed) that is ~45 calls/sec. The
 * common case — difficulty held steady, speed unchanged — must not re-render the
 * whole petal field.
 */
export function withUpdatedFallSpeed(
  current: number[],
  poolCount: number,
  index: number,
  speed: number,
): number[] {
  if (current.length === poolCount && (current[index] ?? 1) === speed) {
    return current;
  }
  const next = Array.from({ length: poolCount }, (_, i) => current[i] ?? 1);
  next[index] = speed;
  return next;
}

function getPetalRepulsionOptions(kind: PetalKind): PetalRepulsionOptions {
  return kind === "golden" ? GOLDEN_PETAL_REPULSION : NORMAL_PETAL_REPULSION;
}

function getPetalId(petal: RenderedPetal, lifeIds: number[]): string {
  if (petal.kind === "golden") {
    return getGoldenPetalScoreId(
      petal.spawnId ?? 0,
      petal.burstSlot ?? 0,
    );
  }

  const lifeId = lifeIds[petal.poolIndex] ?? 0;
  return getNormalPetalScoreId(petal.poolIndex, lifeId);
}

export function Petal({
  delay,
  duration,
  startX,
  size,
  kind = "normal",
  swayStartX = -16,
  swayMidX = 34,
  swayEndX = -22,
  swayMidY = 16,
  swayDuration = 4.8,
  loop = true,
  className = "petal",
  fallSpeed = 1,
  outerRef,
  bodyRef,
  onLoop,
  onAnimationEnd,
}: Pick<
  PetalConfig,
  "delay" | "duration" | "fallSpeed" | "startX" | "size"
> &
  Partial<
    Pick<
      PetalConfig,
      | "kind"
      | "swayStartX"
      | "swayMidX"
      | "swayEndX"
      | "swayMidY"
      | "swayDuration"
      | "loop"
    >
> & {
  className?: string;
  outerRef?: (node: HTMLDivElement | null) => void;
  bodyRef?: (node: HTMLDivElement | null) => void;
  onLoop?: () => void;
  onAnimationEnd?: () => void;
}) {
  const petalClassName = className;
  const safeFallSpeed =
    Number.isFinite(fallSpeed) && fallSpeed > 0
      ? fallSpeed
      : 1;
  // INVARIANT: a mounted petal's CSS animation timing is immutable. Mutating
  // animation-delay (or -duration) on a RUNNING animation re-bases its progress
  // (active time = elapsed − delay), teleporting the petal mid-fall — e.g. when the
  // entry-stagger override is dropped after the first cycle while the React key is
  // unchanged. The only sanctioned retiming is a key change (remount), which is how
  // difficulty speed bumps already work — see getNormalPetalRenderIdentity.
  const frozenTimingRef = useRef<{ delay: number; durationS: number } | null>(null);
  if (frozenTimingRef.current === null) {
    frozenTimingRef.current = {
      delay,
      durationS: duration / safeFallSpeed,
    };
  }
  const frozenTiming = frozenTimingRef.current;
  const imageHeight = Math.round(size);
  const imageWidth =
    kind === "golden"
      ? Math.round(imageHeight * GOLDEN_PETAL_ASPECT_RATIO)
      : imageHeight;
  const style = {
    left: `${startX}%`,
    animationDelay: `${frozenTiming.delay}s`,
    animationDuration: `${frozenTiming.durationS.toFixed(3)}s`,
    animationIterationCount: loop ? undefined : 1,
    "--sway-start-x": `${swayStartX.toFixed(2)}px`,
    "--sway-mid-x": `${swayMidX.toFixed(2)}px`,
    "--sway-end-x": `${swayEndX.toFixed(2)}px`,
    "--sway-mid-y": `${swayMidY.toFixed(2)}px`,
    "--sway-duration": `${swayDuration.toFixed(2)}s`,
  } as CSSProperties;

  return (
    <div
      ref={outerRef}
      className={petalClassName}
      aria-hidden="true"
      // Only react to THIS element's fall animation. The child drift animation is
      // infinite and its animationiteration/animationend events bubble up here — without
      // this guard a petal would re-identify itself every few seconds and silently reset
      // the player's streak.
      onAnimationIteration={
        loop
          ? (event) => {
              if (event.target === event.currentTarget) onLoop?.();
            }
          : undefined
      }
      onAnimationEnd={
        !loop
          ? (event) => {
              if (event.target === event.currentTarget) onAnimationEnd?.();
            }
          : undefined
      }
      style={style}
    >
      <div className="petal-sway">
        <div ref={bodyRef} className="petal-body">
          <img
            src={kind === "golden" ? goldenPetalUrl : NORMAL_PETALS[Math.floor(startX * 7.31) % NORMAL_PETALS.length]}
            alt=""
            width={imageWidth}
            height={imageHeight}
            draggable={false}
            style={{ width: `${imageWidth}px`, height: `${imageHeight}px` }}
            className="petal-img"
            data-kind={kind}
          />
        </div>
      </div>
    </div>
  );
}

type PetalFieldProps = {
  count?: number;
  className?: string;
  interactive?: PetalFieldMode;
  disabled?: boolean;
  /** Fired whenever the score changes, with the new authoritative game state. */
  onScore?: (event: ScoreEvent) => void;
  /** Fired when the game (interactive scoring) becomes available/unavailable. */
  onPlayableChange?: (enabled: boolean) => void;
};

export function PetalField({
  count = 10,
  className = "petal",
  interactive,
  disabled = false,
  onScore,
  onPlayableChange,
}: PetalFieldProps) {
  const [mounted, setMounted] = useState(false);
  const [playEnabled, setPlayEnabled] = useState(false);
  const [difficultyLevel, setDifficultyLevelState] = useState(0);
  // Captured per petal lifecycle so difficulty changes do not retime visible petals.
  const [normalFallSpeeds, setNormalFallSpeeds] = useState<number[]>([]);
  const [visibleNormalIndexes, setVisibleNormalIndexes] = useState<number[]>([]);
  const [goldenPetals, setGoldenPetals] = useState<PetalConfig[]>([]);
  const outerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const bodyRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Motion state (repulsion, bounce spring, last DOM write) keyed by petal.key —
  // see PetalMotionState for why keys, not render indexes.
  const motionRef = useRef<Map<string, PetalMotionState>>(new Map());
  const petalLifeIdsRef = useRef<number[]>([]);
  const wasTouchingRef = useRef<Record<string, boolean>>({});
  // A golden petal SCORES on every fresh entry. This set only tracks whether its first
  // entry has already advanced the chain/difficulty; later entries keep scoring at the
  // current multiplier without advancing the chain again.
  const scoredGoldenIdsRef = useRef<Set<string>>(new Set());
  const goldenPetalsRef = useRef<PetalConfig[]>([]);
  const goldenTimerRef = useRef<number | null>(null);
  const goldenBurstIdRef = useRef(0);
  const maxGoldenRef = useRef(2);
  const fallSpeedRef = useRef(1);
  const difficultyLevelRef = useRef(0);
  const targetNormalIndexesRef = useRef<number[]>([]);
  // Per-index entry-delay override (seconds) for petals that *freshly activate* during a
  // difficulty bump. Spreading a newly-activated cohort over a few seconds is what stops the
  // whole batch dumping from the top at once (the "waterfall"). Cleared on a petal's first
  // cycle end so subsequent re-entries fall promptly (see handlePetalCycleEnd).
  const entryStaggerRef = useRef<Record<number, number>>({});
  const onScoreRef = useRef(onScore);
  const onPlayableChangeRef = useRef(onPlayableChange);
  const pointerRef = useRef<PetalPointer | null>(null);
  // Golden-only high-frequency input trace. Normal obstacle detection intentionally
  // keeps its existing one-position-per-frame behavior and therefore its current feel.
  const goldenPointerSamplesRef = useRef<PetalPointer[]>([]);
  const lastGoldenPointerSampleRef = useRef<PetalPointer | null>(null);
  const rafRef = useRef<number | null>(null);
  const renderedPetalsRef = useRef<RenderedPetal[]>([]);
  // Authoritative game state lives here (not in React) so scoring is never subject to
  // render lag. The host receives snapshots purely for display.
  const snapshotRef = useRef<PetalGameSnapshot>(createPetalGameSnapshot());
  // Last time the streak petal was under the cursor — drives the grace window so a fast
  // chase that clips other petals doesn't reset the run.
  const lastStreakTouchAtRef = useRef<number>(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    onScoreRef.current = onScore;
  }, [onScore]);

  useEffect(() => {
    onPlayableChangeRef.current = onPlayableChange;
  }, [onPlayableChange]);

  useEffect(() => {
    goldenPetalsRef.current = goldenPetals;
  }, [goldenPetals]);

  const setDifficultyLevel = useCallback((level: number) => {
    const nextLevel = clampPetalDifficultyLevel(level);
    if (difficultyLevelRef.current === nextLevel) return;
    difficultyLevelRef.current = nextLevel;
    setDifficultyLevelState(nextLevel);
  }, []);

  // A golden touch ratchets difficulty up to the chain depth it just reached; it never decays
  // on its own. The screen only calms back down on a hard reset (a normal-petal touch, or the
  // game going inactive) — so a player who keeps a run alive purely by dodging holds the chaos
  // they earned instead of watching it collapse during a lull between goldens.
  const bumpRunDifficulty = useCallback(
    (snapshot: PetalGameSnapshot, now: number) => {
      setDifficultyLevel(
        nextRunDifficultyLevel(difficultyLevelRef.current, snapshot, now),
      );
    },
    [setDifficultyLevel],
  );

  const normalPoolCount =
    interactive === "play"
      ? Math.max(count, PETAL_DIFFICULTY_NORMAL_MAX_ACTIVE)
      : count;
  const difficulty = useMemo(
    () => calculatePetalDifficulty(difficultyLevel, count),
    [count, difficultyLevel],
  );
  const targetNormalIndexes = useMemo(
    () =>
      selectEvenlyDistributedPetalIndexes(
        normalPoolCount,
        interactive === "play" ? difficulty.obstacleCount : normalPoolCount,
      ),
    [
      difficulty.obstacleCount,
      interactive,
      normalPoolCount,
    ],
  );
  targetNormalIndexesRef.current = targetNormalIndexes;

  useEffect(() => {
    maxGoldenRef.current = difficulty.maxGolden;
    fallSpeedRef.current = difficulty.fallSpeed;
  }, [difficulty.fallSpeed, difficulty.maxGolden]);

  const normalPetals = useMemo<PetalConfig[]>(() => {
    // In the game, petals must fall from the top to be dodgeable; decorative
    // fields keep the vertically-distributed look (see createNormalPetalConfig).
    const startFromTop = interactive === "play";
    return Array.from({ length: normalPoolCount }, (_, index) =>
      createNormalPetalConfig(index, normalPoolCount, 1, startFromTop),
    );
  }, [interactive, normalPoolCount]);

  useEffect(() => {
    setNormalFallSpeeds((current) =>
      Array.from({ length: normalPoolCount }, (_, index) => current[index] ?? 1),
    );
  }, [normalPoolCount]);

  useEffect(() => {
    const visibleSet = new Set(
      visibleNormalIndexes.filter((index) => index >= 0 && index < normalPoolCount),
    );
    const newlyVisibleIndexes = targetNormalIndexes.filter(
      (index) => !visibleSet.has(index),
    );

    setVisibleNormalIndexes((current) => {
      const currentSet = new Set(
        current.filter((index) => index >= 0 && index < normalPoolCount),
      );
      targetNormalIndexes.forEach((index) => currentSet.add(index));
      const next = Array.from(currentSet).sort((left, right) => left - right);

      if (
        next.length === current.length &&
        next.every((index, itemIndex) => index === current[itemIndex])
      ) {
        return current;
      }

      return next;
    });

    if (newlyVisibleIndexes.length === 0) return;

    // Stagger the freshly-activated cohort across NORMAL_PETAL_ACTIVATION_STAGGER_S so they
    // trickle in from the top instead of dumping all at once. Even spread (by position in the
    // cohort) guarantees no clustering; a little jitter keeps it from reading as a marching line.
    // GAME MODE ONLY: decorative fields use negative delays (each petal starts mid-fall) so the
    // rain is vertically distributed from the first frame — a stagger override would collapse
    // that into a top-entry trickle.
    if (interactive === "play") {
      const span = Math.max(1, newlyVisibleIndexes.length - 1);
      newlyVisibleIndexes.forEach((index, position) => {
        const base = (position / span) * NORMAL_PETAL_ACTIVATION_STAGGER_S;
        const jitter = (Math.random() - 0.5) * (NORMAL_PETAL_ACTIVATION_STAGGER_S / span);
        entryStaggerRef.current[index] = Math.max(0, base + jitter);
      });
    }

    setNormalFallSpeeds((speeds) => {
      const nextSpeed = fallSpeedRef.current;
      // withUpdatedFallSpeed returns the same reference for no-op updates, so a
      // cohort whose speeds are already captured (e.g. decorative mode at 1×) does
      // not re-render the field.
      return newlyVisibleIndexes.reduce(
        (acc, index) =>
          withUpdatedFallSpeed(acc, normalPoolCount, index, nextSpeed),
        speeds,
      );
    });
  }, [interactive, normalPoolCount, targetNormalIndexes, visibleNormalIndexes]);

  const renderedPetals = useMemo<RenderedPetal[]>(() => {
    const normal = visibleNormalIndexes.flatMap((index) => {
      const petal = normalPetals[index];
      if (!petal) return [];
      const fallSpeed = normalFallSpeeds[index] ?? 1;
      // Embed the live speed in the key so a speed change remounts the petal (fresh top
      // entry) instead of re-basing a running animation mid-screen — see
      // getNormalPetalRenderIdentity.
      const { key, delay } = getNormalPetalRenderIdentity(
        index,
        petal.delay,
        fallSpeed,
      );
      // A freshly-activated petal (difficulty bump) carries a per-index entry-delay override so
      // the cohort trickles in instead of waterfalling. Cleared after its first fall cycle.
      const entryStagger = entryStaggerRef.current[index];
      return [
        {
          ...petal,
          key,
          delay: entryStagger ?? delay,
          fallSpeed,
          poolIndex: index,
        },
      ];
    });
    const golden = goldenPetals.map((petal, index) => ({
      ...petal,
      poolIndex: normalPoolCount + index,
    }));

    return [...normal, ...golden];
  }, [
    goldenPetals,
    normalFallSpeeds,
    normalPetals,
    normalPoolCount,
    visibleNormalIndexes,
  ]);

  // Keep the live petal list in a ref so the pointer/animation effect can read it
  // without re-subscribing window listeners every time a golden petal spawns/despawns.
  useEffect(() => {
    renderedPetalsRef.current = renderedPetals;
  }, [renderedPetals]);

  useEffect(() => {
    petalLifeIdsRef.current = normalPetals.map(
      (_, index) => petalLifeIdsRef.current[index] ?? 0,
    );
  }, [normalPetals]);

  useEffect(() => {
    onPlayableChangeRef.current?.(playEnabled);
  }, [playEnabled]);

  useEffect(() => {
    if (interactive !== "play" || disabled) {
      setPlayEnabled(false);
      return;
    }

    const playQuery = window.matchMedia(PLAYABLE_MEDIA_QUERY);
    const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
    const updatePlayEnabled = () => {
      setPlayEnabled(playQuery.matches && !reducedMotionQuery.matches);
    };

    updatePlayEnabled();
    playQuery.addEventListener("change", updatePlayEnabled);
    reducedMotionQuery.addEventListener("change", updatePlayEnabled);

    return () => {
      playQuery.removeEventListener("change", updatePlayEnabled);
      reducedMotionQuery.removeEventListener("change", updatePlayEnabled);
    };
  }, [disabled, interactive]);

  const spawnGoldenPetals = useCallback((requestedCount = 1) => {
    const maxActive = maxGoldenRef.current;
    const safeRequestedCount =
      Number.isFinite(requestedCount) && requestedCount > 0
        ? Math.floor(requestedCount)
        : 1;

    setGoldenPetals((current) => {
      const spawnCount = Math.min(safeRequestedCount, maxActive - current.length);
      if (spawnCount <= 0) return current;

      const additions = Array.from({ length: spawnCount }, () => {
        const spawnId = goldenBurstIdRef.current + 1;
        goldenBurstIdRef.current = spawnId;
        const petal = createGoldenPetal(Date.now() + spawnId, spawnId);

        return {
          key: `g-${spawnId}`,
          kind: "golden" as const,
          delay: petal.delay,
          duration: petal.duration,
          fallSpeed: fallSpeedRef.current,
          startX: petal.startX,
          size: petal.size,
          swayStartX: petal.swayStartX,
          swayMidX: petal.swayMidX,
          swayEndX: petal.swayEndX,
          swayMidY: petal.swayMidY,
          swayDuration: petal.swayDuration,
          loop: false,
          spawnId,
          burstSlot: petal.burstSlot,
        };
      });

      return [...current, ...additions];
    });
  }, []);

  // Golden spawning is purely timer-driven (below). We intentionally do NOT spawn an
  // extra golden on every difficulty level-up — that fired right after each golden touch
  // and stacked a second petal on top of the timed one, which read as a "cluster of 2."
  // The spawn-rate multiplier shortens the timer interval as the chain climbs instead.

  useEffect(() => {
    if (!playEnabled) {
      if (goldenTimerRef.current !== null) {
        window.clearTimeout(goldenTimerRef.current);
        goldenTimerRef.current = null;
      }
      setDifficultyLevel(0);
      fallSpeedRef.current = 1;
      targetNormalIndexesRef.current = [];
      entryStaggerRef.current = {};
      setVisibleNormalIndexes([]);
      setNormalFallSpeeds((current) =>
        current.every((speed) => speed === 1) ? current : current.map(() => 1),
      );
      goldenBurstIdRef.current = 0;
      setGoldenPetals([]);
      return;
    }

    let isFirstBurst = goldenBurstIdRef.current === 0;

    const scheduleNextBurst = () => {
      const delay = getGoldenPetalBurstDelayMs(
        Math.random(),
        isFirstBurst,
        difficulty.spawnRate,
      );
      isFirstBurst = false;
      goldenTimerRef.current = window.setTimeout(() => {
        goldenTimerRef.current = null;
        if (!document.hidden) {
          spawnGoldenPetals();
        }
        scheduleNextBurst();
      }, delay);
    };

    scheduleNextBurst();

    return () => {
      if (goldenTimerRef.current !== null) {
        window.clearTimeout(goldenTimerRef.current);
        goldenTimerRef.current = null;
      }
    };
  }, [
    playEnabled,
    difficulty.spawnRate,
    setDifficultyLevel,
    spawnGoldenPetals,
  ]);

  useEffect(() => {
    if (!playEnabled) {
      pointerRef.current = null;
      goldenPointerSamplesRef.current = [];
      lastGoldenPointerSampleRef.current = null;
      wasTouchingRef.current = {};
      scoredGoldenIdsRef.current.clear();
      snapshotRef.current = createPetalGameSnapshot();
      lastStreakTouchAtRef.current = 0;
      setDifficultyLevel(0);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      motionRef.current.clear();
      bodyRefs.current.forEach((element) => {
        if (element) applyPetalNudge(element, ZERO_PETAL_NUDGE);
      });
      return;
    }

    const animate = () => {
      const pointer = pointerRef.current;
      let shouldContinue = pointer !== null;
      const now = performance.now();
      const lastObstacleId = snapshotRef.current.lastObstacleId;
      const edges: FramePetalEdge[] = [];
      let streakTouchedThisFrame = false;

      // Consume every pointer coordinate delivered since the previous frame. Include
      // the last processed point so an inter-frame segment can cross a small golden
      // hitbox even when neither endpoint lands inside it. The current pointer is also
      // sampled when stationary so a falling petal can enter the cursor on its own.
      const queuedGoldenSamples = goldenPointerSamplesRef.current;
      goldenPointerSamplesRef.current = [];
      const goldenPointerSamples: PetalPointer[] = [];
      const appendGoldenSample = (sample: PetalPointer | null) => {
        if (!sample) return;
        const previous = goldenPointerSamples[goldenPointerSamples.length - 1];
        if (previous?.x === sample.x && previous.y === sample.y) return;
        goldenPointerSamples.push(sample);
      };
      if (pointer) {
        appendGoldenSample(lastGoldenPointerSampleRef.current);
        queuedGoldenSamples.forEach(appendGoldenSample);
        appendGoldenSample(pointer);
        lastGoldenPointerSampleRef.current = pointer;
      } else {
        lastGoldenPointerSampleRef.current = null;
      }

      // PHASE 1 — read. Every layout read (rects, the gated getComputedStyle) happens
      // before any style write in phase 2, so the browser resolves style once per frame
      // instead of once per petal (interleaved read→write→read forces a flush per petal —
      // ~130 forced flushes/frame at endgame).
      const frames: Array<{
        petal: RenderedPetal;
        bodyElement: HTMLDivElement;
        trackBounds: PetalBounds;
      }> = [];
      renderedPetalsRef.current.forEach((petal) => {
        const petalElement = outerRefs.current[petal.poolIndex];
        const bodyElement = bodyRefs.current[petal.poolIndex];
        if (!petalElement || !bodyElement) return;

        // Two rect reads per petal, deliberately: repulsion anchors to the OUTER
        // (un-drifted) fall track, not the swaying visual position. Deriving the
        // anchor from the visual bounds was tried (halves the reads) and reverted —
        // coupling repulsion to the drift sway made petals near the cursor buzz
        // against their own sway instead of bowing away smoothly.
        const trackBounds = readPetalBounds(petalElement);
        const visualBounds = readPetalBounds(bodyElement);
        const scoreId = getPetalId(petal, petalLifeIdsRef.current);
        const touchOptions =
          petal.kind === "golden" ? GOLDEN_PETAL_TOUCH_OPTIONS : PETAL_TOUCH_OPTIONS;
        const wasTouching = wasTouchingRef.current[scoreId] ?? false;
        const center = getPetalBoundsCenter(visualBounds);

        if (petal.kind === "golden") {
          // Golden petals use the entire high-frequency trace, not merely the last cursor
          // coordinate in this animation frame. This is deliberately kind-specific:
          // rapid golden passes score reliably while normal obstacle sensitivity stays
          // exactly as forgiving as before.
          const trace = tracePetalTouchEntries(
            goldenPointerSamples,
            visualBounds,
            touchOptions,
            wasTouching,
          );
          const hasContact = trace.entries.length > 0 || trace.touching;
          const isVisible =
            hasContact && isPetalVisibleForScoring(petalElement, visualBounds);
          wasTouchingRef.current[scoreId] = isVisible ? trace.touching : false;

          if (isVisible) {
            trace.entries.forEach((entry) => {
              edges.push({
                scoreId,
                kind: petal.kind,
                distance: entry.distance,
                renderKey: petal.key,
                center,
                pointer: entry.pointer,
                sampleNo: entry.sampleNo,
                sampleT: entry.sampleT,
              });
            });
          }
        } else {
          const distance = getPetalTouchDistance(
            pointer,
            visualBounds,
            touchOptions,
          );
          // Normal obstacles intentionally retain the original rAF sampling and opacity
          // gate. Their hit sensitivity and 500 ms grace behavior are unchanged.
          const touching =
            distance !== null &&
            isPetalVisibleForScoring(petalElement, visualBounds);
          wasTouchingRef.current[scoreId] = touching;

          if (touching && scoreId === lastObstacleId) {
            streakTouchedThisFrame = true;
          }

          if (touching && !wasTouching && distance !== null && pointer) {
            edges.push({
              scoreId,
              kind: petal.kind,
              distance,
              renderKey: petal.key,
              center,
              pointer,
              sampleNo: goldenPointerSamples.length,
              sampleT: 1,
            });
          }
        }

        frames.push({ petal, bodyElement, trackBounds });
      });

      // PHASE 2 — compute + write. Pure math per petal, then a single (deduped) style
      // write. Motion = eased cursor repulsion + a damped-spring bounce from the last
      // touch.
      frames.forEach(({ petal, bodyElement, trackBounds }) => {
        const motion = getPetalMotionState(motionRef.current, petal.key);
        const target = calculatePetalRepulsionNudge(
          pointer,
          trackBounds,
          getPetalRepulsionOptions(petal.kind),
        );
        const easedRepulsion = easePetalNudge(motion.nudge, target);
        motion.nudge = easedRepulsion;

        // Spring the offset back toward rest with damping (a blown-petal flutter).
        const offset = motion.springOffset;
        const velocity = motion.springVelocity;
        const nextVelocity: PetalVector = {
          x: (velocity.x - offset.x * PETAL_BOUNCE_SPRING) * (1 - PETAL_BOUNCE_DAMPING),
          y: (velocity.y - offset.y * PETAL_BOUNCE_SPRING) * (1 - PETAL_BOUNCE_DAMPING),
        };
        const nextOffset: PetalVector = {
          x: offset.x + nextVelocity.x,
          y: offset.y + nextVelocity.y,
        };
        const bounceSettled =
          isVectorSettled(nextOffset) && isVectorSettled(nextVelocity);
        motion.springOffset = bounceSettled ? ZERO_VECTOR : nextOffset;
        motion.springVelocity = bounceSettled ? ZERO_VECTOR : nextVelocity;

        const applied: PetalNudge = {
          x: easedRepulsion.x + nextOffset.x,
          y: easedRepulsion.y + nextOffset.y,
          rotate: easedRepulsion.rotate + nextOffset.x * PETAL_BOUNCE_SPIN,
        };
        // Snap to exact zero on the settling transition so a skipped petal rests clean;
        // thereafter the settled write is skipped entirely (shouldWritePetalNudge).
        const settled = isPetalNudgeSettled(easedRepulsion) && bounceSettled;
        const toWrite = settled ? ZERO_PETAL_NUDGE : applied;
        if (shouldWritePetalNudge(motion.applied, toWrite)) {
          applyPetalNudge(bodyElement, toWrite);
          motion.applied = toWrite;
        }

        if (!settled) {
          shouldContinue = true;
        }
      });

      if (streakTouchedThisFrame) {
        lastStreakTouchAtRef.current = now;
      }

      const obstacleInGrace =
        lastObstacleId !== null &&
        now - lastStreakTouchAtRef.current <= PETAL_ACTIVE_GRACE_MS;
      // Preserve the existing "one winner" rule when overlapping golden hitboxes
      // produce the same contact coordinate. Separate crossings along one fast segment
      // remain separate touches, and every rapid entry can score within the same frame.
      const selectedGoldenEdges = Array.from(
        edges
          .filter((edge) => edge.kind === "golden")
          .reduce((byContact, edge) => {
            const contactKey = `${edge.sampleNo}:${edge.pointer.x.toFixed(3)}:${edge.pointer.y.toFixed(3)}`;
            const current = byContact.get(contactKey);
            if (!current || edge.distance < current.distance) {
              byContact.set(contactKey, edge);
            }
            return byContact;
          }, new Map<string, FramePetalEdge>())
          .values(),
      ).sort(
        (left, right) =>
          left.sampleNo - right.sampleNo ||
          left.sampleT - right.sampleT,
      );

      const selectedNormal =
        selectedGoldenEdges.length === 0
          ? selectScoredPetalEdge({
              edges,
              lastObstacleId,
              obstacleInGrace,
            })
          : null;
      const selectedNormalEdge = selectedNormal
        ? edges.find(
            (candidate) =>
              candidate.kind === selectedNormal.kind &&
              candidate.scoreId === selectedNormal.scoreId,
          )
        : null;
      const scoredEdges =
        selectedGoldenEdges.length > 0
          ? selectedGoldenEdges
          : selectedNormalEdge
            ? [selectedNormalEdge]
            : [];
      const impulsedPetalIds = new Set<string>();

      scoredEdges.forEach((edge, scoreIndex) => {
        // A tiny monotonic offset keeps touchedAt unique when several golden entries
        // land in one animation frame, allowing the HUD tick key to reflect the final hit.
        const touchNow = now + scoreIndex * 0.001;
        // A golden advances the chain only the first time it's collected; re-touches keep
        // scoring at the current level. This is what keeps the difficulty ramp tied to
        // *distinct* goldens while still letting fast players farm points off one petal.
        const isNewGolden =
          edge.kind === "golden" &&
          !scoredGoldenIdsRef.current.has(edge.scoreId);
        const nextSnapshot = scorePetalTouch(
          snapshotRef.current,
          edge.scoreId,
          edge.kind,
          touchNow,
          { extendChain: isNewGolden },
        );
        snapshotRef.current = nextSnapshot;
        if (edge.kind === "golden") {
          scoredGoldenIdsRef.current.add(edge.scoreId);
          bumpRunDifficulty(nextSnapshot, touchNow);
        } else {
          // Touching a different / non-golden petal is the one and only way back down: the
          // run resets and the screen calms with it.
          setDifficultyLevel(0);
        }

        // Score every rapid entry, but cap the visual kick at once per petal per frame.
        // Otherwise multiple sub-frame contacts would stack a huge velocity and fling the
        // golden petal away; scoring sensitivity should improve without destabilizing motion.
        if (!impulsedPetalIds.has(edge.scoreId)) {
          impulsedPetalIds.add(edge.scoreId);
          // Add a velocity kick away from the cursor; the spring above turns it into a
          // smooth flutter. Golden petals also get bounded gusts, so they feel windier.
          const impulse = calculatePetalTouchImpulse({
            kind: edge.kind,
            center: edge.center,
            pointer: edge.pointer,
            sideRandom: Math.random(),
            liftRandom: Math.random(),
          });
          const motion = getPetalMotionState(motionRef.current, edge.renderKey);
          motion.springVelocity = {
            x: motion.springVelocity.x + impulse.x,
            y: motion.springVelocity.y + impulse.y,
          };
          shouldContinue = true;
        }

        onScoreRef.current?.({
          snapshot: snapshotRef.current,
          scoreId: edge.scoreId,
          kind: edge.kind,
        });
      });

      if (shouldContinue) {
        rafRef.current = window.requestAnimationFrame(animate);
      } else {
        rafRef.current = null;
      }
    };

    const startAnimation = () => {
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(animate);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const coalescedEvents = event.getCoalescedEvents?.() ?? [];
      const samples = coalescedEvents.length > 0 ? coalescedEvents : [event];
      const nextSamples = goldenPointerSamplesRef.current;
      samples.forEach((sample) => {
        const pointerSample = { x: sample.clientX, y: sample.clientY };
        const previous = nextSamples[nextSamples.length - 1];
        if (previous?.x !== pointerSample.x || previous.y !== pointerSample.y) {
          nextSamples.push(pointerSample);
        }
      });
      // Some browsers omit the dispatched event from getCoalescedEvents(). Always retain
      // its final coordinate so pointerRef and the scoring trace end at the same place.
      const finalSample = { x: event.clientX, y: event.clientY };
      const previous = nextSamples[nextSamples.length - 1];
      if (previous?.x !== finalSample.x || previous.y !== finalSample.y) {
        nextSamples.push(finalSample);
      }
      if (nextSamples.length > GOLDEN_POINTER_SAMPLE_LIMIT) {
        nextSamples.splice(0, nextSamples.length - GOLDEN_POINTER_SAMPLE_LIMIT);
      }
      startAnimation();
    };

    const handlePointerLeave = () => {
      pointerRef.current = null;
      goldenPointerSamplesRef.current = [];
      lastGoldenPointerSampleRef.current = null;
      startAnimation();
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) {
        handlePointerLeave();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerout", handlePointerOut, { passive: true });
    window.addEventListener("blur", handlePointerLeave);
    document.addEventListener("mouseleave", handlePointerLeave);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", handlePointerLeave);
      document.removeEventListener("mouseleave", handlePointerLeave);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Reads the petal list via renderedPetalsRef, so listeners stay bound across
    // golden spawn/despawn instead of churning on every renderedPetals change.
  }, [
    playEnabled,
    bumpRunDifficulty,
    setDifficultyLevel,
  ]);

  const handlePetalCycleEnd = (petal: RenderedPetal) => {
    // A real fall loop teleports the petal back to the top, so give it a fresh identity
    // and drop any streak that was riding the old one.
    const oldPetalId = getPetalId(petal, petalLifeIdsRef.current);
    delete wasTouchingRef.current[oldPetalId];
    if (snapshotRef.current.lastObstacleId === oldPetalId) {
      snapshotRef.current = { ...snapshotRef.current, lastObstacleId: null };
    }
    petalLifeIdsRef.current[petal.poolIndex] =
      (petalLifeIdsRef.current[petal.poolIndex] ?? 0) + 1;

    // The activation stagger only applies to a petal's first entry; once it has completed a
    // cycle it should re-enter promptly from the top (no blank gap), so drop the override.
    delete entryStaggerRef.current[petal.poolIndex];

    const targetNormalIndexes = new Set(targetNormalIndexesRef.current);
    if (!targetNormalIndexes.has(petal.poolIndex)) {
      setVisibleNormalIndexes((current) =>
        current.filter((index) => index !== petal.poolIndex),
      );
    } else {
      // Same-reference bail-out when the speed is unchanged (the common case while
      // difficulty holds steady) — otherwise every cycle end of every petal would
      // re-render the entire field (~45×/sec at endgame).
      setNormalFallSpeeds((current) =>
        withUpdatedFallSpeed(
          current,
          normalPoolCount,
          petal.poolIndex,
          fallSpeedRef.current,
        ),
      );
    }

    // A cycle end restarts the fall from the top; motion resets with it. Deleting the
    // key entry (rather than zeroing in place) also covers the speed-bump remount,
    // where the key changes and the old entry would otherwise linger.
    motionRef.current.delete(petal.key);

    const bodyElement = bodyRefs.current[petal.poolIndex];
    if (bodyElement) {
      applyPetalNudge(bodyElement, ZERO_PETAL_NUDGE);
    }
  };

  const handleGoldenPetalEnd = (petal: RenderedPetal) => {
    const scoreId = getPetalId(petal, petalLifeIdsRef.current);
    delete wasTouchingRef.current[scoreId];
    scoredGoldenIdsRef.current.delete(scoreId);
    motionRef.current.delete(petal.key);
    setGoldenPetals((current) => current.filter((item) => item.key !== petal.key));
  };

  if (!mounted) return null;
  if (interactive === "play" && !playEnabled) return null;

  return (
    <>
      {renderedPetals.map((petal) => {
        const { key, ...petalProps } = petal;

        return (
          <Petal
            key={key}
            {...petalProps}
            className={className}
            outerRef={(node) => {
              outerRefs.current[petal.poolIndex] = node;
            }}
            bodyRef={(node) => {
              bodyRefs.current[petal.poolIndex] = node;
            }}
            onLoop={() => handlePetalCycleEnd(petal)}
            onAnimationEnd={() => handleGoldenPetalEnd(petal)}
          />
        );
      })}
    </>
  );
}
