/**
 * The incoming state a single-step Test / ▶ Run is sent with, and the pure
 * graph logic that derives it. Extracted out of `WorkflowFlowEditor.tsx` so
 * `node --test` can exercise it directly — the same precedent `flow-connect.ts`
 * sets (see that file's own header comment); this module stays JSX-free.
 *
 * Three surfaces mount this state today, all from the SAME functions so they
 * cannot drift: the step editor's Test tab and the canvas ▶ Run collect form
 * (both already wired, unchanged by this move) and `StepBuilderModal`'s
 * add-step Test tab (T1.1.1 — the new caller, via {@link stepBuilderUpstreamSteps}).
 */
import type { Edge } from "@xyflow/react";
import type { ExpressionStepSource } from "./components/ExpressionOptions.tsx";
import { TRIGGER_APP, internalNodeDef } from "./flow-types.ts";
import type { StepNode } from "./flow-utils.ts";
import type { StepStartState, StepTest } from "./provider.tsx";
import { asFieldDefs, fieldsToParams } from "./trigger-fields.ts";

/** A graph ancestor carrying a saved step-test, offered as a one-click seed. */
export interface SeedSource {
  stepId: string;
  label: string;
  test: StepTest;
}

/**
 * `pendingConnect`'s shape (`WorkflowFlowEditor.tsx`'s state): the handle a
 * connection drag was released from, when it ended on empty canvas and opened
 * the step builder to create + auto-wire a new node. `position` is part of
 * that state too (where to place the new node) but unused by the direction
 * rule below, so it is deliberately omitted here — `pendingConnect`'s real
 * type carries it, and a wider object satisfies this narrower one structurally.
 */
interface PendingConnect {
  nodeId: string;
  handleType: "source" | "target";
}

/** Every node id that is a graph ancestor of `rootId` — walks `edges` backward. */
function ancestorIds(rootId: string, edges: Edge[]): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    const arr = parents.get(e.target) ?? [];
    arr.push(e.source);
    parents.set(e.target, arr);
  }
  const ancestors = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const p of parents.get(id) ?? []) {
      if (!ancestors.has(p)) {
        ancestors.add(p);
        stack.push(p);
      }
    }
  }
  return ancestors;
}

/**
 * Project the nodes in `ids` into `ExpressionStepSource`s, the one place that
 * decides trigger detection and declared-output projection — shared by
 * {@link upstreamStateSources} and {@link stepBuilderUpstreamSteps} so both
 * callers agree on what a trigger ancestor looks like.
 */
function projectStepSources(
  ids: Set<string>,
  nodes: StepNode[],
): { steps: ExpressionStepSource[]; hasTrigger: boolean } {
  const steps: ExpressionStepSource[] = [];
  let hasTrigger = false;
  for (const n of nodes) {
    if (!ids.has(n.id)) continue;
    const step = n.data.step;
    const isTrigger = internalNodeDef(step.uses.app, step.uses.action)?.group === "trigger";
    if (isTrigger) {
      // `trigger.event` stays on offer — but the trigger is ALSO a `steps.<id>`
      // source (see `upstreamStateSources`'s doc below), so it falls through to
      // the push.
      hasTrigger = true;
    }
    // Declared output fields, via the shared trigger-field projection — the one
    // parser, which already skips a blank/missing `key`. MANUAL-TRIGGER-ONLY: a
    // webhook/scheduler entry node's `with.fields` payload is `trigger.event`
    // (see the file-header-level doc below), not `steps.<id>.output`, so it must
    // not be projected here; on any other node `with.fields` is that action's
    // INPUT, and projecting it would fabricate declared outputs the step never
    // produces.
    const isManualTrigger = isTrigger && step.uses.app === TRIGGER_APP;
    const declared = isManualTrigger ? fieldsToParams(asFieldDefs(step.with?.fields)) : [];
    const source: ExpressionStepSource = { id: step.id, label: step.id };
    // OMITTED (not `[]`) when nothing is declared, so a consumer can tell
    // "nothing declared" from "declared none". Keys are verbatim: each becomes
    // `steps.<id>.output.<key>`, and only that form resolves at run time.
    steps.push(
      declared.length > 0
        ? { ...source, outputs: declared.map((p) => ({ key: p.key, label: p.label })) }
        : source,
    );
  }
  return { steps, hasTrigger };
}

/**
 * The workflow state a given step can reference: the outputs of every step
 * that runs before it (its graph ancestors) plus whether a trigger precedes
 * it.
 *
 * A trigger ancestor is **both**. It is pushed into `steps` like any other
 * ancestor — `core/rfcs/node-types.md` ("Triggers as nodes"): *"Executing a
 * trigger node yields the run's start payload … which downstream nodes read as
 * `steps.<triggerId>.output`"* — **and** it sets `hasTrigger`, which offers the
 * separate `trigger.event` root. The two are different values, not two spellings
 * of one: `trigger.event` is the dispatcher-delivered event payload (seeded from
 * `seed.event`), while a manual trigger's filled fields land under
 * `steps.<id>.output`. Offering only the former is why a trigger's declared
 * fields were unreachable from the picker.
 *
 * A **manual trigger** that declares output fields (`with.fields`) carries
 * them as `outputs`, so a consumer can offer `steps.<id>.output.<key>` per
 * field. Only a manual trigger: `fields` is an ordinary param name, and on any
 * other node — including a webhook/scheduler entry node, whose payload is
 * `trigger.event` instead (see the ⚠️ note below) — it holds that action's
 * INPUT; an `@w6w/http:request` with `with.fields = [{key:"x"}]` would
 * otherwise be advertised as declaring an output `x` it never produces. The
 * manual trigger's `fields` is the one case where the param IS the output
 * contract (`core/rfcs/node-types.md:194-196`; `trigger.md:119` covers only
 * what drives editor autocomplete).
 *
 * ⚠️ These declared fields resolve differently on each run path. On the
 * **single-step Test / ▶ Run** path (below), this editor sends a start state
 * seeded from the upstream saved fixtures (see {@link startStateFromSeeds})
 * which `POST /apps/:id/actions/:key/invoke` projects onto
 * `steps.<id>.output`. On a **full run**, a manual trigger's declared fields
 * resolve too: `POST /workflows/:id/run` accepts an `input` body field, and
 * `run-workflow.ts` seeds the `@w6w/trigger` node's own output with it
 * (verified by `server/e2e/trigger_run_payload_e2e_test.ts`). A
 * webhook/scheduler entry node's declared fields do **not** resolve on a full
 * run — its payload there is `trigger.event`, not `steps.<id>.output`, by
 * design (`core/rfcs/trigger.md:378`) — which is exactly why the projection
 * above is narrowed to a manual trigger only.
 *
 * With no specific step (shouldn't happen for a field edit) every node is offered.
 */
export function upstreamStateSources(
  editingId: string | null,
  nodes: StepNode[],
  edges: Edge[],
): { steps: ExpressionStepSource[]; hasTrigger: boolean } {
  const ids = editingId ? ancestorIds(editingId, edges) : new Set(nodes.map((n) => n.id));
  return projectStepSources(ids, nodes);
}

/**
 * The new add-step wizard's graph ancestors, derived from `pendingConnect` —
 * the handle a connection drag was released from before the builder opened
 * (`null` for a floating add with no drag at all).
 *
 * **Direction matters.** `addBuiltStep`'s edge-wiring ternary
 * (`WorkflowFlowEditor.tsx`) only makes the new step DOWNSTREAM of
 * `pendingConnect.nodeId` when the drag came off a **source** handle
 * (`[pendingConnect.nodeId, id]`); off a **target** handle the new step becomes
 * the edge's SOURCE instead (`[id, pendingConnect.nodeId]`), so
 * `pendingConnect.nodeId` ends up downstream of the new step, not upstream —
 * offering it as a seed would be backwards. A `handleType: "source"` drag
 * carries the dragged node itself (it IS upstream of the step about to be
 * created) plus that node's own ancestors, via the same projection
 * {@link upstreamStateSources} uses.
 */
export function stepBuilderUpstreamSteps(
  pendingConnect: PendingConnect | null,
  nodes: StepNode[],
  edges: Edge[],
): ExpressionStepSource[] {
  if (!pendingConnect || pendingConnect.handleType === "target") return [];
  const ids = ancestorIds(pendingConnect.nodeId, edges);
  ids.add(pendingConnect.nodeId);
  return projectStepSources(ids, nodes).steps;
}

/**
 * Gather each graph ancestor's latest saved step-test so the incoming-state
 * control can offer it as a seed. **One implementation**, called by every
 * surface that mounts {@link SeedSource}s — the step editor's Test tab, the
 * canvas ▶ Run collect form, and `StepBuilderModal`'s add-step Test tab — so
 * the `gate_1 · succeeded` chip behaves identically everywhere.
 *
 * `listStepTests` is injected (rather than reached for via `useW6WApi()`
 * directly) so this stays a plain async function `node --test` can call with a
 * stub — the React-facing wrapper is `use-seed-sources.ts`'s `useSeedSources`.
 * It returns oldest-first per step, so the last entry is the most recent
 * fixture. A step with no saved fixture (an empty list, or a lookup that
 * throws) contributes nothing — best-effort, per step, never breaking the rest.
 */
export async function fetchSeedSources(
  listStepTests: (stepId: string) => Promise<StepTest[]>,
  upstreamSteps: ExpressionStepSource[],
): Promise<SeedSource[]> {
  const results = await Promise.all(
    upstreamSteps.map(async (s): Promise<SeedSource | null> => {
      try {
        const tests = await listStepTests(s.id);
        const latest = tests.length ? tests[tests.length - 1] : null;
        return latest ? { stepId: s.id, label: s.label ?? s.id, test: latest } : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is SeedSource => r !== null);
}

/**
 * The start state a single-step Test / ▶ Run is sent with: **the last-known
 * saved output of each upstream step**, keyed by step id, in the shape the
 * invoke route accepts (`{ steps: { <id>: { output } } }` — the server's
 * `StartStateInput`, `packages/api/ambient-scope.ts`). It is what makes a
 * `with` block written as `{{ steps.<id>.output.<field> }}` resolve to the
 * value that step last produced instead of concatenating as `""`.
 *
 * Read from the same `step_tests` fixtures the seed chips offer — no upstream
 * step is re-run to produce it, and nothing here is computed live.
 *
 * A step whose fixture never captured an output contributes **no entry** rather
 * than an empty one, and a set with no outputs at all returns `undefined` so
 * the invoke body carries no `state` key at all (byte-identical to a request
 * from before this existed). Each id gets its OWN `{ output }` object: sharing
 * one would make every reference resolve the last step's data.
 *
 * ⚠️ Single-step scope only. A full run (`POST /workflows/:id/run`) builds its
 * own scope and is not affected by this.
 */
export function startStateFromSeeds(seeds: SeedSource[]): StepStartState | undefined {
  const steps: Record<string, { output: unknown }> = {};
  for (const s of seeds) {
    const output = s.test.lastRunOutput;
    // `undefined` = never captured, `null` = the row's empty marker
    // (`repos/step-tests.ts` stores both as NULL). Neither is a value to seed.
    if (output === undefined || output === null) continue;
    steps[s.stepId] = { output };
  }
  return Object.keys(steps).length > 0 ? { steps } : undefined;
}
