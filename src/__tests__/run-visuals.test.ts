// Run: node --test src/__tests__/run-visuals.test.ts   (Node 24, type-stripped)
//
// Pure derivation only (`run-visuals.ts` has no React import — A7), plus
// `edgeVisuals`'s widened signature (`flow-types.ts`), and the two traps this
// task's contract names by number:
//   Trap 2 — `flowToWorkflow` must never leak run state into the persisted
//     document (A6, mirroring `flow-utils.test.ts`'s "U11" case).
//   M4 — `succeeded` and `skipped` must differ from EACH OTHER, not merely
//     from a hardcoded literal (a near-miss: both are "done, not running").
import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeVisuals } from "../flow-types.ts";
import type { FlowWorkflow } from "../flow-types.ts";
import { type StepNode, flowToWorkflow, workflowToFlow } from "../flow-utils.ts";
import { type RunState, edgeRunState, stepNodeVisual, stepVisualState } from "../run-visuals.ts";

// ── stepVisualState ─────────────────────────────────────────────────────

test("stepVisualState — no runState ⇒ no-run", () => {
  assert.equal(stepVisualState(undefined, "a"), "no-run");
});

test("stepVisualState — a step present in runState.steps reads its own status", () => {
  const run: RunState = {
    status: "running",
    steps: { a: { status: "succeeded" }, b: { status: "failed" }, c: { status: "skipped" } },
  };
  assert.equal(stepVisualState(run, "a"), "succeeded");
  assert.equal(stepVisualState(run, "b"), "failed");
  assert.equal(stepVisualState(run, "c"), "skipped");
});

test("stepVisualState — a step absent from runState.steps reads pending (not yet reached)", () => {
  const run: RunState = { status: "running", steps: { a: { status: "succeeded" } } };
  assert.equal(stepVisualState(run, "never-reached"), "pending");
});

// ── stepNodeVisual — A2 (five StepStatus + no-run) ──────────────────────

const ALL_STATES = ["no-run", "pending", "running", "succeeded", "failed", "skipped"] as const;

test("stepNodeVisual — covers all six states with one of the five named tokens", () => {
  const allowedTokens = [
    "var(--w6w-accent)",
    "var(--w6w-success)",
    "var(--w6w-danger)",
    "var(--w6w-muted)",
    "var(--w6w-border)",
  ];
  for (const state of ALL_STATES) {
    const v = stepNodeVisual(state);
    assert.ok(
      allowedTokens.includes(v.borderColor),
      `${state} must use one of the five named tokens, got ${v.borderColor}`,
    );
  }
});

test("stepNodeVisual — every non-default state differs from no-run in a NON-colour dimension", () => {
  const base = stepNodeVisual("no-run");
  for (const state of ALL_STATES) {
    if (state === "no-run") continue;
    const v = stepNodeVisual(state);
    const nonColourDiffers =
      v.borderStyle !== base.borderStyle ||
      v.borderWidth !== base.borderWidth ||
      v.opacity !== base.opacity;
    assert.ok(nonColourDiffers, `${state} must differ from no-run in more than just colour`);
  }
});

test("M4 — succeeded and skipped are visually DIFFERENT from each other (not merely from a literal)", () => {
  const succeeded = stepNodeVisual("succeeded");
  const skipped = stepNodeVisual("skipped");
  assert.notDeepEqual(succeeded, skipped);
  // Compared to EACH OTHER, not to one hardcoded value: a mutant that
  // collapses both to the same near-miss literal must still fail this.
  assert.notEqual(succeeded.borderColor, skipped.borderColor);
});

test("A3 — RunStatus × StepStatus: a canceled/failed run's not-reached step differs from a running run's", () => {
  const stillRunning = stepNodeVisual("pending", "running");
  const runEnded = stepNodeVisual("pending", "failed");
  const runCanceled = stepNodeVisual("pending", "canceled");
  assert.notDeepEqual(stillRunning, runEnded);
  assert.notDeepEqual(stillRunning, runCanceled);
  assert.deepEqual(runEnded, runCanceled, "failed and canceled both mean the step will never run");
  // "queued" is also a non-terminal RunStatus — must read the same as "running".
  assert.deepEqual(stepNodeVisual("pending", "queued"), stillRunning);
  // "succeeded" is terminal too (the not-reached case is defensive — a
  // succeeded run leaves nothing "pending" in practice, but the mapping must
  // still be total over RunStatus, not special-cased to only failed/canceled).
  assert.deepEqual(stepNodeVisual("pending", "succeeded"), runEnded);
});

// ── edgeRunState — G2's inference rule ──────────────────────────────────

test("edgeRunState — no runState ⇒ undefined (untouched)", () => {
  assert.equal(edgeRunState(undefined, "a", "success"), undefined);
});

test("edgeRunState — from not yet reached (no record) ⇒ undefined", () => {
  const run: RunState = { status: "running", steps: {} };
  assert.equal(edgeRunState(run, "a", "success"), undefined);
});

test("edgeRunState — from still running ⇒ undefined (not decided yet)", () => {
  const run: RunState = { status: "running", steps: { a: { status: "running" } } };
  assert.equal(edgeRunState(run, "a", "success"), undefined);
});

test("edgeRunState — from succeeded: success/omitted-when lane taken, error lane skipped", () => {
  const run: RunState = { status: "succeeded", steps: { a: { status: "succeeded" } } };
  assert.equal(edgeRunState(run, "a", "success"), "taken");
  assert.equal(edgeRunState(run, "a", undefined), "taken");
  assert.equal(edgeRunState(run, "a", "error"), "skipped");
});

test("edgeRunState — from failed: error lane taken, success/omitted-when lane skipped", () => {
  const run: RunState = { status: "failed", steps: { a: { status: "failed" } } };
  assert.equal(edgeRunState(run, "a", "error"), "taken");
  assert.equal(edgeRunState(run, "a", "success"), "skipped");
  assert.equal(edgeRunState(run, "a", undefined), "skipped");
});

test("edgeRunState — from itself skipped: every outgoing edge skipped, regardless of lane", () => {
  const run: RunState = { status: "succeeded", steps: { a: { status: "skipped" } } };
  assert.equal(edgeRunState(run, "a", "success"), "skipped");
  assert.equal(edgeRunState(run, "a", "error"), "skipped");
  assert.equal(edgeRunState(run, "a", undefined), "skipped");
});

// ── edgeVisuals — widened signature (flow-types.ts) ─────────────────────

test("A1 — edgeVisuals(when) with no second argument is byte-identical to before this task", () => {
  assert.deepEqual(edgeVisuals("error"), { className: "w6w-edge-error", label: "on error" });
  assert.deepEqual(edgeVisuals("success"), {});
  assert.deepEqual(edgeVisuals(undefined), {});
});

test("edgeVisuals — a success/omitted-when edge carries only the run-state class", () => {
  assert.deepEqual(edgeVisuals(undefined, "taken"), { className: "w6w-edge-taken" });
  assert.deepEqual(edgeVisuals("success", "skipped"), { className: "w6w-edge-skipped" });
});

test("edgeVisuals — an error edge composes BOTH classes and keeps its label", () => {
  assert.deepEqual(edgeVisuals("error", "taken"), {
    className: "w6w-edge-error w6w-edge-taken",
    label: "on error",
  });
  assert.deepEqual(edgeVisuals("error", "skipped"), {
    className: "w6w-edge-error w6w-edge-skipped",
    label: "on error",
  });
});

test("M5-adjacent — taken and skipped mint DIFFERENT class names from each other", () => {
  const taken = edgeVisuals(undefined, "taken");
  const skipped = edgeVisuals(undefined, "skipped");
  assert.notEqual(taken.className, skipped.className);
});

// ── Trap 2 / M2 — nothing run-related leaks into the persisted document ──

const WF: FlowWorkflow = {
  manifestVersion: "2",
  id: "wf_test",
  name: "test",
  steps: [
    { id: "a", uses: { app: "@w6w/script", action: "run" } },
    { id: "b", uses: { app: "@w6w/script", action: "run" } },
  ],
  edges: [{ from: "a", to: "b", when: "error" }],
};

/** Simulate `Inner`'s live-run repaint effect stamping run state onto
 *  `data`/`className` — the exact keys/fields the effect touches, no more. */
function withRunVisualsStamped(nodes: StepNode[]): StepNode[] {
  return nodes.map((n) => ({
    ...n,
    data: { ...n.data, stepStatus: "succeeded" as const, runStatus: "running" as const },
  }));
}

test("M2 — flowToWorkflow(nodes-with-run-state) deepEquals flowToWorkflow(nodes-without) — nodes", () => {
  const { nodes, edges } = workflowToFlow(WF);
  const withoutRun = flowToWorkflow(WF, nodes, edges);
  const withRun = flowToWorkflow(WF, withRunVisualsStamped(nodes), edges);
  assert.deepEqual(withRun.steps, withoutRun.steps);
  assert.deepEqual(withRun, withoutRun);
});

test("M2 — flowToWorkflow ignores a run-stamped edge className/label — edges", () => {
  const { nodes, edges } = workflowToFlow(WF);
  const stampedEdges = edges.map((e) => ({
    ...e,
    className: `${e.className ?? ""} w6w-edge-taken`.trim(),
  }));
  const withoutRun = flowToWorkflow(WF, nodes, edges);
  const withRun = flowToWorkflow(WF, nodes, stampedEdges);
  assert.deepEqual(withRun.edges, withoutRun.edges);
  assert.deepEqual(withRun.edges, WF.edges);
});
