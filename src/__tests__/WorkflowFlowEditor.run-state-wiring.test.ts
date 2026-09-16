// Run: node --test src/__tests__/WorkflowFlowEditor.run-state-wiring.test.ts  (Node 24, type-stripped)
//
// T1.1.1's Trap 1: `initial = useMemo(() => workflowToFlow(value), [value.id])`
// deliberately re-derives nodes/edges ONLY on workflow identity change, so
// threading `runState` through `workflowToFlow` would compile, typecheck, and
// repaint NOTHING on a poll tick — the mutation the contract calls out as M1.
// A pure `run-visuals.test.ts` case cannot see this: the derivation functions
// themselves are correct either way, the defect is in whether `Inner` actually
// wires them to a live prop change. This file pins the SHAPE of that wiring —
// the same structural-gate idiom `WorkflowFlowEditor.error-port-wiring.test.ts`
// already uses for a mechanism `flow-connect.test.ts`/`flow-utils.test.ts`
// cannot reach either (an AST rig over the `.tsx` source, `findFunction`,
// `findCalls`), not a fresh reinvention of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const path = new URL("../WorkflowFlowEditor.tsx", import.meta.url).pathname;
const source = readFileSync(path, "utf8");
const sf = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

function findFunction(name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  assert.ok(found, `function ${name} not found`);
  return found as ts.FunctionDeclaration;
}

/** Every `name(...)` call expression found anywhere inside `root`. */
function findCalls(root: ts.Node, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return calls;
}

const inner = findFunction("Inner");

test("U1 — `initial` still derives from workflowToFlow(value) alone, deps [value.id] (Trap 1 untouched)", () => {
  const initialCalls = findCalls(inner, "workflowToFlow");
  assert.equal(initialCalls.length, 1, "workflowToFlow must be called exactly once in Inner");
  assert.equal(
    initialCalls[0].arguments.length,
    1,
    "workflowToFlow must be called with exactly ONE argument (value) — never runState",
  );
  assert.equal(initialCalls[0].arguments[0].getText(sf), "value");
});

test("U2 — a useEffect depends on runState and patches BOTH setNodes and setEdges (the live repaint)", () => {
  // Find every `useEffect(fn, deps)` call in Inner whose deps array mentions
  // `runState` by name.
  const effectCalls = findCalls(inner, "useEffect").filter((c) => {
    const deps = c.arguments[1];
    return (
      deps &&
      ts.isArrayLiteralExpression(deps) &&
      deps.elements.some((e) => e.getText(sf) === "runState")
    );
  });
  assert.equal(
    effectCalls.length,
    1,
    "exactly one useEffect must declare `runState` as a dependency",
  );
  const body = effectCalls[0].arguments[0];
  assert.ok(body, "the runState effect must have a callback body");
  const bodyText = body.getText(sf);
  assert.match(bodyText, /setNodes\(/, "the runState effect must call setNodes");
  assert.match(bodyText, /setEdges\(/, "the runState effect must call setEdges");
  // Must derive from the pure module, not reimplement the mapping inline.
  assert.match(bodyText, /stepVisualState\(/, "must derive node status via stepVisualState");
  assert.match(bodyText, /edgeRunState\(/, "must derive edge run state via edgeRunState");
});

test("U3 — the runState effect never assigns `data.step` or `data.when` (A6 — nothing run-related is persisted)", () => {
  const effectCalls = findCalls(inner, "useEffect").filter((c) => {
    const deps = c.arguments[1];
    return (
      deps &&
      ts.isArrayLiteralExpression(deps) &&
      deps.elements.some((e) => e.getText(sf) === "runState")
    );
  });
  const bodyText = effectCalls[0]?.arguments[0]?.getText(sf) ?? "";
  assert.doesNotMatch(
    bodyText,
    /\bstep:\s*/,
    "the runState effect must never write a `step` key onto node data",
  );
  assert.doesNotMatch(
    bodyText,
    /\bwhen:\s*/,
    "the runState effect must never write a `when` key onto edge data",
  );
});

test("U4 — StepNodeCard and ControlNodeCard both derive their border from stepNodeVisual", () => {
  for (const name of ["StepNodeCard", "ControlNodeCard"]) {
    const fn = findFunction(name);
    assert.match(
      fn.getText(sf),
      /stepNodeVisual\(/,
      `${name} must derive its run-aware visual via stepNodeVisual`,
    );
  }
});
