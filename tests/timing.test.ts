import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Petal,
  shouldWritePetalNudge,
  withUpdatedFallSpeed,
} from "@/game/PetalField";

// Vitest compiles component JSX with the classic runtime (React.createElement), so
// rendering .tsx components needs React in scope.

// Regression guards for the "petal teleports mid-screen" bug class: a mounted petal's
// CSS animation timing must be immutable (mutating animation-delay or -duration on a
// RUNNING animation re-bases its progress and snaps the petal mid-fall). The only
// sanctioned retiming is a React key change (remount). The in-place-rerender half of
// the freeze (frozenTimingRef ignoring later prop values) cannot be exercised in the
// node test env (no DOM, single render pass) — it is covered by the manual browser
// checklist; here we pin the first-render output and the pure helpers.
describe("Petal — animation timing is set from first-render values", () => {
  it("renders the delay verbatim and the duration divided by the fall speed", () => {
    const markup = renderToStaticMarkup(
      createElement(Petal, {
        delay: 3,
        duration: 14,
        fallSpeed: 2,
        startX: 40,
        size: 48,
      }),
    );

    expect(markup).toContain("animation-delay:3s");
    expect(markup).toContain("animation-duration:7.000s");
  });

  it("falls back to 1× for a non-finite fall speed", () => {
    const markup = renderToStaticMarkup(
      createElement(Petal, {
        delay: 0,
        duration: 14,
        fallSpeed: Number.NaN,
        startX: 40,
        size: 48,
      }),
    );

    expect(markup).toContain("animation-duration:14.000s");
  });
});

// The per-cycle-end state update must NOT re-render the field when nothing changed:
// at endgame (~110 petals at 7× speed) cycle ends fire ~45×/sec, and each avoidable
// render reconciles the entire ~130-petal tree. Same-reference return = React bails.
describe("withUpdatedFallSpeed", () => {
  it("returns the SAME reference when the speed is already captured", () => {
    const speeds = [1, 2.4, 3.75];

    expect(withUpdatedFallSpeed(speeds, 3, 1, 2.4)).toBe(speeds);
  });

  it("treats a missing entry as 1 for the no-op check", () => {
    const speeds = [1, 1, 1];

    expect(withUpdatedFallSpeed(speeds, 3, 1, 1)).toBe(speeds);
  });

  it("returns a new array changing only the target index", () => {
    const speeds = [1, 1, 1];
    const next = withUpdatedFallSpeed(speeds, 3, 2, 3.75);

    expect(next).not.toBe(speeds);
    expect(next).toEqual([1, 1, 3.75]);
    expect(speeds).toEqual([1, 1, 1]);
  });

  it("normalizes a short array to the pool size (missing entries -> 1)", () => {
    expect(withUpdatedFallSpeed([], 3, 1, 2)).toEqual([1, 2, 1]);
  });
});

// Skip-write predicate for the per-frame nudge: most of the field sits far from the
// cursor fully settled, and re-writing identical zeros every frame invalidates style
// for ~130 subtrees. Deltas are measured against the last APPLIED value, so skipped
// sub-threshold movement accumulates until it crosses the threshold (0.04) and writes.
describe("shouldWritePetalNudge", () => {
  const ZERO = { x: 0, y: 0, rotate: 0 };

  it("always writes when nothing has been applied yet", () => {
    expect(shouldWritePetalNudge(null, ZERO)).toBe(true);
  });

  it("skips an identical write", () => {
    expect(shouldWritePetalNudge(ZERO, { x: 0, y: 0, rotate: 0 })).toBe(false);
  });

  it("skips sub-threshold deltas", () => {
    expect(
      shouldWritePetalNudge(ZERO, { x: 0.02, y: -0.03, rotate: 0.01 }),
    ).toBe(false);
  });

  it("writes once a delta reaches the settle threshold on any axis", () => {
    expect(shouldWritePetalNudge(ZERO, { x: 0.04, y: 0, rotate: 0 })).toBe(true);
    expect(shouldWritePetalNudge(ZERO, { x: 0, y: 0.04, rotate: 0 })).toBe(true);
    expect(shouldWritePetalNudge(ZERO, { x: 0, y: 0, rotate: 0.04 })).toBe(true);
  });
});
