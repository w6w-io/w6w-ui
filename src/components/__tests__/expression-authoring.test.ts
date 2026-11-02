import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReadableExpression } from "@w6w/expr";
import type { ExprPart } from "../../types.ts";
import {
  authoredReferences,
  compileAuthoredParts,
  previewAuthoredParts,
} from "../expression-authoring.ts";
import { partsToValue, valueToParts } from "../expression-template.ts";

const options = { steps: [{ id: "order_merge" }], vars: ["minimum"], constants: ["source"] };
const ref = "nodes.order_merge.output.order.context.source";
const seeds = {
  "nodes.order_merge.output": { order: { context: { source: "eventbrite" }, count: 3 } },
};
const text = (value: string): ExprPart[] => [{ kind: "text", value }];

test("typing, existing broken chips, markers and chip-plus-comparison all compile to the same value", () => {
  const cases: ExprPart[][] = [
    text('order_merge.order.context.source == "eventbrite"'),
    text('{{ order_merge.order.context.source == "eventbrite" }}'),
    text(`${ref} == 'eventbrite'`),
    text(`{{ ${ref} == 'eventbrite' }}`),
    [{ kind: "var", ref: `${ref} == 'eventbrite'` }],
    [{ kind: "var", ref }, ...text(' == "eventbrite"')],
  ];
  for (const input of cases) {
    const result = compileAuthoredParts(input, options);
    assert.equal(result.error, null);
    assert.deepEqual(result.parts, [
      { kind: "expr", expr: { "==": [{ var: ref }, "eventbrite"] } },
    ]);
    assert.equal(previewAuthoredParts(result.parts, seeds), "true");
    assert.equal(previewAuthoredParts(result.parts, seeds, { [ref]: "cohost" }), "false");
    assert.deepEqual(authoredReferences(result.parts), [ref]);
    const saved = partsToValue(result.parts);
    const reopened = valueToParts(saved).parts;
    assert.deepEqual(reopened, result.parts);
    assert.equal(formatReadableExpression(reopened[0].expr), `${ref} == "eventbrite"`);
  }
});

test("typed samples preserve numbers, booleans, null and strings and never mutate host data", () => {
  const raw = structuredClone(seeds);
  const { parts } = compileAuthoredParts(
    text("order_merge.order.count >= minimum && state.enabled === true"),
    options,
  );
  const sample = { ...raw, "var.minimum": 2, "state.enabled": true };
  assert.equal(previewAuthoredParts(parts, sample), "true");
  assert.equal(previewAuthoredParts(parts, sample, { "var.minimum": "4" }), "false");
  assert.deepEqual(raw, seeds);
  const rule = compileAuthoredParts(text('state.value === "123"'), options).parts;
  assert.equal(previewAuthoredParts(rule, { "state.value": "123" }), "true");
  assert.equal(previewAuthoredParts(rule, { "state.value": 123 }), "false");
  assert.equal(
    previewAuthoredParts(compileAuthoredParts(text("state.missing == null"), options).parts, {}),
    "true",
  );
});

test("comparison chains inside markers compile even after legacy chip promotion", () => {
  const source =
    '{{ nodes.order_merge.output.order.context.source == "eventbrite" || state.enabled == true }}';
  for (const input of [text(source), valueToParts(source).parts]) {
    const compiled = compileAuthoredParts(input, options);
    assert.equal(compiled.error, null);
    assert.equal(previewAuthoredParts(compiled.parts, seeds), "true");
    assert.equal(previewAuthoredParts(compiled.parts, { "state.enabled": false }), "false");
    assert.deepEqual(authoredReferences(compiled.parts), [ref, "state.enabled"]);
  }
  const literal = compileAuthoredParts(text("1 == 2"), options);
  assert.equal(literal.error, null);
  assert.equal(previewAuthoredParts(literal.parts), "false");
});

test("malformed conditions have a useful error instead of becoming missing-field references", () => {
  for (const source of [
    "order_merge.order.count ==",
    "state.x = 1",
    "state.x == eventbrite",
    "state.x == 'bad",
    "state.x.toString() == 'x'",
  ]) {
    assert.ok(compileAuthoredParts(text(source), options).error, source);
  }
  assert.match(
    compileAuthoredParts(text('source == "x"'), { ...options, vars: ["source"] }).error ?? "",
    /ambiguous/,
  );
  assert.match(compileAuthoredParts(text('secrets.token == "x"'), options).error ?? "", /Secrets/);
  assert.match(
    compileAuthoredParts([{ kind: "secret", ref: "token" }, ...text(' == "x"')], options).error ??
      "",
    /Secrets/,
  );
});

test("ordinary text, vendor placeholders, mixed templates, secrets and render parts stay unchanged", () => {
  const cases: ExprPart[][] = [
    text("Hello world!"),
    text("{{customer.name}}"),
    text("<div>{{ nodes.order_merge.output.order }}</div>"),
    [...text("Hi "), { kind: "var", ref }, ...text("!")],
    [{ kind: "var", ref }, ...text("!")],
    [{ kind: "var", ref: "var.baseUrl" }, ...text("?token=abc")],
    [{ kind: "var", ref }, ...text("<br>more")],
    [{ kind: "var", ref }, ...text(" is <something>")],
    [{ kind: "secret", ref: "TOKEN" }],
    [{ kind: "render", ref: "documents.template" }],
  ];
  for (const parts of cases)
    assert.deepEqual(compileAuthoredParts(parts, options), { parts, error: null });
  const legacy: ExprPart[] = [{ kind: "expr", expr: { in: ["a", { var: "state.names" }] } }];
  assert.deepEqual(compileAuthoredParts(legacy, options), { parts: legacy, error: null });
});
