// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/resolve-params.test.ts  (Node 24)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ResolveScope,
  buildResolveScope,
  deepEqual,
  resolveParamValue,
} from "../resolve-params.ts";

const emptyScope: ResolveScope = { vars: {}, documents: {}, steps: {}, trigger: {} };

test("A1/A2 — a plain literal resolves to one 'resolved' segment, value unknown-typed", () => {
  assert.deepStrictEqual(resolveParamValue("Hello", emptyScope), [
    { status: "resolved", value: "Hello" },
  ]);
  assert.deepStrictEqual(resolveParamValue(42, emptyScope), [{ status: "resolved", value: 42 }]);
});

test("A2 — a literal null/''/false/0 is 'resolved', never blank/absent (incl. explicitly-null)", () => {
  assert.deepStrictEqual(resolveParamValue(null, emptyScope), [
    { status: "resolved", value: null },
  ]);
  assert.deepStrictEqual(resolveParamValue("", emptyScope), [{ status: "resolved", value: "" }]);
  assert.deepStrictEqual(resolveParamValue(false, emptyScope), [
    { status: "resolved", value: false },
  ]);
  assert.deepStrictEqual(resolveParamValue(0, emptyScope), [{ status: "resolved", value: 0 }]);
});

test("M5 guard — a `var` ref present in scope holding null/''/false/0 is 'resolved', not 'unresolved'", () => {
  const scope: ResolveScope = {
    vars: { a: null, b: "", c: false, d: 0 },
    documents: {},
    steps: {},
    trigger: {},
  };
  for (const [name, expected] of [
    ["a", null],
    ["b", ""],
    ["c", false],
    ["d", 0],
  ] as const) {
    const seg = resolveParamValue(
      { type: "expr", parts: [{ kind: "var", ref: `vars.${name}` }] },
      scope,
    );
    assert.deepStrictEqual(seg, [{ status: "resolved", ref: `vars.${name}`, value: expected }]);
  }
});

test("A2/M1/M2 guard — an absent `var` ref is 'unresolved': no `value`, never the ref/template as a value", () => {
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "vars.missing_var" }] },
    emptyScope,
  );
  // Exact shape (deepStrictEqual — an extra `value` key, or a `value` holding
  // the ref/`{{ }}` template text, both fail this): only `status` + `ref`.
  assert.deepStrictEqual(seg, [{ status: "unresolved", ref: "vars.missing_var" }]);
  assert.equal("value" in seg[0], false, "an unresolved segment must carry no value at all");
});

test("M1 guard — 'unresolved' and 'resolved to empty' are different shapes, not the same segment", () => {
  const scope: ResolveScope = {
    vars: { present_empty: "" },
    documents: {},
    steps: {},
    trigger: {},
  };
  const resolvedEmpty = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "vars.present_empty" }] },
    scope,
  );
  const unresolved = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "vars.absent" }] },
    scope,
  );
  assert.notDeepStrictEqual(resolvedEmpty, unresolved);
  assert.equal(resolvedEmpty[0].status, "resolved");
  assert.equal(unresolved[0].status, "unresolved");
});

test("A3/M3 guard — a raw `expr` part is 'not-evaluated', a status distinct from 'unresolved'", () => {
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "expr", expr: { var: "vars.x" } }] },
    emptyScope,
  );
  assert.deepStrictEqual(seg, [{ status: "not-evaluated" }]);
});

test("M14 guard — a `render` part is 'not-evaluated', never silently 'resolved' with an undefined value", () => {
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "render", ref: "documents.a.body" }] },
    emptyScope,
  );
  // Without `case "render":`, the `default:` arm reports `{status:"resolved",
  // value: undefined}` — a blank that LOOKS correct in the Test tab. Assert
  // the exact shape (deepStrictEqual), same as the `expr` guard above it.
  assert.deepStrictEqual(seg, [{ status: "not-evaluated" }]);
});

test("M4 guard — the dot-path walk resolves a two-level-deep `steps.<id>.output.<obj>.<key>` ref", () => {
  const scope = buildResolveScope(undefined, {
    steps: { gate_1: { output: { addr: { city: "NYC" } } } },
  });
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "steps.gate_1.output.addr.city" }] },
    scope,
  );
  assert.deepStrictEqual(seg, [
    { status: "resolved", ref: "steps.gate_1.output.addr.city", value: "NYC" },
  ]);
});

test("M4 guard — a shallower sibling ref on the same nested object still resolves independently", () => {
  const scope = buildResolveScope(undefined, {
    steps: { gate_1: { output: { addr: { city: "NYC", zip: "10001" } } } },
  });
  const city = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "steps.gate_1.output.addr.zip" }] },
    scope,
  );
  assert.deepStrictEqual(city, [
    { status: "resolved", ref: "steps.gate_1.output.addr.zip", value: "10001" },
  ]);
});

test("M6 guard — a multipart ExprValue yields ONE segment per part, not a collapsed single result", () => {
  const seg = resolveParamValue(
    {
      type: "expr",
      parts: [
        { kind: "text", value: "Hi " },
        { kind: "var", ref: "vars.missing" }, // unresolved, sandwiched between resolved parts
        { kind: "text", value: ", welcome" },
      ],
    },
    emptyScope,
  );
  assert.equal(seg.length, 3, "one segment per part — an unresolved part must stay visible");
  assert.deepStrictEqual(seg[0], { status: "resolved", value: "Hi " });
  assert.deepStrictEqual(seg[1], { status: "unresolved", ref: "vars.missing" });
  assert.deepStrictEqual(seg[2], { status: "resolved", value: ", welcome" });
});

test("M7 guard — a SecretValue envelope is 'masked', never its ciphertext, never blank", () => {
  const seg = resolveParamValue(
    { type: "secret", ciphertext: "c1phert3xt", iv: "iviv" },
    emptyScope,
  );
  assert.deepStrictEqual(seg, [{ status: "masked" }]);
  assert.equal(JSON.stringify(seg).includes("c1phert3xt"), false);
});

test("M7 guard — a named `secret` part is 'masked' by ref, never resolved/looked up", () => {
  const scope: ResolveScope = { vars: {}, documents: {}, steps: {}, trigger: {} };
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "secret", ref: "api_key" }] },
    scope,
  );
  assert.deepStrictEqual(seg, [{ status: "masked", ref: "api_key" }]);
});

test("A4/M8 guard — a hand-authored `{ $: path }` marker resolves as a ref, not a literal object", () => {
  const scope: ResolveScope = { vars: { name: "Ada" }, documents: {}, steps: {}, trigger: {} };
  const resolved = resolveParamValue({ $: "vars.name" }, scope);
  assert.deepStrictEqual(resolved, [{ status: "resolved", ref: "vars.name", value: "Ada" }]);

  const unresolved = resolveParamValue({ $: "vars.missing" }, scope);
  assert.deepStrictEqual(unresolved, [{ status: "unresolved", ref: "vars.missing" }]);
});

test("A4/M8 guard — a hand-authored `{ $expr: <logic> }` marker is 'not-evaluated', not a literal object", () => {
  const seg = resolveParamValue({ $expr: { "==": [1, 1] } }, emptyScope);
  assert.deepStrictEqual(seg, [{ status: "not-evaluated" }]);
});

test("A4 — an object with `$` plus other keys is NOT the marker (falls through as a literal)", () => {
  const value = { $: "vars.name", extra: 1 };
  const seg = resolveParamValue(value, emptyScope);
  assert.deepStrictEqual(seg, [{ status: "resolved", value }]);
});

test("A5 — a `vars`-row's own value resolves exactly like any other param value", () => {
  const scope: ResolveScope = {
    vars: { from: "hi@example.com" },
    documents: {},
    steps: {},
    trigger: {},
  };
  const row = {
    key: "sender",
    type: "string" as const,
    value: { type: "expr" as const, parts: [{ kind: "var" as const, ref: "vars.from" }] },
  };
  assert.deepStrictEqual(resolveParamValue(row.value, scope), [
    { status: "resolved", ref: "vars.from", value: "hi@example.com" },
  ]);
  const literalRow = { key: "count", type: "number" as const, value: 3 };
  assert.deepStrictEqual(resolveParamValue(literalRow.value, scope), [
    { status: "resolved", value: 3 },
  ]);
});

test("buildResolveScope — vars/documents rebuilt from the flat sampleValues map, prefix stripped", () => {
  const scope = buildResolveScope(
    {
      "vars.from_email": "a@b.com",
      "documents.contract": { signed: true },
      "steps.x.output": "ignored",
    },
    undefined,
  );
  assert.deepStrictEqual(scope.vars, { from_email: "a@b.com" });
  assert.deepStrictEqual(scope.documents, { contract: { signed: true } });
  // A `steps.*`/`trigger.*` entry in sampleValues is NOT pulled in — scope
  // fidelity: those come from testStartState only (A2).
  assert.deepStrictEqual(scope.steps, {});
});

test("buildResolveScope — a document FIELD-level sample (documents.<key>.<field>) resolves, not 'unresolved'", () => {
  // Reproduces a real, user-hit bug: `documentSampleValues` emits
  // "documents.<key>.<field>" as its OWN flat entry (not nested under
  // "documents.<key>"), which the one-hop prefix-strip below turns into a
  // single literal key "confirmation-email.subject" holding the field value —
  // while "confirmation-email" ALSO exists as a separate key holding the raw
  // content string. `walkPath`'s segment-by-segment walk for
  // "documents.confirmation-email.subject" hops into that raw STRING at
  // "confirmation-email" and can go no further, reporting "unresolved" for a
  // value that plainly exists.
  const scope = buildResolveScope(
    {
      "documents.confirmation-email": 'subject: "Your order is confirmed"\nbody: |\n  Hi...',
      "documents.confirmation-email.subject": "Your order is confirmed",
      "documents.confirmation-email.body": "Hi {{customer_name}}, ...",
    },
    undefined,
  );
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "documents.confirmation-email.subject" }] },
    scope,
  );
  assert.deepStrictEqual(seg, [
    {
      status: "resolved",
      ref: "documents.confirmation-email.subject",
      value: "Your order is confirmed",
    },
  ]);
  const bodySeg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "documents.confirmation-email.body" }] },
    scope,
  );
  assert.deepStrictEqual(bodySeg, [
    {
      status: "resolved",
      ref: "documents.confirmation-email.body",
      value: "Hi {{customer_name}}, ...",
    },
  ]);
  // The bare whole-document ref still resolves too — the fix must not break it.
  const bareSeg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "documents.confirmation-email" }] },
    scope,
  );
  assert.deepStrictEqual(bareSeg, [
    {
      status: "resolved",
      ref: "documents.confirmation-email",
      value: 'subject: "Your order is confirmed"\nbody: |\n  Hi...',
    },
  ]);
});

test("buildResolveScope — a var/document holding an object still dot-walks past the reconstructed hop", () => {
  const scope = buildResolveScope({ "vars.address": { city: "NYC" } }, undefined);
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "vars.address.city" }] },
    scope,
  );
  assert.deepStrictEqual(seg, [{ status: "resolved", ref: "vars.address.city", value: "NYC" }]);
});

test("buildResolveScope — steps/trigger come from testStartState, default to empty when absent", () => {
  const scope = buildResolveScope(undefined, undefined);
  assert.deepStrictEqual(scope.steps, {});
  assert.deepStrictEqual(scope.trigger, {});

  const withTrigger = buildResolveScope(undefined, { trigger: { event: { id: 1 } } });
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "trigger.event.id" }] },
    withTrigger,
  );
  assert.deepStrictEqual(seg, [{ status: "resolved", ref: "trigger.event.id", value: 1 }]);
});

test("A1/A2 — deepEqual: primitives, incl. both-undefined (a param with neither a value nor a default)", () => {
  assert.equal(deepEqual(undefined, undefined), true);
  assert.equal(deepEqual(false, false), true);
  assert.equal(deepEqual("", ""), true);
  assert.equal(deepEqual(0, 0), true);
  assert.equal(deepEqual(null, undefined), false);
  assert.equal(deepEqual("a", "b"), false);
});

test("D-1 guard — a value explicitly present in `with` and equal to its default is 'unchanged' (deep-equal, not presence)", () => {
  // Mirrors the effective-value computation `ResolvedParams` already does:
  // `values[key] !== undefined ? values[key] : param.default`. A key
  // EXPLICITLY present in `with`, equal to the default, must still read as
  // unchanged — a presence-only mutation (M1) would keep it visible instead.
  const values: Record<string, unknown> = { dynamic_template: false };
  const effective = values.dynamic_template !== undefined ? values.dynamic_template : true;
  assert.equal(deepEqual(effective, false), true);
});

test("M2 guard — deep-equal, not `===`: {} vs {} and [] vs [] are equal despite distinct references", () => {
  assert.equal(deepEqual({}, {}), true);
  assert.equal(deepEqual([], []), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual([1, [2, 3]], [1, [2, 3]]), true);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
});

test("dot-path walk — a hop into null/undefined never yields a value, only 'unresolved'", () => {
  const scope: ResolveScope = { vars: { obj: null }, documents: {}, steps: {}, trigger: {} };
  const seg = resolveParamValue(
    { type: "expr", parts: [{ kind: "var", ref: "vars.obj.deeper" }] },
    scope,
  );
  assert.deepStrictEqual(seg, [{ status: "unresolved", ref: "vars.obj.deeper" }]);
});
