/**
 * Convert between the Workflow logical model and the React Flow node/edge
 * representation. Also computes an auto-layout — a simple topological layering
 * (columns = depth; rows = sibling index) that is deterministic and portable
 * so the same workflow always opens with the same layout.
 */
import type { Edge, Node } from "@xyflow/react";
import {
  type FlowEdge,
  type FlowStep,
  type FlowWorkflow,
  edgeVisuals,
  isInternalApp,
  sourceHandleForLane,
} from "./flow-types.ts";

export interface StepNodeData extends Record<string, unknown> {
  step: FlowStep;
  /** True for internal pseudo-app nodes (`@w6w/*`) — rendered as pill cards. */
  isInternal: boolean;
}

export type StepNode = Node<StepNodeData>;

/**
 * The React Flow id for the edge `from → to` in a given lane — **the one place**
 * the id convention lives.
 *
 * A success edge keeps the historic unqualified `from->to` spelling (so no
 * persisted definition changes id when it is reloaded); an error edge is
 * **qualified** with `:error`, because the model permits a success edge AND an
 * error edge between the same pair (core `rfcs/workflow.md` · `Edge.when`
 * amendment; D-T1-8) and two edges sharing one id would be collapsed by React
 * Flow's id-keyed store — silently losing a lane.
 *
 * Every site that mints or rewrites an edge id calls this: {@link workflowToFlow},
 * `applyConnect` (edge creation) and `renameStepInEdges` (the step-rename
 * rewrite) in `flow-connect.ts`. A second hand-rolled copy of the template is
 * exactly how the rename path came to drop the qualifier.
 */
export function flowEdgeId(from: string, to: string, when?: FlowEdge["when"]): string {
  return when === "error" ? `${from}->${to}:error` : `${from}->${to}`;
}

/**
 * The one wording for a refused edge id, shared by both routes into the collision —
 * drawing a wire whose minted id is taken (`applyConnect` / `connectConflict`) and
 * re-laning one onto a taken id (`setEdgeWhen` / `edgeWhenConflict`). `lead` names
 * what was refused, `id` is the taken id, and `involved` carries the step ids of the
 * **two edges that mint it**: the new/moving edge's endpoints and the sitting
 * edge's. Rendered inline with `role="alert"`, never in a browser dialog
 * (`.ai/conventions.md`).
 *
 * It lives here, beside {@link flowEdgeId}, for two reasons: the clash *is* a
 * property of that function's non-injectivity over free-text step ids, and this
 * module is JSX-free so `node --test` can pin the wording (it used to sit in
 * `WorkflowFlowEditor.tsx`, where the runner cannot reach it — which is how the
 * wrong advice below shipped uncovered).
 *
 * ⚠️ **The cause is DETERMINED, never asserted.** This message used to hard-code
 * *"because a step id ending in `:error` collides with the error-lane marker.
 * Rename that step"* — and the guard has a second, equally real trigger: a step id
 * containing `->`, the separator itself. With steps `a`, `b->c`, `a->b`, `c` and an
 * edge `a → "b->c"`, drawing `"a->b" → c` is correctly refused (both mint
 * `a->b->c`) while **no step id ends in `:error`** — so the author was told to
 * rename a step that does not exist, and given advice that could not resolve their
 * problem. Inferring the cause from the taken `id` alone does not fix that: an id
 * ending in `:error` may equally be an error-lane edge whose collision came from an
 * embedded `->`. So the culprit is looked up among the ids actually involved, and
 * when none of them is ambiguous the message names **no** cause at all.
 *
 * ## Which of the two triggers it is, is decided by the LANE PAIR
 *
 * Scanning the involved ids for *either* spelling and taking the first match is
 * **not** enough — it names a step whose renaming cannot resolve the clash. Steps
 * `p->q`, `b`, `b:error` with `p->q → b` sitting on the **error** lane and
 * `p->q → "b:error"` drawn on the **success** lane both mint `p->q->b:error`; the
 * first-match scan blames `p->q`, which is the **shared source of both edges**, so
 * renaming it re-mints both and the edge is still refused. The mirror is just as
 * wrong: two **success**-lane edges over steps `x:error`, `y->z`, `x:error->y`, `z`
 * collide with no error lane anywhere, yet get blamed on the error-lane marker.
 *
 * The lane pair decides it, and decides it exactly:
 * - **Same lane on both edges** ⇒ `f1->t1` == `f2->t2` (with the same suffix) forces
 *   the two splits to differ, i.e. an **embedded `->`**; it also forces both
 *   endpoints to differ (equal sources would force equal targets and vice versa), so
 *   renaming *any* involved id re-mints exactly one of the two edges.
 * - **Different lanes** ⇒ `fs->ts` == `fe->te:error`, and since `:error` contains
 *   neither `-` nor `>` its 6 characters cannot overlap the separator — so **the
 *   success edge's target** ends in `:error`, and that is the step to rename.
 *
 * The lanes are not passed in: they are recovered from `id` itself, which
 * {@link flowEdgeId} is the only minter of, so an endpoint pair spells `id` on at
 * most one lane (`f->t` and `f->t:error` are never equal). A pair that spells it on
 * neither means an already-corrupt edge set — the lane pair then determines nothing
 * and the message names no cause, exactly as when nothing involved is ambiguous. A
 * vague-but-true message beats a confident false one.
 */
export function idClashMessage(
  lead: string,
  id: string,
  involved: readonly (string | null | undefined)[],
): string {
  const laneOf = (from: string | null | undefined, to: string | null | undefined) =>
    !from || !to
      ? undefined
      : flowEdgeId(from, to) === id
        ? "success"
        : flowEdgeId(from, to, "error") === id
          ? "error"
          : undefined;
  const drawn = laneOf(involved[0], involved[1]);
  const sitting = laneOf(involved[2], involved[3]);
  const sameLane = drawn !== undefined && drawn === sitting;
  const mixedLane = drawn !== undefined && sitting !== undefined && drawn !== sitting;
  // On mixed lanes the culprit is the SUCCESS edge's target (`involved` is
  // `[drawn.source, drawn.target, sitting.source, sitting.target]`).
  const successTarget = drawn === "success" ? involved[1] : involved[3];
  const culprit = sameLane
    ? involved.find((s): s is string => !!s && s.includes("->"))
    : mixedLane && successTarget?.endsWith(":error")
      ? successTarget
      : undefined;
  // One long template per arm on purpose: `lint/style/useTemplate` forbids
  // concatenating a template with a literal, and the formatter does not break
  // string contents.
  const cause =
    culprit === undefined
      ? "Rename one of the steps it connects, then try again."
      : sameLane
        ? `A step id containing “->” collides with the edge-id separator, so two different edges mint one id — rename the step “${culprit}”, then try again.`
        : `A step id ending in “:error” collides with the error-lane marker, so two different edges mint one id — rename the step “${culprit}”, then try again.`;
  return `${lead}: the id “${id}” is already taken by another edge. ${cause}`;
}

/** Nice constants — tunable but stable defaults so layouts don't jitter. */
const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 100;
const MARGIN_X = 40;
const MARGIN_Y = 40;

/**
 * The canvas slot a step in column `col`, row `row` occupies — **the one place**
 * the placement arithmetic lives, exactly as {@link flowEdgeId} is the one place
 * the id convention lives.
 *
 * Two callers, and the reason they must share this is user-visible: {@link
 * workflowToFlow} uses the slot as the *fallback* for a step with no stored
 * `position` (first open), while {@link relayoutNodes} uses it for *every* node
 * (the auto-layout control). A second copy of the arithmetic would make
 * "auto-layout" disagree with "first open" — the one difference an author would
 * notice immediately — so the only thing that differs between the two is whether
 * a stored coordinate wins, which belongs at the call site.
 *
 * A **fresh object** every call: React Flow owns `node.position` and mutates it
 * in place during a drag (see {@link storedPosition}).
 */
function slotPosition(col: number, row: number): { x: number; y: number } {
  return { x: MARGIN_X + col * COLUMN_WIDTH, y: MARGIN_Y + row * ROW_HEIGHT };
}

/**
 * Layer index per step id under a topological layout of the graph: a step sits
 * one column right of its furthest-right predecessor (longest-path layering,
 * computed by relaxation).
 *
 * ## Termination — this loop used to hang the tab
 *
 * The relaxation is **bounded to `steps.length + 1` passes**. The unbounded
 * `while (changed)` it replaces assumed a DAG ("for a DAG this converges") and
 * never exited on a cycle: with `a → b → a` the `<` test stays satisfiable
 * forever and the layers climb without bound. The engine rejects cycles at plan
 * time, but **this editor lets you draw one**, and `workflowToFlow` calls this
 * on open — so a cyclic workflow froze the tab on load, and would have frozen it
 * mid-edit once an auto-layout button called the same code from a click.
 *
 * A **pass bound** was chosen over a separate cycle detector (a DFS colouring)
 * for two reasons: it keeps one traversal and one notion of "the graph" instead
 * of two that can drift, and the bound is provably exact rather than heuristic —
 * by the Bellman-Ford argument, after `k` full passes every step whose longest
 * path from a source is `k` edges long already holds its final layer, and an
 * acyclic graph's longest path visits each step at most once. So a DAG reaches
 * its fixpoint within `steps.length` passes and the extra pass here only ever
 * observes `changed === false`. **Acyclic output is therefore byte-identical to
 * the unbounded version** — the bound is not a heuristic cut-off, and
 * `artifacts/T3.3.1-computelayers-equivalence.sh` proves it against the previous
 * commit's blob over 200+ fixtures.
 *
 * ⚠️ What is **not** guaranteed is that a layer stays ≤ `steps.length - 1` (an
 * earlier revision of this comment claimed it, and used the claim to call the
 * clamp below a provable no-op on any DAG — that was **false**). `layer.get(pred)
 * ?? 0` treats an edge whose `from` is **not a declared step** as a phantom
 * predecessor sitting at layer 0, so such an edge contributes a real `+1`:
 * `steps: [a, b]` with `edges: [ghost→a, a→b]` puts `b` in column **2** while
 * `lastColumn` is 1. That graph is still fine — it converges, so `changed` is
 * `false` and the clamp never runs; the extra column simply renders (pinned by
 * `flow-utils.test.ts` · "an edge from an UNDECLARED step adds a column"). The
 * honest invariant is the narrower one: **the clamp runs only when the pass bound
 * is exhausted with the layout still moving, which requires a cycle.**
 *
 * Exceeding the bound *is* the cycle signal (`changed` is still true). The
 * layout then stays **usable** rather than throwing or refusing: the runaway
 * values are clamped to the last real column, so the steps on the cycle stack up
 * in one column (distinct rows — `workflowToFlow` counts rows per column) and
 * the author can see the loop they drew and delete an edge. Refusing to lay out
 * a cyclic graph would trade a hang for a workflow nobody can open to fix. The
 * clamp cannot fire on a DAG, because a DAG converges before the bound is spent —
 * **not** because its layers are bounded by `steps.length - 1`; see the ⚠️ above.
 */
function computeLayers(steps: FlowStep[], edges: FlowEdge[]): Map<string, number> {
  const layer = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const s of steps) {
    layer.set(s.id, 0);
    incoming.set(s.id, []);
  }
  for (const e of edges) {
    incoming.get(e.to)?.push(e.from);
  }
  // Iterate to fixpoint. For a DAG this converges in O(V+E) passes — and the
  // pass bound is what makes that assumption safe instead of load-bearing.
  const maxPasses = steps.length + 1;
  let passes = 0;
  let changed = true;
  while (changed && passes < maxPasses) {
    passes++;
    changed = false;
    for (const s of steps) {
      const preds = incoming.get(s.id) ?? [];
      if (preds.length === 0) continue;
      const next = preds.reduce((max, p) => Math.max(max, (layer.get(p) ?? 0) + 1), 0);
      if ((layer.get(s.id) ?? 0) < next) {
        layer.set(s.id, next);
        changed = true;
      }
    }
  }
  if (changed) {
    // The bound ran out with the layout still moving ⇒ there is a cycle. Pull
    // the runaway columns back to the last real one so the graph still renders.
    const lastColumn = Math.max(0, steps.length - 1);
    for (const [id, col] of layer) {
      if (col > lastColumn) layer.set(id, lastColumn);
    }
  }
  return layer;
}

/**
 * A step's **stored** canvas coordinate, when it has a usable one.
 *
 * `position` arrives from a persisted JSON document (core `rfcs/workflow.md` ·
 * authoring-presentation amendment, mirrored on {@link FlowStep}), so both axes
 * are checked with `Number.isFinite`: a `null`, a string, a `NaN` from a
 * `JSON.parse`d `null`, or a half-written `{ x }` falls back to the computed slot
 * rather than putting the node at an unreachable coordinate.
 *
 * A **fresh object** is returned, never the one hanging off the step: React Flow
 * owns `node.position` while a drag is in flight, and the same step object is
 * also handed to the node's `data.step`.
 */
function storedPosition(step: FlowStep): { x: number; y: number } | undefined {
  const p = step.position;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
  return { x: p.x, y: p.y };
}

/**
 * Turn a Workflow into (nodes, edges) with an auto-layout when no positions are
 * known.
 *
 * A step's **stored `position` wins** over the computed slot (the amendment's
 * "omitted ⇒ the editor computes a layout" arm, and its converse). A partially
 * positioned graph mixes the two: positioned steps sit where they were left,
 * unpositioned ones take their computed slot.
 *
 * `computeLayers` runs over the **whole** graph either way, and the per-column
 * row counter advances for every step including positioned ones — so an
 * unpositioned step's computed coordinate is a pure function of the graph and
 * does not shift depending on which of its neighbours happen to carry a
 * coordinate.
 */
export function workflowToFlow(wf: FlowWorkflow): { nodes: StepNode[]; edges: Edge[] } {
  const edges: FlowEdge[] = wf.edges ?? implicitChain(wf.steps);
  const layer = computeLayers(wf.steps, edges);
  const rowsInLayer = new Map<number, number>();

  const nodes: StepNode[] = wf.steps.map((step) => {
    const isInternal = isInternalApp(step.uses.app);
    const col = layer.get(step.id) ?? 0;
    const row = rowsInLayer.get(col) ?? 0;
    rowsInLayer.set(col, row + 1);
    return {
      id: step.id,
      type: isInternal ? "control" : "step",
      position: storedPosition(step) ?? slotPosition(col, row),
      data: { step, isInternal },
    };
  });

  const flowEdges: Edge[] = edges.map((e) => {
    // Omitted ⇒ "success" (core rfcs/workflow.md · Edge.when amendment). The
    // lane rides on `data` so flowToWorkflow can read it straight back off the
    // React Flow edge; the className + label that tell an error edge apart on
    // the canvas come from {@link edgeVisuals} — the single source of truth,
    // shared with `setEdgeWhen`, which re-lanes an edge live. Inlining them here
    // is how the loaded look and the just-marked look drift apart.
    //
    // The id is qualified per lane, because the model permits a success edge AND
    // an error edge between the same pair: two edges sharing one id would be
    // collapsed by React Flow's id-keyed store and one lane silently lost. The
    // qualifier comes from {@link flowEdgeId}, which every other id site calls.
    //
    // `sourceHandle` is stamped from {@link sourceHandleForLane} (T1.1.1) so a
    // workflow saved before the error port existed renders its error edges from
    // the new port on next open, not only edges drawn live after the feature
    // shipped. `sourceHandle` is presentation only — `flowToWorkflow` never
    // reads it back, so this does not touch the persisted `Edge.when` round-trip.
    const when = e.when ?? "success";
    return {
      id: flowEdgeId(e.from, e.to, when),
      source: e.from,
      target: e.to,
      sourceHandle: sourceHandleForLane(when),
      animated: false,
      data: { when },
      ...edgeVisuals(when),
    };
  });

  return { nodes, edges: flowEdges };
}

/**
 * Re-flow every node with the same deterministic layering the editor uses on
 * first open — the auto-layout control's whole implementation.
 *
 * Takes React Flow's `(nodes, edges)` rather than a `FlowWorkflow` because the
 * button acts on **what is currently on the canvas**, including steps added and
 * wires drawn since the last save.
 *
 * Same {@link computeLayers} and same {@link slotPosition} as {@link
 * workflowToFlow}, so a graph with no stored positions lays out byte-identically
 * either way (pinned by `flow-utils.test.ts` — "auto-layout agrees with first
 * open"). The **only** difference is that a stored coordinate does not win here:
 * overriding hand placement is precisely what the author asked for by clicking.
 * That is also why the caller confirms first — there is no undo in studio.
 *
 * Layering is keyed by **`node.id`**, not `node.data.step.id`: React Flow's
 * `edge.source`/`edge.target` name node ids, so keying by anything else would
 * silently drop every edge from the layering (a `?? 0` fallback puts the whole
 * graph in column 0) if the two ever disagreed.
 *
 * Returns a **new array of new node objects** — React Flow's state handle
 * compares by reference, so a mutated-in-place array does not re-render — with
 * every node's `id`, `type` and `data` carried across untouched (`data` by the
 * same reference, so no node card re-derives its metadata).
 */
export function relayoutNodes(nodes: StepNode[], edges: Edge[]): StepNode[] {
  // `computeLayers` reads only `.id` off a step; keying on the NODE id keeps it
  // consistent with the edge endpoints below. The bounded relaxation inside is
  // what makes this safe to call from a click: before it, a cyclic graph froze
  // the tab, and this button would have frozen it mid-edit.
  const steps: FlowStep[] = nodes.map((n) => ({ ...n.data.step, id: n.id }));
  const layer = computeLayers(
    steps,
    edges.map((e) => ({ from: e.source, to: e.target })),
  );
  const rowsInLayer = new Map<number, number>();
  return nodes.map((n) => {
    const col = layer.get(n.id) ?? 0;
    const row = rowsInLayer.get(col) ?? 0;
    // Advance for EVERY node, exactly as `workflowToFlow` does — the row counter
    // is per column, and skipping any node would collapse two onto one slot.
    rowsInLayer.set(col, row + 1);
    return { ...n, position: slotPosition(col, row) };
  });
}

/**
 * Reverse direction: pull the graph state back into a Workflow shape for
 * onChange.
 *
 * Each emitted step carries the **current canvas coordinate** of its node, unless
 * `original.settings.savePosition` is explicitly `false`. The flag is read off
 * the workflow this function already receives — deliberately **not** a new
 * parameter or an options bag, because both exported conversion functions are
 * public `@w6w/ui/flow` API for a partner-facing library and a signature
 * change here would break it for a value the function can already see.
 *
 * ⚠️ **`savePosition` defaults to `true`** (core `rfcs/workflow.md` ·
 * authoring-presentation amendment), so it is read as `!== false`: an absent
 * `settings` object means positions *are* persisted. The practical consequence is
 * intended — **a workflow that has never been saved by this editor starts
 * carrying `position` on every step the first time it is saved.**
 */
export function flowToWorkflow(
  original: FlowWorkflow,
  nodes: StepNode[],
  edges: Edge[],
): FlowWorkflow {
  // `!== false`, never `?? false` and never `=== true`: omitted ⇒ ON.
  const savePosition = original.settings?.savePosition !== false;
  const nodeById = new Map<string, StepNode>(nodes.map((n) => [n.id, n]));

  /**
   * Stamp a step with its node's coordinate.
   *
   * `Math.round` is required, not cosmetic: React Flow reports fractional
   * coordinates, and auto-save dedupes by comparing the serialized payload — an
   * unrounded float would make a no-op render look like a change and produce a
   * write storm.
   *
   * When `savePosition` is `false` the step is returned **untouched**, which is
   * not the same as clearing it: "not written" is not "erased", so a coordinate a
   * colleague already stored survives someone else turning their own toggle off
   * (amendment: "any values already stored are left as they are, not erased").
   */
  const withPosition = (step: FlowStep): FlowStep => {
    if (!savePosition) return step;
    const p = nodeById.get(step.id)?.position;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return step;
    return { ...step, position: { x: Math.round(p.x), y: Math.round(p.y) } };
  };

  // Preserve original step order where possible; append new nodes at the end.
  const stepById = new Map<string, FlowStep>();
  for (const s of original.steps) stepById.set(s.id, s);
  for (const n of nodes) if (n.data?.step) stepById.set(n.id, n.data.step);

  const nextSteps: FlowStep[] = [];
  const seen = new Set<string>();
  for (const s of original.steps) {
    const current = stepById.get(s.id);
    if (current && nodes.some((n) => n.id === s.id)) {
      nextSteps.push(withPosition(current));
      seen.add(s.id);
    }
  }
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const s = stepById.get(n.id);
    if (s) nextSteps.push(withPosition(s));
  }

  // Read the lane back off the React Flow edge (put there by workflowToFlow /
  // by applyConnect at creation). `"success"` is written as ABSENT — the house
  // omit-the-default idiom — so a definition with no error edge round-trips
  // byte-identically to what was loaded.
  const nextEdges: FlowEdge[] = edges.map((e) => {
    const when = (e.data as { when?: FlowEdge["when"] } | undefined)?.when;
    return when === "error"
      ? { from: e.source, to: e.target, when }
      : { from: e.source, to: e.target };
  });

  return { ...original, steps: nextSteps, edges: nextEdges };
}

/** The workflow's stored camera, as `settings.viewport` declares it. */
type StoredViewport = NonNullable<NonNullable<FlowWorkflow["settings"]>["viewport"]>;

/**
 * The workflow's **stored** camera position, when it has a usable one — the
 * viewport counterpart to {@link storedPosition}, and the single definition of
 * "a viewport this editor will act on". Both the restore-on-open read and
 * {@link withViewport}'s no-op comparison go through it, so they cannot disagree
 * about what counts as stored.
 *
 * All three components are checked with `Number.isFinite` for the same reason
 * `storedPosition` checks two: `settings.viewport` arrives from a persisted JSON
 * document that an author can hand-edit (studio's `</>` raw-JSON modal), and a
 * `null`, a string or a half-written `{ x, y }` would otherwise be handed to
 * React Flow's `defaultViewport` as the initial transform — a `NaN` there blanks
 * the canvas, with no way back except editing the JSON again. Unusable ⇒
 * `undefined`, i.e. "no stored viewport", which falls back to `fitView`.
 *
 * A **fresh object** is returned, never the one hanging off `settings`: React
 * Flow owns the viewport it is given.
 */
export function storedViewport(wf: FlowWorkflow): StoredViewport | undefined {
  const v = wf.settings?.viewport;
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.zoom)) {
    return undefined;
  }
  return { x: v.x, y: v.y, zoom: v.zoom };
}

/**
 * Record the author's viewport on the workflow (core `rfcs/workflow.md` ·
 * authoring-presentation amendment). Pure, so the two decisions that matter —
 * rounding and no-op detection — are unit-testable without mounting React Flow.
 *
 * Returns `wf` **UNCHANGED (the same reference)** when:
 *  - `settings.savePosition` is `false` — read as `!== false`, never `?? false`
 *    and never `=== true`: **omitted ⇒ ON**, same as `flowToWorkflow`;
 *  - the rounded viewport already equals the stored one;
 *  - the incoming viewport is not finite (nothing usable to store).
 *
 * The same-reference return **is** the coalescing guard: the caller emits only
 * when the reference changes, so a pan that lands back where it started emits
 * nothing at all. That matters because the host's auto-save is a trailing
 * debounce over emitted changes — every emission is a candidate network write.
 *
 * Rounding is pinned for that same reason (and mirrors `flowToWorkflow`'s
 * coordinate rounding): `x`/`y` to integers, `zoom` to **3 decimal places**.
 * A trackpad reports the zoom as a long float, so without it two visually
 * identical viewports serialize differently and every idle gesture looks like a
 * change to a payload-comparing auto-save.
 *
 * `settings` is spread, not replaced, so `autoSave` / `savePosition` survive a
 * viewport write — the mirror image of `writeSetting` (studio) deleting a key at
 * its default without disturbing `viewport`. That mirror runs to the **guard on
 * the spread** as well: `settings` is typed as an object here, but it arrives from
 * a `JSON.parse`d document an author can hand-edit (studio's `</>` raw-JSON
 * modal), so `"settings": "hello"` would spread into indexed keys —
 * `{"0":"h","1":"e",…, viewport}` — **on a pan**, and the host's auto-save would
 * re-persist that on a debounce with nobody clicking anything. Anything that is
 * not a plain object therefore reads as "no settings", i.e. the write produces a
 * fresh `{ viewport }`, discarding the unusable value; the predicate is
 * `writeSetting`'s, character for character, so the two really are one rule.
 */
export function withViewport(wf: FlowWorkflow, vp: StoredViewport): FlowWorkflow {
  // `!== false`, never `?? false` and never `=== true`: omitted ⇒ ON.
  const savePosition = wf.settings?.savePosition !== false;
  if (!savePosition) return wf;
  if (!Number.isFinite(vp.x) || !Number.isFinite(vp.y) || !Number.isFinite(vp.zoom)) return wf;
  const next: StoredViewport = {
    x: Math.round(vp.x),
    y: Math.round(vp.y),
    zoom: Math.round(vp.zoom * 1000) / 1000,
  };
  const current = storedViewport(wf);
  if (current && current.x === next.x && current.y === next.y && current.zoom === next.zoom) {
    return wf;
  }
  // Studio's `writeSetting` predicate, verbatim — a non-object `settings` must not
  // spread into indexed keys (see the docstring).
  const prev =
    typeof wf.settings === "object" && wf.settings !== null && !Array.isArray(wf.settings)
      ? wf.settings
      : undefined;
  return { ...wf, settings: { ...prev, viewport: next } };
}

/** When no edges are declared, treat steps as a linear chain in declared order. */
function implicitChain(steps: FlowStep[]): FlowEdge[] {
  const out: FlowEdge[] = [];
  for (let i = 0; i < steps.length - 1; i++) out.push({ from: steps[i].id, to: steps[i + 1].id });
  return out;
}

/**
 * Turn a human-readable label (an action's `label`/`displayName`) into an
 * id-safe slug for {@link suggestStepId}'s `prefix` — human override,
 * 2026-08-30: a step id derived from its OWN action ("data_1",
 * "render_template_1", "manual_trigger_1") orients a reader who never
 * renamed it, unlike the generic "gate_1"/"step_1" every internal/external
 * step used to get regardless of what it actually does. Lowercase,
 * underscore-separated, ASCII word characters only; falls back to `"step"`
 * for a label that slugifies to nothing (empty, or entirely punctuation).
 */
export function slugifyLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "step";
}

/**
 * The current chain's ROOT: the earliest-added node (array/declaration order)
 * with no incoming edge. `undefined` for an empty graph. Used to give a
 * newly-added TRIGGER a sensible default wire — human override, 2026-08-30 —
 * rather than always landing as a floating node. Array order (not position)
 * is the tie-break because it is deterministic and matches "the node that
 * was here first," not wherever the canvas happens to have placed it.
 */
export function findChainRoot(nodes: StepNode[], edges: Edge[]): StepNode | undefined {
  const hasIncoming = new Set(edges.map((e) => e.target));
  return nodes.find((n) => !hasIncoming.has(n.id));
}

/**
 * The current chain's TAIL: the most-recently-added node (array/declaration
 * order) with no outgoing edge. `undefined` for an empty graph. Used to give
 * a newly-added non-trigger STEP a sensible default wire — the most recently
 * placed branch is the one a user adding steps one at a time is most likely
 * extending.
 */
export function findChainTail(nodes: StepNode[], edges: Edge[]): StepNode | undefined {
  const hasOutgoing = new Set(edges.map((e) => e.source));
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (!hasOutgoing.has(nodes[i].id)) return nodes[i];
  }
  return undefined;
}

/** Suggest a unique step id given the current graph. */
export function suggestStepId(existing: string[], prefix = "step"): string {
  const set = new Set(existing);
  for (let i = 1; i < 1000; i++) {
    const id = `${prefix}_${i}`;
    if (!set.has(id)) return id;
  }
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

// ── Code-view serializers ──────────────────────────────────────────────────
//
// The ONE place a step or its params turn into code-view text — three hosts
// (`StepBuilderModal.tsx`'s `ControlStepConfig`/`AppStepConfig` and
// `WorkflowFlowEditor.tsx`'s `StepEditModal`) used to call `JSON.stringify`
// locally, which is how a manual trigger's `<>` came to show only
// `{"fields":[…]}`: `with.fields` is that trigger's one declared param, and a
// bare `JSON.stringify(step.with)` never surfaced `uses`/`id` at all.

/**
 * A step, or the add-step hosts' in-progress `BuiltStep` (`StepBuilderModal.tsx`)
 * — structurally `FlowStep` minus `id`, which those hosts legitimately have not
 * minted yet (the editor assigns it once the step first joins the graph). Kept
 * structural rather than importing `BuiltStep` so this module stays the
 * dependency-free base every host already imports from, not the other way
 * round.
 */
export type StepLike = Omit<FlowStep, "id"> & { id?: string };

/**
 * The full-step `<>` view text — every persisted field, `id` included when the
 * caller has one, no more and no less. Core `rfcs/workflow.md`: "A step **is**
 * an Invocation", so this is the whole step, not a derived projection — no
 * `kind` field is added, and nothing here special-cases a trigger's
 * `with.fields`; it is an ordinary declared param living in the same `with`
 * slot every step uses.
 *
 * **Read-only in v1 (D-3)** — a hand-edited `uses`/`id` has no validation path
 * today, so callers must not wire a write-back path from this text. Write
 * access stays on {@link paramsToJson}'s view and the Form view.
 */
export function stepToJson(step: StepLike): string {
  return JSON.stringify(step, null, 2);
}

/**
 * The params-only view text — `step.with`, exactly what the `<>` view showed
 * before this task split "the whole step" out from "just its params". Still
 * writable: the params-only `JsonEditor`'s `onValidChange` feeds straight back
 * into `with`/`withValues`, same as it always has.
 */
export function paramsToJson(step: Pick<StepLike, "with">): string {
  return JSON.stringify(step.with ?? {}, null, 2);
}
