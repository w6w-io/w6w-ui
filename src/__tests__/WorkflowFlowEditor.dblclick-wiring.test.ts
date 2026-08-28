// Run: node --test src/__tests__/WorkflowFlowEditor.dblclick-wiring.test.ts  (Node 24, type-stripped)
//
// R2: the mechanism moved off React Flow's `onNodeDoubleClick` prop (round 1 —
// it fires on React's root container, strictly AFTER the pane's own bubble-phase
// `dblclick.zoom` listener, so it could never suppress a zoom) onto a
// capture-phase native `dblclick` listener on the flow container div. These
// cases pin THAT mechanism: no leftover prop, a matched add/remove pair, the
// empty-pane no-op guard, and — the round-1 gate gap — that nothing can be
// smuggled between `stopPropagation()` and `onEdit(id)` (an M8-equivalent
// `if (readOnly) return;` insertion there now fails case 5 below).
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

// The JSX lives in `Inner` (WorkflowFlowEditor wraps it in <ReactFlowProvider><Inner/></ReactFlowProvider>).
const inner = findFunction("Inner");

function findReactFlowElement(): ts.JsxSelfClosingElement | ts.JsxOpeningElement {
  let el: ts.JsxSelfClosingElement | ts.JsxOpeningElement | undefined;
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sf) === "ReactFlow"
    )
      el = node;
    if (!el) ts.forEachChild(node, visit);
  };
  ts.forEachChild(inner, visit);
  assert.ok(el, "<ReactFlow> not found in Inner");
  return el as ts.JsxSelfClosingElement | ts.JsxOpeningElement;
}

function findFlowContainerDiv(): ts.JsxOpeningElement {
  let el: ts.JsxOpeningElement | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.getText(sf) === "className" &&
          a.initializer &&
          ts.isStringLiteral(a.initializer) &&
          a.initializer.text === "w6w-flow",
      )
    )
      el = node;
    if (!el) ts.forEachChild(node, visit);
  };
  ts.forEachChild(inner, visit);
  assert.ok(el, 'the flow container div (className="w6w-flow") not found in Inner');
  return el as ts.JsxOpeningElement;
}

// The `useEffect` that registers the "dblclick" listener — found by content, not
// position, since it's not the only effect in `Inner`.
function findDblclickEffect(): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === "useEffect" &&
      /addEventListener\(\s*["']dblclick["']/.test(node.getText(sf))
    )
      found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(inner, visit);
  assert.ok(found, "no useEffect registering a dblclick listener found in Inner");
  return found as ts.CallExpression;
}

function findMethodCall(root: ts.Node, methodName: string): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === methodName
    )
      found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  assert.ok(found, `${methodName}(...) call not found`);
  return found as ts.CallExpression;
}

// The listener function itself: `addEventListener`'s 2nd argument is a bare
// identifier resolved back to its `const <name> = (event) => {...}` declaration
// inside the same effect body.
function findHandlerBody(effect: ts.CallExpression): ts.Block {
  const add = findMethodCall(effect, "addEventListener");
  const handlerArg = add.arguments[1];
  assert.ok(
    handlerArg && ts.isIdentifier(handlerArg),
    "addEventListener's listener argument must be a named identifier, not an inline function",
  );
  const name = (handlerArg as ts.Identifier).text;
  let decl: ts.ArrowFunction | ts.FunctionExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      decl = node.initializer as ts.ArrowFunction | ts.FunctionExpression;
    if (!decl) ts.forEachChild(node, visit);
  };
  ts.forEachChild(effect, visit);
  assert.ok(decl, `listener function "${name}" not declared inside the same effect`);
  const body = (decl as ts.ArrowFunction | ts.FunctionExpression).body;
  assert.ok(ts.isBlock(body), "listener body must be a block");
  return body as ts.Block;
}

test("<ReactFlow> in Inner no longer carries an onNodeDoubleClick prop", () => {
  const el = findReactFlowElement();
  const attr = el.attributes.properties.find(
    (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "onNodeDoubleClick",
  );
  assert.equal(
    attr,
    undefined,
    "onNodeDoubleClick can no longer fire before the pane's dblclick.zoom listener — the prop must be removed, not left as dead code",
  );
});

test("the flow container div's ref is the same ref the capture listener reads .current from", () => {
  const div = findFlowContainerDiv();
  const refAttr = div.attributes.properties.find(
    (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "ref",
  );
  assert.ok(refAttr, 'the "w6w-flow" div must carry a ref');
  const refExprText =
    refAttr &&
    ts.isJsxAttribute(refAttr) &&
    refAttr.initializer &&
    ts.isJsxExpression(refAttr.initializer)
      ? (refAttr.initializer.expression?.getText(sf) ?? "")
      : "";
  assert.ok(refExprText.length > 0, "ref attribute must have an expression");

  const effect = findDblclickEffect();
  assert.match(
    effect.getText(sf),
    new RegExp(`${refExprText}\\.current`),
    "the effect must read .current off the SAME ref the container div carries",
  );
});

test("a capture-phase dblclick listener is added and removed as a matched pair", () => {
  const effect = findDblclickEffect();
  const callback = effect.arguments[0];
  assert.ok(callback && ts.isArrowFunction(callback), "useEffect must take an arrow function");
  const body = (callback as ts.ArrowFunction).body;
  assert.ok(ts.isBlock(body), "effect callback body must be a block");

  const add = findMethodCall(body as ts.Block, "addEventListener");
  assert.equal((add.arguments[0] as ts.StringLiteral).text, "dblclick");
  assert.equal(
    add.arguments[2]?.getText(sf),
    "true",
    "must be registered on the CAPTURE phase — that's the only ordering that runs before the pane's own bubble-phase dblclick.zoom listener",
  );
  const handlerName = (add.arguments[1] as ts.Identifier).text;
  const receiver = (add.expression as ts.PropertyAccessExpression).expression;
  assert.equal(
    receiver.getText(sf),
    "div",
    "must register on the flow container div, not some other element (e.g. document)",
  );

  const ret = (body as ts.Block).statements.find((s) => ts.isReturnStatement(s));
  assert.ok(ret, "the effect must return a cleanup function");
  const cleanupExpr = (ret as ts.ReturnStatement).expression;
  assert.ok(
    cleanupExpr && (ts.isArrowFunction(cleanupExpr) || ts.isFunctionExpression(cleanupExpr)),
    "the cleanup must be a function",
  );
  const remove = findMethodCall(cleanupExpr as ts.Node, "removeEventListener");
  assert.equal((remove.arguments[0] as ts.StringLiteral).text, "dblclick");
  assert.equal(
    remove.arguments[2]?.getText(sf),
    "true",
    "cleanup must remove the SAME (capture) listener it added",
  );
  assert.equal(
    (remove.arguments[1] as ts.Identifier).text,
    handlerName,
    "cleanup must remove the exact function identity that was added — a matched pair, not just any cleanup",
  );
  const removeReceiver = (remove.expression as ts.PropertyAccessExpression).expression;
  assert.equal(
    removeReceiver.getText(sf),
    receiver.getText(sf),
    "cleanup must remove the listener from the SAME receiver it was added on — a real leak (add on document, remove on div) must fail here",
  );
});

test("the listener no-ops when the dblclick did not land on a node card (empty-pane zoom stays untouched)", () => {
  const effect = findDblclickEffect();
  const body = findHandlerBody(effect);
  const stmts = body.statements;

  const first = stmts[0];
  assert.ok(first && ts.isVariableStatement(first), "first statement must locate the node card");
  assert.match(first.getText(sf), /closest\(\s*["']\.react-flow__node["']\s*\)/);

  const second = stmts[1];
  assert.ok(
    second && ts.isIfStatement(second) && /return/.test(second.getText(sf)),
    "second statement must be an early return when no card was hit",
  );
});

test("stopPropagation() is immediately followed by onEdit(id) — nothing can be smuggled between them (kills a readOnly early-return mutant)", () => {
  const effect = findDblclickEffect();
  const body = findHandlerBody(effect);
  const stmts = body.statements;

  const stopIdx = stmts.findIndex(
    (s) => ts.isExpressionStatement(s) && /\.stopPropagation\(\)/.test(s.getText(sf)),
  );
  assert.notEqual(stopIdx, -1, "handler must call .stopPropagation()");
  const stopExpr = (stmts[stopIdx] as ts.ExpressionStatement).expression;
  assert.ok(ts.isCallExpression(stopExpr));
  const stopCallee = (stopExpr as ts.CallExpression).expression;
  assert.ok(ts.isPropertyAccessExpression(stopCallee));
  assert.equal(stopCallee.name.text, "stopPropagation");

  const nextStmt = stmts[stopIdx + 1];
  assert.ok(nextStmt, "a statement must immediately follow stopPropagation()");
  assert.ok(
    ts.isExpressionStatement(nextStmt) && ts.isCallExpression(nextStmt.expression),
    "the statement right after stopPropagation() must itself be a call — not a conditional (e.g. a smuggled `if (readOnly) return;`)",
  );
  const nextCallee = (nextStmt.expression as ts.CallExpression).expression;
  assert.ok(ts.isPropertyAccessExpression(nextCallee));
  assert.equal(nextCallee.name.text, "onEdit");

  assert.equal(
    stmts.length,
    stopIdx + 2,
    "onEdit(id) must be the LAST statement in the handler — no trailing statement (e.g. a readOnly guard) may follow it either",
  );
});

test("onEdit is called on the controls object (the pencil button's own path) with the card's data-id", () => {
  const effect = findDblclickEffect();
  const body = findHandlerBody(effect);
  const stmts = body.statements;

  const idDecl = stmts.find(
    (s) => ts.isVariableStatement(s) && /getAttribute\(\s*["']data-id["']\s*\)/.test(s.getText(sf)),
  );
  assert.ok(idDecl, "handler must read the node id from the card's data-id attribute");
  const idName = (
    (idDecl as ts.VariableStatement).declarationList.declarations[0].name as ts.Identifier
  ).text;

  let onEditCall: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "onEdit"
    )
      onEditCall = node;
    if (!onEditCall) ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  assert.ok(onEditCall, "handler must call onEdit");
  const call = onEditCall as ts.CallExpression;
  const receiver = (call.expression as ts.PropertyAccessExpression).expression;
  assert.equal(
    receiver.getText(sf),
    "controls",
    "must call onEdit via the SAME controls object the pencil button uses — no second code path",
  );
  assert.equal(
    call.arguments[0]?.getText(sf),
    idName,
    "must pass the id read from the card's data-id, not a different value",
  );
});
