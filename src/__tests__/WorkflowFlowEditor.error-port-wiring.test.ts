// Run: node --test src/__tests__/WorkflowFlowEditor.error-port-wiring.test.ts  (Node 24, type-stripped)
//
// A structural gate pins a mechanism's SHAPE, never that it works — that's what
// `flow-connect.test.ts` / `flow-utils.test.ts` are for. This file pins the shape
// the pure tests cannot reach, inside the `.tsx`: that every minting site actually
// derives its lane from `laneForSourceHandle` rather than defaulting to "success",
// and that both node kinds render the error exit port through the one shared
// `PortHandle` component. Mirrors the AST rig verbatim from
// `WorkflowFlowEditor.step-builder-wiring.test.ts` (`ts.createSourceFile` over the
// .tsx source, a `findFunction(name)` walker, assertions on the JSX/call nodes).
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

/**
 * The body of a `const <name> = useCallback(fn, deps)` binding declared
 * anywhere inside `root` — narrows the AST search to exactly one callback
 * (`onConnect`, `onConnectEnd`, `addBuiltStep`) instead of scanning the whole
 * 2000+-line component, so a call with the same name inside an unrelated
 * callback can't false-positive the assertion.
 */
function findCallbackBody(root: ts.Node, name: string): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sf) === "useCallback"
    ) {
      found = node.initializer.arguments[0];
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  assert.ok(found, `useCallback-bound '${name}' not found`);
  return found as ts.Node;
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

/** Whether `fnName`'s body renders a `<PortHandle>` whose `id` attribute mentions `ERROR_SOURCE_HANDLE`. */
function hasErrorPortHandle(fnName: string): boolean {
  const fn = findFunction(fnName);
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sf) === "PortHandle"
    ) {
      const idAttr = node.attributes.properties.find(
        (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "id",
      );
      if (idAttr && ts.isJsxAttribute(idAttr) && idAttr.initializer) {
        const text = ts.isJsxExpression(idAttr.initializer)
          ? (idAttr.initializer.expression?.getText(sf) ?? "")
          : idAttr.initializer.getText(sf);
        if (/ERROR_SOURCE_HANDLE/.test(text)) found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

// The JSX/callbacks all live in `Inner` (WorkflowFlowEditor wraps it in
// <ReactFlowProvider><Inner/></ReactFlowProvider>) — same as the exemplar.
const inner = findFunction("Inner");

test("U6 — onConnect derives the lane via laneForSourceHandle and passes it to BOTH applyConnect and connectConflict", () => {
  const onConnectBody = findCallbackBody(inner, "onConnect");

  const applyConnectCalls = findCalls(onConnectBody, "applyConnect");
  assert.equal(applyConnectCalls.length, 1, "onConnect must call applyConnect exactly once");
  assert.equal(applyConnectCalls[0].arguments.length, 5, "applyConnect must receive 5 arguments");
  assert.match(
    applyConnectCalls[0].arguments[4].getText(sf),
    /laneForSourceHandle/,
    "applyConnect's 5th argument must derive from laneForSourceHandle",
  );

  const connectConflictCalls = findCalls(onConnectBody, "connectConflict");
  assert.equal(
    connectConflictCalls.length,
    1,
    "onConnect's failure branch must call connectConflict exactly once",
  );
  assert.equal(
    connectConflictCalls[0].arguments.length,
    5,
    "connectConflict must receive 5 arguments",
  );
  assert.match(
    connectConflictCalls[0].arguments[4].getText(sf),
    /laneForSourceHandle/,
    "connectConflict's 5th argument must derive from laneForSourceHandle",
  );
});

test("U7 — onConnectEnd captures the lane on pendingConnect, and addBuiltStep threads it through applyConnect", () => {
  const onConnectEndBody = findCallbackBody(inner, "onConnectEnd");
  const setPendingConnectCalls = findCalls(onConnectEndBody, "setPendingConnect").filter(
    (c) => c.arguments[0] && ts.isObjectLiteralExpression(c.arguments[0]),
  );
  assert.equal(
    setPendingConnectCalls.length,
    1,
    "onConnectEnd must call setPendingConnect({...}) exactly once",
  );
  const obj = setPendingConnectCalls[0].arguments[0] as ts.ObjectLiteralExpression;
  const laneLike = obj.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      /laneForSourceHandle|fromHandle/.test(p.initializer.getText(sf)),
  );
  assert.ok(
    laneLike,
    "the pendingConnect object literal must carry a property derived from laneForSourceHandle/fromHandle",
  );

  const addBuiltStepBody = findCallbackBody(inner, "addBuiltStep");
  const applyConnectCalls = findCalls(addBuiltStepBody, "applyConnect");
  // addBuiltStep also auto-wires a spawned step to the current chain
  // root/tail when it wasn't dragged from an existing connection (chain
  // auto-wiring, 2026-08-30) — those calls are plain (no explicit lane,
  // defaulting to "success") and are not this test's concern. Scope to the
  // ONE call that must carry the captured drag lane: the pendingConnect
  // branch's own applyConnect(source, target, nextNodes, edges, <lane>).
  const laneThreadedCalls = applyConnectCalls.filter(
    (c) => c.arguments.length === 5 && /pendingConnect/.test(c.arguments[4].getText(sf)),
  );
  assert.equal(
    laneThreadedCalls.length,
    1,
    "addBuiltStep must call applyConnect with the captured pendingConnect lane exactly once",
  );
  // A literal `"success"` in this position must fail — the assertion is on
  // the TEXT mentioning `pendingConnect`, not merely on the argument count.
  assert.match(
    laneThreadedCalls[0].arguments[4].getText(sf),
    /pendingConnect/,
    "applyConnect's 5th argument must come from the captured pendingConnect lane",
  );
});

test("U8 — StepNodeCard renders a <PortHandle> carrying id={ERROR_SOURCE_HANDLE}", () => {
  assert.ok(
    hasErrorPortHandle("StepNodeCard"),
    "StepNodeCard must render the error exit port via the shared PortHandle component",
  );
});

test("U9 — ControlNodeCard renders a <PortHandle> carrying id={ERROR_SOURCE_HANDLE}", () => {
  assert.ok(
    hasErrorPortHandle("ControlNodeCard"),
    "ControlNodeCard must render the error exit port via the shared PortHandle component",
  );
});
