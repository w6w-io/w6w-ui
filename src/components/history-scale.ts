/**
 * Pure geometry for `HistoryTimeline`'s vendor lane — positioning a vendor
 * incident bar on the SAME percentage scale the execution lane's day cells
 * use, so the two series can never drift apart (`HistoryTimeline.tsx`'s
 * alignment invariant). Deliberately split out of the component: a function
 * that reads a clock itself makes that invariant unobservable to a gate, so
 * `nowMs` is always a parameter here, never `Date.now()`.
 *
 * No JSX, no React import — this file is imported directly by its own test
 * (`__tests__/HistoryTimeline.test.ts`) with no transpile step.
 */
import type { HistoryWindow, VendorIncidentBar } from "./HistoryTimeline.tsx";

/**
 * Minimum visible width for a bar, as a percentage of the window's span. A
 * point-in-time entry (no `startedAt`) has zero duration and would otherwise
 * be invisible; a very short span is floored to the same width so it never
 * shrinks below it either.
 */
export const MIN_BAR_WIDTH_PCT = 1;

export interface BarPlacement {
  /** Left edge, as a percentage of the window's span, clamped to `[0, 100]`. */
  leftPct: number;
  /** Width, as a percentage of the window's span. Never below `MIN_BAR_WIDTH_PCT`. */
  widthPct: number;
  /** `true` if the bar's start was clamped to the window's left edge. */
  clippedStart: boolean;
  /** `true` if the bar's end was clamped to the window's right edge. */
  clippedEnd: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Places one vendor incident bar on the window's `[from T00:00:00Z, to+1 day
 * T00:00:00Z)` span.
 *
 * - A bar's start is `startedAt ?? updatedAt`; with neither present there is
 *   nothing to place, so this returns `null` (B5).
 * - Its end is `resolvedAt ?? (startedAt !== undefined ? nowMs : start)` — an
 *   open incident (has `startedAt`, no `resolvedAt`) therefore runs to
 *   `nowMs`, and a feed-only entry with no `startedAt` is a point in time,
 *   not a span (B3).
 * - A bar wholly outside the window (ends before it starts, or starts at or
 *   after it ends) returns `null` (B4). One overlapping an edge is clamped
 *   into the window, with `clippedStart`/`clippedEnd` set accordingly.
 */
export function placeIncidentBar(
  window: HistoryWindow,
  bar: VendorIncidentBar,
  nowMs: number,
): BarPlacement | null {
  const start = bar.startedAt ?? bar.updatedAt;
  if (start === undefined) return null;

  const startMs = Date.parse(start);
  const endMs =
    bar.resolvedAt !== undefined
      ? Date.parse(bar.resolvedAt)
      : bar.startedAt !== undefined
        ? nowMs
        : startMs;

  const windowStartMs = Date.parse(`${window.from}T00:00:00.000Z`);
  const windowEndMs = Date.parse(`${window.to}T00:00:00.000Z`) + DAY_MS;
  const spanMs = windowEndMs - windowStartMs;

  if (endMs < windowStartMs || startMs >= windowEndMs) return null;

  const clippedStart = startMs < windowStartMs;
  const clippedEnd = endMs > windowEndMs;

  // The clamp to [0, 100] (B2) happens HERE, on the raw timestamps, and is
  // the ONLY place either bound is clamped — `leftPct`/`widthPct` below are
  // plain arithmetic on the clamped values, so there is no second, redundant
  // clamp for a mutation to skip past undetected.
  const clampedStartMs = Math.max(startMs, windowStartMs);
  const clampedEndMs = Math.min(endMs, windowEndMs);

  const leftPct = ((clampedStartMs - windowStartMs) / spanMs) * 100;
  const rawWidthPct = ((clampedEndMs - clampedStartMs) / spanMs) * 100;
  const widthPct = Math.max(rawWidthPct, MIN_BAR_WIDTH_PCT);

  return { leftPct, widthPct, clippedStart, clippedEnd };
}
