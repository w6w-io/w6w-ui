/**
 * Pure derivation of a live run's canvas visuals (T1.1.1) — step node styling
 * and main-graph edge taken/skipped/untouched state. Plain functions of (run
 * state, step/edge identity) → visual state, with **no React import**, so
 * `node --test` exercises them directly (A7) the same way `flow-connect.ts`'s
 * connection rules do.
 *
 * `RunStatus`/`StepStatus`/`RunState`/`StepExecution` below are thin LOCAL
 * copies of the shapes `@w6w/workflow-types` declares
 * (`packages/w6w-workflow/packages/types/mod.ts`) — the same house idiom
 * `components/HealthStatusPill.tsx`'s `HealthPillState` uses, and the same
 * design note `flow-types.ts`'s own header already states for
 * `FlowWorkflow`/`FlowStep`: `packages/ui/package.json` has no dependency on
 * `@w6w/workflow-types` and must not gain one, so this module stays a
 * pure-presentation leaf with no transport/spec coupling. A caller who
 * already has the real `RunState`/`StepExecution` is structurally compatible
 * for free.
 */

/** Mirrors `RunStatus` in `@w6w/workflow-types`. */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
/** Mirrors `StepStatus` in `@w6w/workflow-types`. */
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

/** The slice of `StepExecution` this module reads. */
export interface StepExecution {
  status: StepStatus;
}

/** The slice of `RunState` this module reads — steps keyed by step id, same
 *  as the engine's own `RunState.steps`. */
export interface RunState {
  status: RunStatus;
  steps: Record<string, StepExecution>;
}

const RUN_ENDED: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "canceled"]);

/**
 * A step node's rendered state — exactly the five {@link StepStatus} values
 * plus `"no-run"` (A2): `runState` omitted ⇒ `"no-run"` (this canvas isn't
 * showing any run). A step present in `runState.steps` renders its own
 * recorded status; a step the run hasn't reached yet has no entry there at
 * all (only steps that were actually started/skipped get a `StepExecution` —
 * see the engine's `recordSkipped`), so absence reads as `"pending"`.
 */
export type StepVisualState = "no-run" | StepStatus;

/**
 * The rendered state for step `stepId` under `runState` — the StepStatus
 * half of A3's RunStatus × StepStatus mapping. Pure function of the run's own
 * step records; no additional data needed (`GET /runs/:id` already returns
 * everything this reads).
 */
export function stepVisualState(runState: RunState | undefined, stepId: string): StepVisualState {
  if (!runState) return "no-run";
  return runState.steps[stepId]?.status ?? "pending";
}

/** One node's non-persisted, run-aware look. Colour is never the only signal
 *  (the house rule `HealthStatusPill`'s own doc comment states) — every
 *  non-default state also differs from the default (`"no-run"`) in
 *  `borderStyle`, `borderWidth`, or `opacity`. */
export interface StepNodeVisual {
  borderColor: string;
  borderStyle: "solid" | "dashed";
  borderWidth: number;
  opacity: number;
}

const NO_RUN_VISUAL: StepNodeVisual = {
  borderColor: "var(--w6w-border)",
  borderStyle: "solid",
  borderWidth: 1,
  opacity: 1,
};

/**
 * The node visual for a step's {@link StepVisualState}, `runStatus`
 * (the owning run's OWN status) additionally distinguishing the `"pending"`
 * case — A3: a `canceled`/`failed` run's not-yet-reached steps render
 * dimmer/muted (they never will run) than a `queued`/`running` run's
 * not-yet-reached steps (they still might), even though both share the same
 * `StepVisualState`. Every token used is one of the five named in
 * `context.notes` (`--w6w-accent`/`--w6w-success`/`--w6w-danger`/
 * `--w6w-muted`/`--w6w-border`) — never a literal hex, never a different
 * token family.
 */
export function stepNodeVisual(state: StepVisualState, runStatus?: RunStatus): StepNodeVisual {
  const runEnded = runStatus !== undefined && RUN_ENDED.has(runStatus);
  switch (state) {
    case "no-run":
      return NO_RUN_VISUAL;
    case "pending":
      return runEnded
        ? { borderColor: "var(--w6w-muted)", borderStyle: "dashed", borderWidth: 1, opacity: 0.5 }
        : { borderColor: "var(--w6w-border)", borderStyle: "dashed", borderWidth: 1, opacity: 1 };
    case "running":
      return { borderColor: "var(--w6w-accent)", borderStyle: "solid", borderWidth: 2, opacity: 1 };
    case "succeeded":
      return {
        borderColor: "var(--w6w-success)",
        borderStyle: "solid",
        borderWidth: 2,
        opacity: 1,
      };
    case "failed":
      return { borderColor: "var(--w6w-danger)", borderStyle: "solid", borderWidth: 2, opacity: 1 };
    case "skipped":
      return {
        borderColor: "var(--w6w-muted)",
        borderStyle: "dashed",
        borderWidth: 1,
        opacity: 0.7,
      };
    default:
      return NO_RUN_VISUAL;
  }
}

// ── Edge inference (main-graph `when` edges only — no `if`/then-else
// sub-block inference: the canvas has no rendering or authoring path for
// that construct today, see FOLLOWUPS.md) ───────────────────────────────

/** Whether a main-graph edge was taken, skipped, or left untouched by the
 *  run (`undefined` — the source step hasn't been decided yet, or there is
 *  no run). */
export type EdgeRunState = "taken" | "skipped";

/**
 * Whether the edge `from --(when)--> …` was taken or skipped in `runState` —
 * computable from the run's step records alone (no engine data beyond what
 * `GET /runs/:id` already returns):
 *   - `from` **succeeded**: its `"success"`/omitted-`when` edges are taken,
 *     its `"error"` edges are skipped.
 *   - `from` **failed**: a declared `"error"` edge is taken, every other
 *     outgoing edge (the `"success"` lane) is skipped.
 *   - `from` was itself **skipped** (reached only through a skipped edge —
 *     the engine's own `recordSkipped`/`markOutgoingEdgesSkipped`): every
 *     outgoing edge is skipped too, regardless of lane — a step that never
 *     ran cannot have taken an exit.
 *   - `from` is **running**, or has no record at all (not yet reached): the
 *     edge's fate isn't decided yet ⇒ `undefined`.
 */
export function edgeRunState(
  runState: RunState | undefined,
  from: string,
  when: "success" | "error" | undefined,
): EdgeRunState | undefined {
  if (!runState) return undefined;
  const exec = runState.steps[from];
  if (!exec) return undefined;
  const lane = when ?? "success";
  if (exec.status === "succeeded") return lane === "success" ? "taken" : "skipped";
  if (exec.status === "failed") return lane === "error" ? "taken" : "skipped";
  if (exec.status === "skipped") return "skipped";
  return undefined;
}
