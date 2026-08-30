// Run: node --test src/__tests__/flow-connect.test.ts   (Node 24, type-stripped)
//
// The exit-port capacity rule. The trap this suite exists to pin: `applyConnect`
// used to free the source's exit port lane-BLINDLY, so the moment a second wire
// was dragged out of a step the first one was deleted — which made a
// `send → (error) → fallback` shape literally unauthorable. Capacity is now
// per-lane at the SOURCE and deliberately lane-blind at the TARGET; both halves
// are asserted here, because "make it symmetric" is the plausible cleanup that
// would let a `ports.in: 1` node silently accept two inbound edges.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Edge } from "@xyflow/react";
import {
  applyConnect,
  canConnect,
  connectConflict,
  edgeLane,
  edgeWhenConflict,
  setEdgeWhen,
} from "../flow-connect.ts";
import {
  ERROR_SOURCE_HANDLE,
  type NodePorts,
  laneForSourceHandle,
  sourceHandleForLane,
} from "../flow-types.ts";
import { type StepNode, flowEdgeId } from "../flow-utils.ts";

/** A canvas node for step `id`, optionally with persisted per-step ports. */
function node(id: string, ports?: NodePorts): StepNode {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      step: { id, uses: { app: "@w6w/script", action: "run" }, ...(ports ? { ports } : {}) },
      isInternal: false,
    },
  };
}

/** An edge as the canvas holds it, carrying an explicit lane in `data`. */
function rf(source: string, target: string, when: "success" | "error"): Edge {
  const id = when === "error" ? `${source}->${target}:error` : `${source}->${target}`;
  return { id, source, target, data: { when } };
}

/**
 * A LEGACY edge: authored before the lane was stamped (or synthesised by React
 * Flow), so it carries no `data` at all. Omitted ⇒ success.
 */
function legacy(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target };
}

/** The `source → target` pairs of an edge set, for readable assertions. */
function pairs(edges: Edge[]): string[] {
  return edges.map((e) => `${e.source}->${e.target}:${edgeLane(e)}`);
}

const ABCD = [node("a"), node("b"), node("c"), node("d")];

test("success lane is still single-slot — a second success edge RE-POINTS the wire", () => {
  // The deliberate `out: 1` UX, unchanged by this node. Asserted for BOTH
  // spellings of a success edge: the explicit `data.when` stamp and a legacy
  // `data`-less edge, which must read as success (omitted ⇒ success).
  for (const existing of [rf("a", "c", "success"), legacy("a", "c")]) {
    const next = applyConnect("a", "b", ABCD, [existing]);
    assert.ok(next, "the connection must be allowed");
    assert.deepEqual(pairs(next), ["a->b:success"]);
    assert.equal(next.filter((e) => e.source === "a").length, 1);
  }
});

test("error lane does NOT compete with success — a step holds one of each", () => {
  const next = applyConnect("a", "b", ABCD, [rf("a", "c", "success")], "error");
  assert.ok(next, "the connection must be allowed");
  // This is the whole point of the node: a->c survives the error drag.
  assert.deepEqual(pairs(next), ["a->c:success", "a->b:error"]);
  assert.equal(next.filter((e) => e.source === "a").length, 2);
  assert.equal(next.find((e) => e.target === "b")?.id, "a->b:error");
});

test("error lane is single-slot too — a second error edge re-points it, success untouched", () => {
  const next = applyConnect(
    "a",
    "d",
    ABCD,
    [rf("a", "c", "success"), rf("a", "b", "error")],
    "error",
  );
  assert.ok(next, "the connection must be allowed");
  assert.deepEqual(pairs(next), ["a->c:success", "a->d:error"]);
});

test("target entry capacity stays LANE-BLIND — a ports.in:1 step keeps one inbound", () => {
  // A lane-partitioned target rule (the plausible "symmetry" cleanup) would let
  // this 1-in node hold two inbound edges at once. `ports.in` alone governs it.
  const nodes = [node("a"), node("b"), node("t", { in: 1, out: 1 })];
  const next = applyConnect("b", "t", nodes, [rf("a", "t", "success")], "error");
  assert.ok(next, "the connection must be allowed");
  assert.deepEqual(pairs(next), ["b->t:error"]);
  assert.equal(next.filter((e) => e.target === "t").length, 1);
});

test("a multi-in target still fans in — ports.in:10 keeps a success AND an error inbound", () => {
  const nodes = [node("a"), node("b"), node("t", { in: 10, out: 1 })];
  const next = applyConnect("b", "t", nodes, [rf("a", "t", "success")], "error");
  assert.ok(next, "the connection must be allowed");
  assert.deepEqual(pairs(next), ["a->t:success", "b->t:error"]);
});

test("canConnect is unchanged — a duplicate pair and a self-loop are still rejected", () => {
  // D-T1-8 lets the MODEL hold a success and an error edge to the same target;
  // the v1 EDITOR declines to author that pair, and this pins the decision.
  assert.equal(canConnect("a", "b", ABCD, [rf("a", "b", "success")]), false);
  // ...and the check is lane-blind, so the error drag onto the same pair is
  // refused as well — `applyConnect` returns null rather than an edge set.
  assert.equal(applyConnect("a", "b", ABCD, [rf("a", "b", "success")], "error"), null);
  // BOTH DIRECTIONS. Making the duplicate check lane-aware left this suite fully
  // green while admitting a SUCCESS `a→b` on top of an existing ERROR `a→b` —
  // exactly the pair D-T1-8 permits in the model and v1 declines to author. This
  // node is the first that lets a user create an error edge, so the direction
  // that used to be unreachable is now the one that matters.
  assert.equal(canConnect("a", "b", ABCD, [rf("a", "b", "error")]), false);
  assert.equal(canConnect("a", "a", ABCD, []), false);
  assert.equal(canConnect("a", "b", ABCD, []), true);
});

// ── setEdgeWhen: re-laning an EXISTING edge from the edge-level control. The
// trap: it is not a one-line `data.when` write. The destination lane has the same
// per-lane exit capacity `applyConnect` honours, the visuals must be re-stamped
// from the shared `edgeVisuals` (a stale error class is the visible symptom), the
// id encodes the lane and must be re-minted, and the result must be a NEW array
// or React Flow's identity-compared state handle will not re-render.

test("setEdgeWhen marks a success edge as 'error' — visuals follow, the sibling survives", () => {
  // Two success edges out of `a`: a loaded definition can carry that (capacity is
  // an editor rule, not a model rule), and it is what makes "the other one
  // survives" assertable.
  const next = setEdgeWhen(
    [rf("a", "b", "success"), rf("a", "c", "success")],
    "a->b",
    "error",
    ABCD,
  );
  assert.ok(next, "the re-lane must be allowed");
  assert.deepEqual(pairs(next), ["a->b:error", "a->c:success"]);
  const me = next.find((e) => e.target === "b");
  assert.equal(me?.data?.when, "error");
  assert.match(String(me?.className ?? ""), /w6w-edge-error/);
  assert.ok(me?.label, "an error edge is labelled on the canvas");
  // The id encodes the lane, so it is re-minted through `flowEdgeId`.
  assert.equal(me?.id, "a->b:error");

  // ...and choosing the lane the edge is ALREADY on must not evict the sibling
  // either. Without that guard the eviction rule treats the sibling as competing
  // for the slot this edge already occupies, so clicking the already-active
  // "Success" silently DELETES a wire — observed in the browser probe.
  const same = setEdgeWhen(
    [rf("a", "b", "success"), rf("a", "c", "success")],
    "a->b",
    "success",
    ABCD,
  );
  assert.ok(same, "a same-lane call is allowed");
  assert.deepEqual(pairs(same), ["a->b:success", "a->c:success"]);
});

test("setEdgeWhen into a FULL lane evicts — [a→b error, a→c success], a→c to error", () => {
  const next = setEdgeWhen([rf("a", "b", "error"), rf("a", "c", "success")], "a->c", "error", ABCD);
  assert.ok(next, "the re-lane must be allowed");
  assert.deepEqual(pairs(next), ["a->c:error"]);
  assert.equal(next.filter((e) => e.source === "a" && edgeLane(e) === "error").length, 1);
  assert.equal(
    next.some((e) => e.target === "b"),
    false,
    "the previous error edge was evicted",
  );
});

test("setEdgeWhen back to 'success' clears the visuals AND evicts the success incumbent", () => {
  const next = setEdgeWhen(
    [rf("a", "b", "success"), rf("a", "c", "error")],
    "a->c:error",
    "success",
    ABCD,
  );
  assert.ok(next, "the re-lane must be allowed");
  assert.deepEqual(pairs(next), ["a->c:success"]);
  const me = next[0];
  assert.equal(me.id, "a->c");
  assert.equal(me.data?.when, "success");
  // A spread of `edgeVisuals("success")` (an empty object) would leave both of
  // these in place — the edge would still be painted and labelled as the error lane.
  assert.doesNotMatch(String(me.className ?? ""), /w6w-edge-error/);
  assert.equal(me.label, undefined);
});

test("setEdgeWhen does not mutate its input — neither the array nor the edge objects", () => {
  const edges = [rf("a", "b", "success"), rf("a", "c", "success")];
  const before = structuredClone(edges);
  const next = setEdgeWhen(edges, "a->b", "error", ABCD);
  assert.ok(next, "the re-lane must be allowed");
  assert.notEqual(next, edges, "a new array — React Flow compares by identity");
  assert.deepEqual(edges, before, "the input array and its edge objects are untouched");
});

// ── ADDENDUM A2. `flowEdgeId` qualifies the error lane with `:error`, so it is
// not injective over free-text step ids: a step literally named `b:error` lets
// `a → b` (error) and `a → "b:error"` (success) mint ONE id, and React Flow's
// id-keyed store collapses them — a wire vanishing with no error at all, which
// reads as the editor losing the author's work. Reproduced by the T3.2.2
// evaluator on `ca8353f` as `storeSize 1 / 2`; unreachable until THIS node made
// the error lane authorable. Refusing loudly is the guard; validating step ids is
// the durable fix and is deliberately out of scope (it would also reject ids in
// workflows that already exist — FOLLOWUPS.md).

test("a step id ending ':error' is REFUSED, not silently collapsed to one edge", () => {
  const nodes = [node("a"), node("b"), node("b:error")];
  const edges = [rf("a", "b:error", "success"), rf("a", "b", "success")];
  assert.equal(edges[0].id, "a->b:error", "the collider: a plain edge to a step named b:error");
  // Named, so the panel can say WHICH edge is in the way.
  assert.equal(edgeWhenConflict(edges, "a->b", "error", nodes), "a->b:error");
  assert.equal(setEdgeWhen(edges, "a->b", "error", nodes), null);
  // Refused means nothing was lost: the caller still holds two distinct edges.
  assert.equal(new Map(edges.map((e) => [e.id, e])).size, 2);

  // ...and the guard is EVICTION-AWARE, not merely paranoid: the error half of a
  // same-target pair re-lanes to success fine, because minting `a->b` is safe
  // once the success incumbent it would clash with is evicted by the same call.
  const pair = [rf("a", "b", "success"), rf("a", "b", "error")];
  assert.equal(edgeWhenConflict(pair, "a->b:error", "success", ABCD), null);
  const relaned = setEdgeWhen(pair, "a->b:error", "success", ABCD);
  assert.ok(relaned, "the same-target pair must still be re-lanable");
  assert.deepEqual(pairs(relaned), ["a->b:success"]);
});

// ── T3.2.4. The same collision arriving from the CREATION side, in the order the
// re-lane guard above cannot see: mark `a → b` Error first (allowed — nothing
// collides yet), THEN draw `a → "b:error"`. Both mint `a->b:error`, and before this
// node `canConnect` said yes and `applyConnect` handed React Flow two edges with one
// id, of which the store keeps ONE (measured `storeSize 1 / 2`). Two independent
// copies of the uniqueness rule is exactly why one order was guarded and the other
// was not, so both paths now run the SAME test on the edges that survive eviction.

test("drawing an edge whose minted id is TAKEN is refused, not silently collapsed", () => {
  const nodes = [node("a"), node("b"), node("b:error")];
  // Step 1: marking `a → b` as the error lane is allowed — there is no collider yet.
  const relaned = setEdgeWhen([rf("a", "b", "success")], "a->b", "error", nodes);
  assert.ok(relaned, "marking the only edge as the error lane is safe");
  assert.deepEqual(
    relaned.map((e) => e.id),
    ["a->b:error"],
  );
  // Step 2: the wire the author now drags. Its minted id IS that edge's id.
  assert.equal(
    flowEdgeId("a", "b:error"),
    relaned[0].id,
    "the trap: two different edges, one React Flow id",
  );
  // `canConnect` stays TRUE on purpose — it is the live `isValidConnection`, and a
  // false there means React Flow never fires `onConnect`, so the editor never gets
  // to say why (the drop would silently land in the "dropped on empty canvas"
  // branch). The refusal belongs to `applyConnect`, where it can be explained.
  assert.equal(canConnect("a", "b:error", nodes, relaned), true);
  assert.equal(applyConnect("a", "b:error", nodes, relaned), null);
  // ...and it is NAMED, so the panel can point at the edge holding the id.
  assert.equal(connectConflict("a", "b:error", nodes, relaned), "a->b:error");
  // Refused means nothing was lost or overwritten: one edge in, one edge still out.
  assert.deepEqual(pairs(relaned), ["a->b:error"]);
  // The error lane of the same pair is a distinct id, so it is NOT refused blindly.
  assert.ok(applyConnect("a", "b:error", nodes, relaned, "error"), "a distinct id is fine");
  assert.equal(connectConflict("a", "b:error", nodes, relaned, "error"), null);
});

test("the lane census is per-SOURCE — re-laning x→y leaves another step's wire alone", () => {
  const nodes = [node("a"), node("b"), node("x"), node("y")];
  const next = setEdgeWhen(
    [rf("a", "b", "error"), rf("x", "y", "success")],
    "x->y",
    "error",
    nodes,
  );
  assert.ok(next, "the re-lane must be allowed");
  // Exit capacity belongs to ONE step's port. Drop `e.source === me.source` from the
  // census and `a → b` counts as competing for `x`'s error slot, so it is evicted:
  // the set becomes ["x->y:error"] alone and an unrelated step's wire is gone with
  // no error at all — the same silent wire loss, one step removed.
  assert.deepEqual(pairs(next), ["a->b:error", "x->y:error"]);
  const untouched = next.find((e) => e.source === "a");
  assert.equal(untouched?.id, "a->b:error");
  assert.equal(untouched?.target, "b");
});

test("a DUPLICATE edge id is refused rather than rewriting both matching edges", () => {
  // `flowEdgeId` is not injective over step ids containing `->` either: `a → "b->c"`
  // and `"a->b" → c` both mint `a->b->c`. The lookup and the replacement both match
  // BY ID, so one click used to rewrite EVERY match — the second edge's endpoints
  // overwritten with the first's and then persisted through the host's onChange.
  const nodes = [node("a"), node("b->c"), node("a->b"), node("c")];
  const dup = [rf("a", "b->c", "success"), rf("a->b", "c", "success")];
  assert.equal(dup[0].id, dup[1].id, "the corrupt precondition: two edges, one id");
  assert.equal(setEdgeWhen(dup, "a->b->c", "error", nodes), null);
  // There is no *other* edge to name here, so the caller's generic refusal applies.
  assert.equal(edgeWhenConflict(dup, "a->b->c", "error", nodes), null);
  assert.deepEqual(
    dup.map((e) => [e.source, e.target, edgeLane(e)]),
    [
      ["a", "b->c", "success"],
      ["a->b", "c", "success"],
    ],
    "neither edge's endpoints or lane were touched",
  );
});

// ── T1.1.1. Lane derivation from the dragged handle, and the edge's anchor
// following its lane through creation and re-lane. `laneForSourceHandle` /
// `sourceHandleForLane` are the one canonicalisation point every minting site
// (`onConnect`, `onConnectEnd` via `WorkflowFlowEditor.tsx`) reads off.

test("U1 — laneForSourceHandle: exactly ERROR_SOURCE_HANDLE is 'error', everything else is 'success'", () => {
  assert.equal(laneForSourceHandle(ERROR_SOURCE_HANDLE), "error");
  assert.equal(laneForSourceHandle(undefined), "success");
  assert.equal(laneForSourceHandle(null), "success");
  // The near-miss id is not decoration: it kills a `startsWith`/`includes`
  // widening, same mutation class as `isTriggerApp`'s own guard test.
  assert.equal(laneForSourceHandle("out-error-x"), "success");
});

test("U2 — sourceHandleForLane: 'error' maps to the handle id, success/absent map to undefined (not falsy)", () => {
  assert.equal(sourceHandleForLane("error"), ERROR_SOURCE_HANDLE);
  // `=== undefined`, not falsy — an empty string is falsy too but is a REAL,
  // if degenerate, handle id, and would break React Flow's default-handle
  // anchoring for a success edge.
  assert.equal(sourceHandleForLane("success"), undefined);
  assert.equal(sourceHandleForLane(undefined), undefined);
});

test("U3 — applyConnect create-success: the minted edge carries no sourceHandle", () => {
  const next = applyConnect("a", "b", ABCD, []);
  assert.ok(next, "the connection must be allowed");
  assert.equal(next[0].sourceHandle, undefined);
});

test("U4 — applyConnect create-error: the minted edge carries ERROR_SOURCE_HANDLE and data.when", () => {
  // Routed through laneForSourceHandle rather than a hard-coded "error"
  // literal — this is the same derivation `onConnect` performs off the
  // dragged handle id, so this case also pins that laneForSourceHandle's
  // output threads all the way through to the stamped edge.
  const next = applyConnect("a", "b", ABCD, [], laneForSourceHandle(ERROR_SOURCE_HANDLE));
  assert.ok(next, "the connection must be allowed");
  // A stamp without the lane, or a lane without the stamp, is a real
  // half-implementation — both are asserted in one case.
  assert.equal(next[0].sourceHandle, ERROR_SOURCE_HANDLE);
  assert.equal(next[0].data?.when, "error");
});

test("U5 — setEdgeWhen re-lanes the sourceHandle both ways on ONE edge object", () => {
  const errored = setEdgeWhen([rf("a", "b", "success")], "a->b", "error", ABCD);
  assert.ok(errored, "success→error re-lane must be allowed");
  assert.equal(errored[0].sourceHandle, ERROR_SOURCE_HANDLE);

  // The trap: a `{...edge}` spread would carry the handle id forward. Feeding
  // the errored edge back through error→success must CLEAR it to `undefined` —
  // asserted with `=== undefined`, not falsy, since a correct implementation
  // fails only under that stricter check.
  const backToSuccess = setEdgeWhen(errored, "a->b:error", "success", ABCD);
  assert.ok(backToSuccess, "error→success re-lane must be allowed");
  assert.equal(backToSuccess[0].sourceHandle, undefined);
});
