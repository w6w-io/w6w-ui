// Run: node --test src/__tests__/flow-utils.test.ts  (Node 24, type-stripped)
//
// The `Edge.when` round-trip (core rfcs/workflow.md · "Amendment — 2026-07-29:
// failure-conditioned edges"). The trap this suite exists to pin:
// `flowToWorkflow` used to collapse every edge to `{ from, to }`, so an
// authored error edge was silently dropped on save and the feature presented as
// an engine fault.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Edge } from "@xyflow/react";
import { renameStepInEdges } from "../flow-connect.ts";
// The collision the ADDENDUM Y cases exercise is computed by the REAL rule, not
// hand-asserted: `connectConflict` is what the editor calls to name the sitting edge.
import { connectConflict } from "../flow-connect.ts";
// A separate statement again (never a widened line above — the zero-deleted-lines
// gate): T3.3.3 round 2 states its "both edges are on the success lane" precondition
// from the REAL lane rule rather than by eye.
import { edgeLane } from "../flow-connect.ts";
import { ERROR_SOURCE_HANDLE } from "../flow-types.ts";
import type { FlowWorkflow } from "../flow-types.ts";
// Separate statement, same reason as the flow-utils.ts imports below: T2.1.1's
// cases need FlowStep too, and widening the line above would read as a
// deletion to a reviewer diffing this file.
import type { FlowStep } from "../flow-types.ts";
import { type StepNode, flowToWorkflow, workflowToFlow } from "../flow-utils.ts";
// A second statement from the same module rather than widening the line above:
// T3.3.2's contract (ADDENDUM Z) gates this file on **zero deleted lines**, because
// a stale absolute test count is satisfiable by deleting cases — and a rewritten
// import line reads as a deletion to that gate.
import { storedViewport, withViewport } from "../flow-utils.ts";
// Third statement, same reason as the second: T3.3.3 inherits that zero-deleted-lines
// gate, so a widened import line above would read as deletions.
import { idClashMessage, relayoutNodes } from "../flow-utils.ts";
// Fourth statement, same reason: T2.1.1 (the code-view serializer pair) is a
// SEPARATE task from the three above and inherits no zero-deleted-lines gate of
// its own, but a widened import line still reads as a deletion to a reviewer
// diffing this file, so it gets its own line.
import { type StepLike, paramsToJson, stepToJson } from "../flow-utils.ts";

/** Three steps, so an edge can be authored between any pair. */
const WF: FlowWorkflow = {
  manifestVersion: "2",
  id: "wf_test",
  name: "test",
  steps: [
    { id: "a", uses: { app: "@w6w/script", action: "run" } },
    { id: "b", uses: { app: "@w6w/script", action: "run" } },
    { id: "c", uses: { app: "@w6w/script", action: "run" } },
  ],
  edges: [{ from: "a", to: "b" }],
};

/** A React Flow edge as the canvas would hold it, carrying an explicit lane. */
function rfEdge(source: string, target: string, when: "success" | "error"): Edge {
  return { id: `${source}->${target}`, source, target, data: { when } };
}

/** The nodes flowToWorkflow needs to keep the step list intact. */
function nodesOf(wf: FlowWorkflow): StepNode[] {
  return workflowToFlow(wf).nodes;
}

test("workflowToFlow — an error edge carries data.when + the error class; a plain edge is success", () => {
  const { edges } = workflowToFlow({
    ...WF,
    edges: [
      { from: "a", to: "b", when: "error" },
      { from: "b", to: "c" },
    ],
  });

  const err = edges[0];
  assert.equal(err.data?.when, "error");
  assert.match(String(err.className ?? ""), /w6w-edge-error/);

  const ok = edges[1];
  assert.equal(ok.data?.when, "success");
  assert.doesNotMatch(String(ok.className ?? ""), /w6w-edge-error/);
});

test("flowToWorkflow — an RF edge carrying data.when === 'error' emits { from, to, when }", () => {
  const next = flowToWorkflow(WF, nodesOf(WF), [rfEdge("a", "b", "error")]);
  assert.deepEqual(next.edges, [{ from: "a", to: "b", when: "error" }]);
});

test("flowToWorkflow — a success edge emits exactly { from, to } (no stray `when` key)", () => {
  const next = flowToWorkflow(WF, nodesOf(WF), [rfEdge("a", "b", "success")]);
  // Deep equality, not a field check: a `when: "success"` or `when: undefined`
  // key would break every persisted definition's byte-identical round-trip.
  assert.deepEqual(next.edges, [{ from: "a", to: "b" }]);
});

test("round-trip — flowToWorkflow(workflowToFlow(wf)) reproduces the authored edges exactly", () => {
  const wf: FlowWorkflow = {
    ...WF,
    edges: [
      { from: "a", to: "c" },
      { from: "a", to: "b", when: "error" },
      { from: "b", to: "c" },
    ],
  };
  const { nodes, edges } = workflowToFlow(wf);
  assert.deepEqual(flowToWorkflow(wf, nodes, edges).edges, wf.edges);
});

// ── T1.1.1. The load path stamps `sourceHandle` too, so a workflow saved
// before the error port existed renders its error edges from the new port on
// next open — not only edges drawn live after the feature shipped.

test("U10 — workflowToFlow stamps sourceHandle from data.when: error gets the port id, plain edge gets undefined", () => {
  const { edges } = workflowToFlow({
    ...WF,
    edges: [
      { from: "a", to: "b", when: "error" },
      { from: "b", to: "c" },
    ],
  });
  // Both assertions in one case — asserting only the error edge passes a
  // mutant that stamps EVERY edge with the handle id.
  assert.equal(edges[0].sourceHandle, ERROR_SOURCE_HANDLE);
  assert.equal(edges[1].sourceHandle, undefined);
});

test("U11 — the flowToWorkflow(workflowToFlow(wf)) round-trip does not leak sourceHandle into the persisted edge", () => {
  const wf: FlowWorkflow = {
    ...WF,
    edges: [
      { from: "a", to: "b", when: "error" },
      { from: "b", to: "c" },
    ],
  };
  const { nodes, edges } = workflowToFlow(wf);
  assert.ok(edges[0].sourceHandle, "precondition: the loaded error edge does carry a sourceHandle");
  assert.deepEqual(flowToWorkflow(wf, nodes, edges).edges, wf.edges);
});

// ── The same-target pair (D-T1-8): one success edge AND one error edge between
// the SAME two steps. The model permits it, so an error edge's React Flow id is
// qualified with `:error`. Until per-lane exit capacity (T3.2.2) the pair was
// unauthorable, which is why the qualifier had no regression coverage — dropping
// it left this suite fully green. These three cases pin it.

/** `a → b` twice: once as success, once as the error lane. */
const SAME_TARGET_PAIR: FlowWorkflow = {
  ...WF,
  edges: [
    { from: "a", to: "b" },
    { from: "a", to: "b", when: "error" },
  ],
};

test("same-target pair — the success and error edges get DISTINCT React Flow ids", () => {
  const { edges } = workflowToFlow(SAME_TARGET_PAIR);
  assert.deepEqual(
    edges.map((e) => e.id),
    ["a->b", "a->b:error"],
  );
});

test("same-target pair — survives an id-keyed Map (React Flow's store) with 2 entries", () => {
  // This is the assertion that actually models the loss: React Flow keys its
  // edge store by id, so two edges sharing one id collapse to one and a whole
  // lane disappears from the canvas without any error.
  const { edges } = workflowToFlow(SAME_TARGET_PAIR);
  const store = new Map(edges.map((e) => [e.id, e]));
  assert.equal(store.size, 2);
  assert.equal(store.get("a->b")?.data?.when, "success");
  assert.equal(store.get("a->b:error")?.data?.when, "error");
});

test("same-target pair — round-trips deep-equal with the error edge FIRST as well as second", () => {
  for (const order of [
    SAME_TARGET_PAIR.edges ?? [],
    [...(SAME_TARGET_PAIR.edges ?? [])].reverse(),
  ]) {
    const wf: FlowWorkflow = { ...WF, edges: order };
    const { nodes, edges } = workflowToFlow(wf);
    assert.equal(new Map(edges.map((e) => [e.id, e])).size, 2, "both lanes must reach the canvas");
    assert.deepEqual(flowToWorkflow(wf, nodes, edges).edges, order);
  }
});

test("renaming a step keeps the lane qualifier — a same-target pair stays TWO edges", () => {
  // `updateStep`'s id rewrite (via renameStepInEdges) used to rebuild every id
  // as `${source}->${target}`, dropping `:error` — so renaming `a` collapsed the
  // pair into one edge. Both id sites now mint through the shared `flowEdgeId`.
  const { edges } = workflowToFlow(SAME_TARGET_PAIR);
  const renamed = renameStepInEdges(edges, "a", "sendgrid");
  assert.deepEqual(
    renamed.map((e) => e.id),
    ["sendgrid->b", "sendgrid->b:error"],
  );
  assert.equal(new Map(renamed.map((e) => [e.id, e])).size, 2);
  // The endpoints and the lanes both moved across intact.
  assert.deepEqual(
    renamed.map((e) => `${e.source}->${e.target}:${e.data?.when}`),
    ["sendgrid->b:success", "sendgrid->b:error"],
  );
});

// ── `Step.position` / `Workflow.settings` round-trip (core rfcs/workflow.md ·
// "Amendment — 2026-07-29: authoring presentation"). The layout constants are
// COLUMN_WIDTH 240 / ROW_HEIGHT 100 / MARGIN_X 40 / MARGIN_Y 40, so a two-step
// chain computes to a = {40,40} and b = {280,40}. The fallback cases assert those
// ABSOLUTELY: they are what "the computed layout is unchanged" means, and every
// existing workflow (none of which stores a position yet) opens through them.

/** Two steps and one edge — the smallest graph with a second column. */
const CHAIN: FlowWorkflow = {
  manifestVersion: "2",
  id: "wf_chain",
  name: "chain",
  steps: [
    { id: "a", uses: { app: "@w6w/script", action: "run" } },
    { id: "b", uses: { app: "@w6w/script", action: "run" } },
  ],
  edges: [{ from: "a", to: "b" }],
};

test("workflowToFlow — a stored step.position wins over the computed slot", () => {
  const { nodes } = workflowToFlow({
    ...CHAIN,
    steps: [{ ...CHAIN.steps[0], position: { x: 123, y: 456 } }, CHAIN.steps[1]],
  });
  assert.deepEqual(nodes[0].position, { x: 123, y: 456 });
});

test("workflowToFlow — with NO positions the computed layout is exactly today's", () => {
  const { nodes } = workflowToFlow(CHAIN);
  assert.deepEqual(
    nodes.map((n) => n.position),
    [
      { x: 40, y: 40 },
      { x: 280, y: 40 },
    ],
  );
});

test("workflowToFlow — a partially positioned graph mixes stored and computed", () => {
  // `b` is positioned, `a` is not: `a` must still land on the slot it would have
  // taken with no positions at all (the computed coordinate is a function of the
  // graph, not of which neighbours happen to carry one).
  const { nodes } = workflowToFlow({
    ...CHAIN,
    steps: [CHAIN.steps[0], { ...CHAIN.steps[1], position: { x: -7, y: 900 } }],
  });
  assert.deepEqual(
    nodes.map((n) => n.position),
    [
      { x: 40, y: 40 },
      { x: -7, y: 900 },
    ],
  );
});

test("flowToWorkflow — with `settings` absent, every step gets an INTEGER position", () => {
  // Absent settings ⇒ savePosition is ON (the amendment's `?? true`, read here as
  // `!== false`). React Flow reports fractional coordinates, so the written value
  // must be rounded — an unrounded float makes a no-op render look like a change
  // to an auto-save that dedupes on the serialized payload.
  const nodes = nodesOf(WF).map((n, i) => ({ ...n, position: { x: 100.4 + i, y: 200.6 - i } }));
  const next = flowToWorkflow(WF, nodes, []);
  assert.equal(next.settings, undefined, "settings must not be invented");
  assert.deepEqual(
    next.steps.map((s) => s.position),
    [
      { x: 100, y: 201 },
      { x: 101, y: 200 },
      { x: 102, y: 199 },
    ],
  );
  for (const s of next.steps) {
    assert.ok(Number.isInteger(s.position?.x), `x not an integer: ${s.position?.x}`);
    assert.ok(Number.isInteger(s.position?.y), `y not an integer: ${s.position?.y}`);
  }
});

test("flowToWorkflow — savePosition:false writes NO position and ERASES none", () => {
  // "Not written" is not "erased": turning your own toggle off must not destroy a
  // coordinate a colleague already stored (amendment — "any values already stored
  // are left as they are, not erased"). Deep equality against the INPUT steps is
  // the only assertion that catches a delete, so it is deliberately whole-object.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [{ ...WF.steps[0], position: { x: 11, y: 22 } }, WF.steps[1], WF.steps[2]],
    settings: { savePosition: false },
  };
  const nodes = nodesOf(wf).map((n) => ({ ...n, position: { x: 999.5, y: 888.5 } }));
  const next = flowToWorkflow(wf, nodes, []);
  assert.deepEqual(next.steps, wf.steps);
});

// ── The four position invariants T3.3.1's evaluation found UNPINNED, and which
// this node (the writer that makes stored coordinates actually exist) turns from
// theoretical into live. Each one below dies to a single-rule mutant — see
// artifacts/T3.3.2-mutants.sh U7..U10.

/** A same-column fan-out: `b` and `c` are BOTH in column 1, on different rows. */
const FANOUT: FlowWorkflow = {
  ...WF,
  edges: [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
  ],
};

test("workflowToFlow — a POSITIONED sibling still consumes its row slot", () => {
  // The row counter advances for EVERY step, not only unpositioned ones. Case 11
  // ("a stored position wins") cannot see this, because there the two steps sit in
  // different columns — the escape needs two siblings in the SAME column.
  //
  // The user-visible bug if the counter skipped positioned steps: `c` would slide
  // up into `b`'s vacated row, so dragging `b` (the only positioned step) would
  // silently MOVE `c` — an edit to one node relocating another.
  const { nodes } = workflowToFlow({
    ...FANOUT,
    steps: [WF.steps[0], { ...WF.steps[1], position: { x: 900, y: 900 } }, WF.steps[2]],
  });
  assert.deepEqual(
    nodes.map((n) => n.position),
    [
      { x: 40, y: 40 },
      { x: 900, y: 900 },
      { x: 280, y: 140 },
    ],
  );
  // ...and `c` lands on that SAME slot when nothing is positioned at all: the
  // computed coordinate is a function of the graph, never of which neighbour
  // happens to carry a coordinate. (This pair is the discriminator — a mutant that
  // skips positioned steps moves only the first `c`, to y=40.)
  assert.deepEqual(workflowToFlow(FANOUT).nodes[2].position, { x: 280, y: 140 });
});

test("workflowToFlow — a GARBAGE stored position falls back to the computed slot", () => {
  // `position` arrives from a hand-editable JSON document, so a half-written or
  // wrongly-typed value must not reach React Flow: a NaN coordinate puts the node
  // at an unreachable point on the canvas with no way back but editing the JSON.
  for (const bad of [
    { x: Number.NaN, y: 5 },
    { x: 5, y: Number.NaN },
    { x: "10" as unknown as number, y: 10 },
    { x: 10 } as unknown as { x: number; y: number },
    null as unknown as { x: number; y: number },
  ]) {
    const { nodes } = workflowToFlow({
      ...CHAIN,
      steps: [{ ...CHAIN.steps[0], position: bad }, CHAIN.steps[1]],
    });
    assert.deepEqual(nodes[0].position, { x: 40, y: 40 }, `bad position leaked: ${String(bad)}`);
  }
});

test("flowToWorkflow — a non-finite node coordinate is NEVER written to the document", () => {
  // The worse half of the same guard: this one corrupts PERSISTED data. A step whose
  // node carries a NaN must be emitted untouched — not stamped with `{x: null}` by
  // the JSON round-trip that follows.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [{ ...WF.steps[0], position: { x: 11, y: 22 } }, WF.steps[1], WF.steps[2]],
  };
  const nodes = nodesOf(wf).map((n) => ({ ...n, position: { x: Number.NaN, y: 5 } }));
  const next = flowToWorkflow(wf, nodes, []);
  assert.deepEqual(next.steps, wf.steps);
  // Belt and braces on what the host would actually persist.
  assert.doesNotMatch(JSON.stringify(next.steps), /null/);
});

test("workflowToFlow — node.position is a FRESH object a drag cannot write back through", () => {
  // React Flow OWNS `node.position` and mutates it IN PLACE while a drag is in
  // flight — which is exactly what `onNodeDragStop` then reads. If the node aliased
  // the step's stored object, the drag would edit the definition behind the
  // conversion's back, and `flowToWorkflow`'s savePosition:false arm ("write none,
  // erase none") could not hold. Aliasing was harmless until this node shipped a
  // writer; it is load-bearing now.
  const stored = { x: 123, y: 456 };
  const wf: FlowWorkflow = { ...CHAIN, steps: [{ ...CHAIN.steps[0], position: stored }] };
  const { nodes } = workflowToFlow(wf);
  assert.notStrictEqual(nodes[0].position, stored, "the node aliased the step's own object");
  nodes[0].position.x = 999; // ← what a drag does
  assert.deepEqual(stored, { x: 123, y: 456 }, "a drag reached back into the definition");
  const next = flowToWorkflow(wf, nodes, []);
  assert.deepEqual(next.steps[0].position, { x: 999, y: 456 });
  assert.notStrictEqual(next.steps[0].position, nodes[0].position, "emitted an aliased coordinate");
  assert.notStrictEqual(next.steps[0].position, stored);
});

// ── ADDENDUM A: `computeLayers` must TERMINATE on a cyclic graph ─────────────
//
// The layering iterated `while (changed)` to a fixpoint on the stated assumption
// "for a DAG this converges". The engine rejects cycles at plan time — but this
// editor lets you DRAW one, and `workflowToFlow` calls the layering on open, so a
// cyclic workflow froze the tab on load (and would have frozen it mid-edit once
// an auto-layout button called the same code from a click).

/** `a → b → c → a`: the cycle the editor lets an author draw. */
const CYCLIC: FlowWorkflow = {
  ...WF,
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" },
  ],
};

/** A one-step cycle — the degenerate case, drawable by dropping an edge on itself. */
const SELF_LOOP: FlowWorkflow = { ...WF, edges: [{ from: "a", to: "a" }] };

test("workflowToFlow TERMINATES on a cyclic graph (hard timeout, out of process)", () => {
  // Asserted in a CHILD process under a wall-clock timeout, because the loop this
  // pins is *synchronous*: node:test's own `timeout` option cannot interrupt a
  // spinning `while`, so a regression here would hang this suite instead of
  // failing it. The child prints TERMINATED only if workflowToFlow returns.
  const here = dirname(fileURLToPath(import.meta.url));
  const modUrl = pathToFileURL(join(here, "..", "flow-utils.ts")).href;
  const probe = [
    `const { workflowToFlow } = await import(${JSON.stringify(modUrl)});`,
    `const { nodes } = workflowToFlow(${JSON.stringify(CYCLIC)});`,
    "if (nodes.length !== 3) throw new Error(`node count ${nodes.length}`);",
    'process.stdout.write("TERMINATED");',
  ].join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(
    r.signal,
    null,
    `child killed by ${r.signal} — the layering did not terminate on a cycle`,
  );
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  assert.equal(r.stdout.trim(), "TERMINATED");
});

test("a cyclic graph still lays out USABLY — on canvas, no two steps on one point", () => {
  // Terminating is not enough: the author has to be able to SEE the loop they
  // drew in order to delete an edge, so a cycle must not push nodes to an
  // unreachable coordinate and must not stack them on top of each other. Runaway
  // columns are clamped to the last real one (3 steps ⇒ columns 0..2 ⇒ x ≤ 520).
  for (const wf of [CYCLIC, SELF_LOOP]) {
    const { nodes } = workflowToFlow(wf);
    assert.equal(nodes.length, 3);
    for (const n of nodes) {
      assert.ok(Number.isFinite(n.position.x), `${n.id}: x is ${n.position.x}`);
      assert.ok(Number.isFinite(n.position.y), `${n.id}: y is ${n.position.y}`);
      assert.ok(n.position.x >= 40 && n.position.x <= 40 + 2 * 240, `${n.id}: x ${n.position.x}`);
      assert.ok(n.position.y >= 40 && n.position.y <= 40 + 2 * 100, `${n.id}: y ${n.position.y}`);
    }
    assert.equal(
      new Set(nodes.map((n) => `${n.position.x},${n.position.y}`)).size,
      3,
      "two steps landed on the same point",
    );
  }
});

test("an edge from an UNDECLARED step adds a column and still converges", () => {
  // The counterexample to "a DAG's layers never exceed steps.length - 1" (the claim
  // the source comment used to make, corrected at this commit): `layer.get(pred) ?? 0`
  // gives an undeclared `from` a phantom layer 0, so it contributes +1 to the chain
  // it feeds. Two steps ⇒ lastColumn 1, yet `b` legitimately lands in column 2.
  //
  // The CODE is right: this converges (`changed === false` before the bound runs
  // out), so the cycle clamp never fires and the extra column is simply rendered.
  // Only the comment was wrong — and a future reader "restoring" the invariant by
  // clamping every DAG to steps.length - 1 would break this graph.
  const { nodes } = workflowToFlow({
    ...CHAIN,
    edges: [
      { from: "ghost", to: "a" },
      { from: "a", to: "b" },
    ],
  });
  assert.deepEqual(
    nodes.map((n) => [n.id, n.position]),
    [
      ["a", { x: 280, y: 40 }],
      ["b", { x: 520, y: 40 }],
    ],
  );
});

// ── `settings.viewport` — the pure viewport writer (T3.3.2) ──────────────────
//
// `withViewport` is where the pan/zoom writer's two interesting decisions live,
// and both exist to protect the host's auto-save (a trailing debounce that dedupes
// on the SERIALIZED payload) from a write storm:
//   · rounding — a trackpad reports a long float, so two visually identical
//     viewports would serialize differently on every idle gesture;
//   · the SAME-REFERENCE return — the component emits only when the reference
//     changes, so a pan that lands back where it started emits nothing.
// The identity assertions below are therefore `strictEqual`, never `deepEqual`: a
// no-op write returns an object that IS deep-equal to the input — only the
// reference distinguishes "emit" from "don't", so deep equality cannot see the
// short-circuit disappear.

test("withViewport — rounds x/y to integers and zoom to 3 decimal places", () => {
  const next = withViewport(WF, { x: 12.7, y: -3.2, zoom: 1.23456 });
  assert.deepEqual(next.settings?.viewport, { x: 13, y: -3, zoom: 1.235 });
  const vp = next.settings?.viewport;
  assert.ok(Number.isInteger(vp?.x), `x not an integer: ${vp?.x}`);
  assert.ok(Number.isInteger(vp?.y), `y not an integer: ${vp?.y}`);
});

test("withViewport — SAME REFERENCE when settings.savePosition is false", () => {
  // Omitted ⇒ ON, so only an explicit `false` may suppress the write. Identity,
  // not deep equality: the caller's "emit or not" decision reads the reference.
  const wf: FlowWorkflow = { ...WF, settings: { savePosition: false } };
  assert.strictEqual(withViewport(wf, { x: 12.7, y: -3.2, zoom: 1.23456 }), wf);
  // …and the omitted flag really is ON — the same input DOES write here.
  assert.notStrictEqual(withViewport(WF, { x: 12.7, y: -3.2, zoom: 1.23456 }), WF);
});

test("withViewport — SAME REFERENCE when the rounded viewport equals the stored one", () => {
  // The fed value is not equal to the stored one, but ROUNDS to it: this is the
  // idle-jitter case that would otherwise emit a change (and a network write)
  // every time the author's hand brushed the trackpad.
  const wf: FlowWorkflow = { ...WF, settings: { viewport: { x: 13, y: -3, zoom: 1.235 } } };
  assert.strictEqual(withViewport(wf, { x: 12.7, y: -3.2, zoom: 1.23456 }), wf);
  // A genuinely different viewport is still written.
  assert.notStrictEqual(withViewport(wf, { x: 14, y: -3, zoom: 1.235 }), wf);
});

test("withViewport — writes ONLY settings.viewport: siblings and the graph are untouched", () => {
  // `settings` is spread, not replaced. The mirror image of studio's `writeSetting`
  // deleting a defaulted key without disturbing `viewport`: a viewport write must
  // not be collateral damage for `autoSave` / `savePosition` either.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [{ ...WF.steps[0], position: { x: 11, y: 22 } }, WF.steps[1], WF.steps[2]],
    settings: { autoSave: false, savePosition: true },
  };
  const next = withViewport(wf, { x: 5, y: 6, zoom: 2 });
  assert.deepEqual(next.settings, {
    autoSave: false,
    savePosition: true,
    viewport: { x: 5, y: 6, zoom: 2 },
  });
  assert.strictEqual(next.steps, wf.steps, "steps must be carried across untouched");
  assert.strictEqual(next.edges, wf.edges, "edges must be carried across untouched");
  // With no `settings` at all, exactly one key is invented.
  assert.deepEqual(withViewport(WF, { x: 5, y: 6, zoom: 2 }).settings, {
    viewport: { x: 5, y: 6, zoom: 2 },
  });
});

test("withViewport — a hand-edited non-object `settings` is never spread into indexed keys", () => {
  // `settings` is TYPED as an object, but it comes out of `JSON.parse` and studio's
  // `</>` raw-JSON modal lets an author write `"settings": "hello"`. Spreading that
  // yields `{"0":"h","1":"e",…, viewport}` on a PAN, and auto-save (a trailing
  // debounce) re-persists it without a click. Same guard, same predicate, as
  // studio's `writeSetting`: an unusable value reads as "no settings", so the write
  // produces a fresh `{ viewport }` — the viewport is stored, never dropped.
  for (const bad of ["hello", null, ["h", "i"], 42]) {
    const wf = { ...WF, settings: bad } as unknown as FlowWorkflow;
    assert.deepEqual(
      withViewport(wf, { x: 5, y: 6, zoom: 2 }).settings,
      { viewport: { x: 5, y: 6, zoom: 2 } },
      `a non-object settings leaked into the write: ${JSON.stringify(bad)}`,
    );
  }
});

test("withViewport — a y-ONLY or zoom-ONLY change is a change, never a no-op", () => {
  // The no-op comparison must weigh all three terms. Drop the `y` term and a purely
  // vertical pan looks "unchanged"; drop the `zoom` term and a pinch-zoom does — in
  // both cases the camera the author left is silently NOT persisted, and the zoom is
  // what the intake asked for by name ("latest zoom info"). `x` is deliberately held
  // EQUAL in each case, so only the term under test can carry the assertion.
  const wf: FlowWorkflow = { ...WF, settings: { viewport: { x: 13, y: -3, zoom: 1.235 } } };
  assert.deepEqual(
    withViewport(wf, { x: 13, y: 40, zoom: 1.235 }).settings?.viewport,
    { x: 13, y: 40, zoom: 1.235 },
    "a y-ONLY pan was swallowed as a no-op: the `y` term is missing from the comparison",
  );
  assert.deepEqual(
    withViewport(wf, { x: 13, y: -3, zoom: 2.5 }).settings?.viewport,
    { x: 13, y: -3, zoom: 2.5 },
    "a zoom-ONLY change was swallowed as a no-op: the `zoom` term is missing",
  );
});

test("a non-finite viewport is neither stored nor restored", () => {
  // `settings.viewport` is hand-editable (studio's `</>` raw-JSON modal), and it is
  // handed straight to React Flow's `defaultViewport` as the initial transform — a
  // NaN there blanks the canvas with no way back but editing the JSON again. So
  // both directions check all three components, exactly as `storedPosition` checks
  // its two.
  for (const bad of [
    { x: Number.NaN, y: 0, zoom: 1 },
    { x: 0, y: Number.NaN, zoom: 1 },
    { x: 0, y: 0, zoom: Number.NaN },
    { x: 0, y: 0, zoom: null as unknown as number },
  ]) {
    assert.strictEqual(withViewport(WF, bad), WF, `stored a bad viewport: ${JSON.stringify(bad)}`);
    assert.equal(
      storedViewport({ ...WF, settings: { viewport: bad } }),
      undefined,
      `restored a bad viewport: ${JSON.stringify(bad)}`,
    );
  }
  // A usable one comes back as a FRESH object (React Flow owns what it is given).
  const wf: FlowWorkflow = { ...WF, settings: { viewport: { x: 1, y: 2, zoom: 0.5 } } };
  assert.deepEqual(storedViewport(wf), { x: 1, y: 2, zoom: 0.5 });
  assert.notStrictEqual(storedViewport(wf), wf.settings?.viewport);
  assert.equal(storedViewport(WF), undefined, "no settings ⇒ no stored viewport");
});

// ── `relayoutNodes` — the auto-layout control's whole implementation (T3.3.3) ──
//
// The button re-flows what is CURRENTLY on the canvas, so it takes React Flow's
// (nodes, edges) rather than a FlowWorkflow. The load-bearing constraint is
// anti-duplication: it shares `computeLayers` AND the placement arithmetic
// (`slotPosition`) with `workflowToFlow`, because an "arrange" that disagreed with
// "how it opened" is the one thing an author would notice immediately. Case 28 is
// that assertion — a second layering implementation fails it.

test("relayoutNodes — OVERRIDES whatever positions the nodes currently have", () => {
  // The whole point of the button: a stored coordinate wins on first open, and
  // loses here. Absolute expected values, so a changed constant is a failure.
  const { nodes, edges } = workflowToFlow({
    ...CHAIN,
    steps: [
      { ...CHAIN.steps[0], position: { x: -4000, y: 7777 } },
      { ...CHAIN.steps[1], position: { x: 1, y: 2 } },
    ],
  });
  assert.deepEqual(
    nodes.map((n) => n.position),
    [
      { x: -4000, y: 7777 },
      { x: 1, y: 2 },
    ],
    "precondition: the absurd stored positions reached the canvas",
  );
  const out = relayoutNodes(nodes, edges);
  assert.deepEqual(
    out.map((n) => [n.id, n.position]),
    [
      ["a", { x: 40, y: 40 }],
      ["b", { x: 280, y: 40 }],
    ],
  );
});

test("relayoutNodes — nothing is lost: same length, same ids, same `data` REFERENCES", () => {
  // React Flow compares by reference, so the array and every node must be new —
  // but `data` must be the SAME object, or every card re-derives its metadata (and
  // `data.step` is what `flowToWorkflow` reads the step back off).
  const { nodes, edges } = workflowToFlow(FANOUT);
  const out = relayoutNodes(nodes, edges);
  assert.equal(out.length, nodes.length);
  assert.deepEqual(
    out.map((n) => n.id),
    nodes.map((n) => n.id),
  );
  assert.notStrictEqual(out, nodes, "returned the same array — React Flow won't re-render");
  for (const [i, n] of out.entries()) {
    assert.notStrictEqual(n, nodes[i], `node ${n.id} was not a new object`);
    assert.strictEqual(n.data, nodes[i].data, `node ${n.id} lost its data reference`);
    assert.equal(n.type, nodes[i].type, `node ${n.id} lost its type`);
  }
  // A node with NO outgoing edge (`b`, `c` in the fan-out) is still returned —
  // and the fan-out's two same-column siblings keep distinct row slots.
  assert.deepEqual(
    out.map((n) => n.position),
    [
      { x: 40, y: 40 },
      { x: 280, y: 40 },
      { x: 280, y: 140 },
    ],
  );
});

test("relayoutNodes — AGREES WITH FIRST OPEN for a workflow with no stored positions", () => {
  // The anti-duplication assertion. `workflowToFlow` places an unpositioned step at
  // its computed slot; `relayoutNodes` places EVERY node there. With nothing stored
  // the two must be indistinguishable — a second copy of the layering or of the
  // arithmetic drifts here first.
  for (const wf of [CHAIN, WF, FANOUT, CYCLIC, SELF_LOOP]) {
    const { nodes, edges } = workflowToFlow(wf);
    assert.deepEqual(
      relayoutNodes(nodes, edges).map((n) => n.position),
      nodes.map((n) => n.position),
      `auto-layout disagreed with first open for ${wf.id}`,
    );
  }
  // …and a workflow with NO declared edges agrees too: `workflowToFlow` lays the
  // steps out as an implicit chain, and the flow edges it derived carry that shape
  // into the re-flow.
  const implicit: FlowWorkflow = { ...WF, edges: undefined };
  const { nodes, edges } = workflowToFlow(implicit);
  assert.deepEqual(
    relayoutNodes(nodes, edges).map((n) => n.position),
    [
      { x: 40, y: 40 },
      { x: 280, y: 40 },
      { x: 520, y: 40 },
    ],
  );
});

test("relayoutNodes — a re-flow round-trips into the document as INTEGER positions", () => {
  // The persistence half of the button: `setNodes(next)` + `emitChange(next, edges)`
  // means these coordinates go straight into `flowToWorkflow`. Nothing new is needed
  // for it to persist — this pins that the pairing actually works end to end.
  const wf: FlowWorkflow = {
    ...FANOUT,
    steps: [{ ...WF.steps[0], position: { x: 901, y: 902 } }, WF.steps[1], WF.steps[2]],
  };
  const { nodes, edges } = workflowToFlow(wf);
  const next = flowToWorkflow(wf, relayoutNodes(nodes, edges), edges);
  assert.deepEqual(
    next.steps.map((s) => [s.id, s.position]),
    [
      ["a", { x: 40, y: 40 }],
      ["b", { x: 280, y: 40 }],
      ["c", { x: 280, y: 140 }],
    ],
  );
  // The edges survive the round-trip untouched — a re-flow moves nodes, nothing else.
  assert.deepEqual(next.edges, FANOUT.edges);
});

// ── ADDENDUM Y: the refusal must not assert a cause it has not determined ─────
//
// `idClashMessage` hard-coded *"because a step id ending in ':error' collides with
// the error-lane marker. Rename that step"*. The guard has a second, equally real
// trigger — a step id containing `->`, the separator itself — and on that route the
// author was told to rename a step that does not exist. It moved into flow-utils.ts
// (beside `flowEdgeId`, whose non-injectivity IS the clash) so `node --test` can
// reach it; in the .tsx it was coverable only by inspection.

test("idClashMessage — a collision from an embedded `->` does NOT blame a `:error` id", () => {
  // The T3.2.4 evaluator's case: steps `a`, `b->c`, `a->b`, `c` with an edge
  // `a → "b->c"` (minted `a->b->c`). Drawing `"a->b" → c` mints the same string and
  // is correctly refused — yet NO step id ends in `:error`.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [
      { id: "a", uses: { app: "@w6w/script", action: "run" } },
      { id: "b->c", uses: { app: "@w6w/script", action: "run" } },
      { id: "a->b", uses: { app: "@w6w/script", action: "run" } },
      { id: "c", uses: { app: "@w6w/script", action: "run" } },
    ],
    edges: [{ from: "a", to: "b->c" }],
  };
  const { nodes, edges } = workflowToFlow(wf);
  const conflict = connectConflict("a->b", "c", nodes, edges);
  assert.equal(conflict, "a->b->c", "precondition: the draw is refused for a taken id");
  // Built exactly as the editor's `clashInvolvedIds` builds it: the drawn edge's
  // endpoints plus the sitting edge's.
  const sitting = edges.find((e) => e.id === conflict);
  const msg = idClashMessage("Can’t draw that edge", conflict, [
    "a->b",
    "c",
    sitting?.source,
    sitting?.target,
  ]);
  assert.doesNotMatch(msg, /:error/, "blamed the error-lane marker on a `->` collision");
  assert.doesNotMatch(msg, /ending in/, "asserted the `:error` cause it had not determined");
  // It still names the taken id AND a step that really is ambiguous, so the advice
  // is actionable: renaming it re-mints that edge's id.
  assert.match(msg, /a->b->c/);
  assert.match(msg, /rename the step “a->b”/);
  assert.match(msg, /containing “->”/);
});

test("idClashMessage — the `:error` route still names the error-lane marker", () => {
  // The cause the old wording asserted unconditionally is still named when it is
  // the real one: steps `a`, `b`, `b:error` with `a → b` on the error lane already
  // holding `a->b:error`, then drawing `a → "b:error"` on the success lane.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [
      { id: "a", uses: { app: "@w6w/script", action: "run" } },
      { id: "b", uses: { app: "@w6w/script", action: "run" } },
      { id: "b:error", uses: { app: "@w6w/script", action: "run" } },
    ],
    edges: [{ from: "a", to: "b", when: "error" }],
  };
  const { nodes, edges } = workflowToFlow(wf);
  const conflict = connectConflict("a", "b:error", nodes, edges);
  assert.equal(conflict, "a->b:error", "precondition: the draw is refused for a taken id");
  const sitting = edges.find((e) => e.id === conflict);
  const msg = idClashMessage("Can’t draw that edge", conflict, [
    "a",
    "b:error",
    sitting?.source,
    sitting?.target,
  ]);
  assert.match(msg, /ending in “:error”/);
  assert.match(msg, /rename the step “b:error”/);
  // No cause at all when nothing involved is ambiguous — the message must never
  // invent one (that arm is reachable only from an already-corrupt edge set).
  const generic = idClashMessage("Can’t switch this edge", "x->y", ["x", "y", "x", "y"]);
  assert.doesNotMatch(generic, /ending in/);
  assert.doesNotMatch(generic, /containing “->”/);
  assert.match(generic, /Rename one of the steps it connects/);
});

// ── ROUND 2: the cause follows the LANE PAIR, not a first-match scan ──────────
//
// The two cases above cover the two routes ADDENDUM Y named; both routes ALSO come
// out right under a first-match scan over the involved ids, which is why the suite
// was green on a message that is false on the two routes below. Both are driven
// through the real `workflowToFlow` + `connectConflict`, exactly as the cases above.

test("idClashMessage — mixed lanes name the success edge's `:error` target, not the shared source", () => {
  // The evaluator's R9, the worst case: the first-match scan blames `p->q`, which is
  // the SOURCE OF BOTH EDGES — renaming it re-mints both and the edge is still
  // refused, so the author is sent to rename the one step that cannot help.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [
      { id: "p->q", uses: { app: "@w6w/script", action: "run" } },
      { id: "b", uses: { app: "@w6w/script", action: "run" } },
      { id: "b:error", uses: { app: "@w6w/script", action: "run" } },
    ],
    edges: [{ from: "p->q", to: "b", when: "error" }],
  };
  const { nodes, edges } = workflowToFlow(wf);
  const conflict = connectConflict("p->q", "b:error", nodes, edges);
  assert.equal(conflict, "p->q->b:error", "precondition: the draw is refused for a taken id");
  const sitting = edges.find((e) => e.id === conflict);
  const msg = idClashMessage("Can’t draw that edge", conflict, [
    "p->q",
    "b:error",
    sitting?.source,
    sitting?.target,
  ]);
  assert.match(msg, /rename the step “b:error”/);
  assert.match(msg, /ending in “:error”/);
  assert.doesNotMatch(
    msg,
    /“p->q”/,
    "blamed the source shared by BOTH edges — renaming it cannot help",
  );
  // The advice is the one that works, by the real rule: renaming `b:error` frees the
  // id, renaming the shared source `p->q` does not.
  const renamed = workflowToFlow({
    ...wf,
    steps: wf.steps.map((s) => (s.id === "b:error" ? { ...s, id: "berr" } : s)),
  });
  assert.equal(connectConflict("p->q", "berr", renamed.nodes, renamed.edges), null);
  const sourceRenamed = workflowToFlow({
    ...wf,
    steps: wf.steps.map((s) => (s.id === "p->q" ? { ...s, id: "w" } : s)),
    edges: [{ from: "w", to: "b", when: "error" }],
  });
  assert.equal(
    connectConflict("w", "b:error", sourceRenamed.nodes, sourceRenamed.edges),
    "w->b:error",
    "renaming the shared source leaves the edge refused — so it must never be the advice",
  );
});

test("idClashMessage — the same lane on both edges is never blamed on the error-lane marker", () => {
  // The evaluator's R7, the mirror: steps `x:error`, `y->z`, `x:error->y`, `z` with
  // BOTH edges on the success lane. An id ending in `:error` is involved, but no
  // error lane is — the cause can only be the embedded separator.
  const wf: FlowWorkflow = {
    ...WF,
    steps: [
      { id: "x:error", uses: { app: "@w6w/script", action: "run" } },
      { id: "y->z", uses: { app: "@w6w/script", action: "run" } },
      { id: "x:error->y", uses: { app: "@w6w/script", action: "run" } },
      { id: "z", uses: { app: "@w6w/script", action: "run" } },
    ],
    edges: [{ from: "x:error->y", to: "z" }],
  };
  const { nodes, edges } = workflowToFlow(wf);
  const conflict = connectConflict("x:error", "y->z", nodes, edges);
  assert.equal(conflict, "x:error->y->z", "precondition: the draw is refused for a taken id");
  const sitting = edges.find((e) => e.id === conflict);
  assert.equal(
    edgeLane(sitting as Edge),
    "success",
    "precondition: the sitting edge is success-lane",
  );
  const msg = idClashMessage("Can’t draw that edge", conflict, [
    "x:error",
    "y->z",
    sitting?.source,
    sitting?.target,
  ]);
  assert.doesNotMatch(msg, /ending in “:error”/, "blamed the error-lane marker with no error lane");
  assert.match(msg, /containing “->”/);
  assert.match(msg, /rename the step “y->z”/);
  // And that advice resolves it, by the real rule.
  const renamed = workflowToFlow({
    ...wf,
    steps: wf.steps.map((s) => (s.id === "y->z" ? { ...s, id: "yz" } : s)),
  });
  assert.equal(connectConflict("x:error", "yz", renamed.nodes, renamed.edges), null);
});

// ── `stepToJson` / `paramsToJson` — the ONE code-view serializer pair (T2.1.1) ──
//
// The reported bug: opening a manual trigger's `<>` printed only
// `{"fields":[…]}` — `with.fields` is that trigger's one declared param, and
// every host's `<>` button stringified `step.with` directly. `stepToJson` is the
// full step (core rfcs/workflow.md — "A step **is** an Invocation");
// `paramsToJson` is the params alone, exactly what `<>` showed before.

/** The reported bug's own step: a manual trigger whose only declared param is
 * `with.fields`. */
const TRIGGER_STEP: FlowStep = {
  id: "trigger_1",
  uses: { app: "@w6w/trigger", action: "manual" },
  with: { fields: [{ key: "email", type: "string" }] },
};

test("stepToJson — the reported bug: a manual trigger's full-step view is NOT just its params", () => {
  const parsed = JSON.parse(stepToJson(TRIGGER_STEP));
  assert.deepEqual(Object.keys(parsed).sort(), ["id", "uses", "with"]);
  assert.deepEqual(parsed.uses, { app: "@w6w/trigger", action: "manual" });
  assert.deepEqual(parsed.with, { fields: [{ key: "email", type: "string" }] });
  assert.equal(parsed.id, "trigger_1");
});

test("stepToJson and paramsToJson differ on the SAME input: uses is in one, not the other", () => {
  const full = JSON.parse(stepToJson(TRIGGER_STEP));
  const params = JSON.parse(paramsToJson(TRIGGER_STEP));
  assert.ok("uses" in full, "the full-step view lost `uses`");
  assert.ok(!("uses" in params), "the params-only view leaked `uses`");
  assert.deepEqual(params, { fields: [{ key: "email", type: "string" }] });
});

test("stepToJson accepts the add-step hosts' id-less BuiltStep shape — no cast, no fabricated id", () => {
  // Structurally what `StepBuilderModal.tsx`'s `buildStep()` returns before the
  // step has ever joined the graph: no `id` key at all.
  const built: StepLike = { uses: { app: "@w6w/script", action: "run" }, with: { code: "1" } };
  const parsed = JSON.parse(stepToJson(built));
  assert.ok(!("id" in parsed), "an id was fabricated for a step that has none yet");
  assert.deepEqual(Object.keys(parsed).sort(), ["uses", "with"]);
});

test("stepToJson never adds a derived `kind` field, and never special-cases a trigger", () => {
  for (const step of [
    TRIGGER_STEP,
    { id: "s", uses: { app: "@w6w/script", action: "run" }, with: { code: "1" } },
  ]) {
    assert.doesNotMatch(stepToJson(step), /"kind"/, `derived kind leaked for ${step.id}`);
  }
});

test("stepToJson carries retry/onError/notes/ports/position exactly when set, omitted when not", () => {
  const bare = JSON.parse(stepToJson(TRIGGER_STEP));
  for (const k of ["retry", "onError", "notes", "ports", "position"]) {
    assert.ok(!(k in bare), `${k} was invented on a step that never set it`);
  }
  const full: FlowStep = {
    ...TRIGGER_STEP,
    retry: { maxAttempts: 3 },
    onError: "continue",
    notes: "hand-authored",
    ports: { in: 1, out: 2 },
    position: { x: 1, y: 2 },
  };
  const parsed = JSON.parse(stepToJson(full));
  assert.deepEqual(parsed.retry, { maxAttempts: 3 });
  assert.equal(parsed.onError, "continue");
  assert.equal(parsed.notes, "hand-authored");
  assert.deepEqual(parsed.ports, { in: 1, out: 2 });
  assert.deepEqual(parsed.position, { x: 1, y: 2 });
});

test("paramsToJson — an absent `with` renders as an empty object, never null or undefined", () => {
  const noWith: StepLike = { uses: { app: "@w6w/script", action: "run" } };
  assert.equal(paramsToJson(noWith), "{}");
});
