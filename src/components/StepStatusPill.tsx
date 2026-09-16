import type { ReactNode } from "react";

/**
 * The five states a workflow step's execution can be in — a thin LOCAL copy
 * of the workflow spec's `StepStatus` union
 * (`packages/w6w-workflow/packages/types/mod.ts`). `@w6w/ui` deliberately
 * keeps a small literal type here rather than depend on `@w6w/workflow-types`,
 * so this stays a pure-presentation leaf with no transport/spec coupling —
 * the same precedent `HealthStatusPill`'s `HealthPillState` establishes.
 */
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface StepStatusPillProps {
  /** Which step state to render — drives the colour + default label. */
  state: StepStatus;
  /** Override the visible text (defaults to a humanised form of `state`). */
  label?: ReactNode;
  /** Accessible label for the pill (falls back to the visible text). */
  ariaLabel?: string;
}

const DEFAULT_LABELS: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * A small, theme-aware status pill for one workflow step's execution state.
 *
 * Mirrors `HealthStatusPill` shape for shape: a state union, a
 * `DEFAULT_LABELS` record, a coloured dot + text label using one
 * `--w6w-step-color` custom property per modifier class, and the
 * `w6w-step-pill w6w-step-pill-${state}` className convention. Colour is
 * never the only signal — the text label carries the same meaning for
 * accessibility. Five states rather than `HealthStatusPill`'s four, so this
 * is a mirror of that shape, not a shared implementation.
 */
export function StepStatusPill({ state, label, ariaLabel }: StepStatusPillProps) {
  const text = label ?? DEFAULT_LABELS[state];

  return (
    <span className={`w6w-step-pill w6w-step-pill-${state}`} aria-label={ariaLabel}>
      <span className="w6w-step-pill-dot" aria-hidden="true" />
      <span className="w6w-step-pill-label">{text}</span>
    </span>
  );
}
