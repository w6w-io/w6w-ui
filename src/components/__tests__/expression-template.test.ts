// Run: node --test src/components/__tests__/expression-template.test.ts  (Node 24, type-stripped)
//
// The `{{ }}` GRAMMAR (parse/serialize) now lives in `@w6w/expr` and is tested
// there: core/packages/expr/tests/template.test.ts. What remains here is the
// editor-only surface this module keeps — `renderResult` (the preview policy
// that masks secrets as `•••`), `partsToValue`, `valueToParts`, and (T1.2.2,
// CONDUCTOR AMENDMENT 2026-08-14) `parseRootAnchoredTemplate` — the
// root-anchored parse `valueToParts`'s string arm and the modal's chip-ify
// commit paths both apply.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import type { ExprPart, ExprValue, SecretValue } from "../../types.ts";
import { paintParts, readParts } from "../expression-dom.ts";
import {
  RUN_SCOPE_ROOT_NAMES,
  parseRootAnchoredTemplate,
  partsToValue,
  renderResult,
  serializeTemplate,
  valueToParts,
} from "../expression-template.ts";

test("renderResult: var ref present in samples renders the value", () => {
  assert.equal(renderResult([{ kind: "var", ref: "vars.env" }], { "vars.env": "prod" }), "prod");
});

test("renderResult: var ref absent from samples renders empty string, not the {{ }} placeholder", () => {
  assert.equal(renderResult([{ kind: "var", ref: "steps.gate_1.output.first_name" }], {}), "");
});

test("renderResult: mixed text + present var + absent var", () => {
  assert.equal(
    renderResult(
      [
        { kind: "text", value: "Hi " },
        { kind: "var", ref: "vars.name" },
        { kind: "text", value: ", id " },
        { kind: "var", ref: "vars.missing" },
      ],
      { "vars.name": "Alex" },
    ),
    "Hi Alex, id ",
  );
});

test("renderResult: text parts concatenate literally", () => {
  assert.equal(
    renderResult(
      [
        { kind: "text", value: "Hello, " },
        { kind: "text", value: "world!" },
      ],
      {},
    ),
    "Hello, world!",
  );
});

test("renderResult: secret parts render masked, regardless of samples", () => {
  assert.equal(renderResult([{ kind: "secret", ref: "jwt_key" }], {}), "•••");
});

test("renderResult: a render part resolves through the SAME flat samples lookup as var — raw text, no {{ }} re-substitution (M6, A4c)", () => {
  // The sample's own value is itself a template string with a `{{ }}` marker
  // — proving renderResult does NOT try to substitute inside it (there is no
  // run scope at design time to substitute against; that is the engine's
  // `resolveRenderPart`, out of scope here).
  assert.equal(
    renderResult([{ kind: "render", ref: "documents.welcome.body" }], {
      "documents.welcome.body": "Hi {{ customer_name }}",
    }),
    "Hi {{ customer_name }}",
  );
});

test("renderResult: a render part absent from samples renders empty string, same as var", () => {
  assert.equal(renderResult([{ kind: "render", ref: "documents.a.body" }], {}), "");
});

test("renderResult: expr parts fall back to their {{ }} template form", () => {
  assert.equal(
    renderResult([{ kind: "expr", expr: { var: "vars.n" } }], {}),
    '{{ ={"var":"vars.n"} }}',
  );
});

// --- partsToValue / valueToParts: the editable ⇄ wire forms ------------------

test("partsToValue: prunes empty text and collapses a lone text part to a plain string", () => {
  assert.equal(partsToValue([]), "");
  assert.equal(partsToValue([{ kind: "text", value: "" }]), "");
  assert.equal(partsToValue([{ kind: "text", value: "plain" }]), "plain");
});

test("partsToValue: anything multipart becomes an ExprValue of wire parts", () => {
  assert.deepEqual(
    partsToValue([
      { kind: "text", value: "Bearer " },
      { kind: "secret", ref: "jwt" },
    ]),
    {
      type: "expr",
      parts: [
        { kind: "text", value: "Bearer " },
        { kind: "secret", ref: "jwt" },
      ],
    },
  );
});

test("valueToParts: a plain string with no {{ }} marker, an ExprValue, and a sealed secret", () => {
  assert.deepEqual(valueToParts("hi"), { parts: [{ kind: "text", value: "hi" }], sealed: null });
  assert.deepEqual(valueToParts(""), { parts: [], sealed: null });
  const v: ExprValue = { type: "expr", parts: [{ kind: "var", ref: "vars.env" }] };
  assert.deepEqual(valueToParts(v), { parts: [{ kind: "var", ref: "vars.env" }], sealed: null });
  const sealed: SecretValue = { type: "secret", ciphertext: "c", iv: "i" };
  assert.deepEqual(valueToParts(sealed), { parts: [], sealed });
});

test("partsToValue ∘ valueToParts round-trips a multipart value", () => {
  const v: ExprValue = {
    type: "expr",
    parts: [
      { kind: "text", value: "x=" },
      { kind: "var", ref: "vars.y" },
    ],
  };
  assert.deepEqual(partsToValue(valueToParts(v).parts), v);
});

test("the re-exported serializeTemplate is the one @w6w/expr defines", () => {
  const parts: ExprPart[] = [
    { kind: "text", value: "x=" },
    { kind: "var", ref: "vars.y" },
  ];
  assert.equal(serializeTemplate(parts), "x={{ vars.y }}");
});

// --- CONDUCTOR AMENDMENT 2026-08-14 — root-anchored parsing -----------------
//
// A string is treated as an expression only when EVERY `{{ }}` marker's first
// path segment is a `RunScope` root. Mixed rooted/unrooted -> the whole string
// stays literal. Chipping an unrooted marker (a vendor placeholder) would be
// the exact defect this node exists to fix, with the sign flipped.

test("acceptance 1 — valueToParts's string arm parses a rooted {{ }} marker mid-string, by value and in order", () => {
  assert.deepEqual(valueToParts("a {{ vars.x }} b").parts, [
    { kind: "text", value: "a " },
    { kind: "var", ref: "vars.x" },
    { kind: "text", value: " b" },
  ]);
});

test("acceptance 1 — valueToParts('') still returns { parts: [], sealed: null }", () => {
  assert.deepEqual(valueToParts(""), { parts: [], sealed: null });
});

test("CA-1 — a rooted marker parses; an unrooted marker (a vendor placeholder) stays literal, byte-identical", () => {
  assert.deepEqual(valueToParts("{{ vars.a }}").parts, [{ kind: "var", ref: "vars.a" }]);
  // Mailjet-shaped: {{name}} has no dot, so its whole inner text is the "root"
  // segment, and "name" is not one of RUN_SCOPE_ROOT_NAMES.
  assert.deepEqual(valueToParts("{{name}}").parts, [{ kind: "text", value: "{{name}}" }]);
});

test("CA-2 — a mixed rooted+unrooted string stays WHOLLY literal (all-or-nothing, no escape syntax)", () => {
  assert.deepEqual(valueToParts("{{ vars.a }} and {{name}}").parts, [
    { kind: "text", value: "{{ vars.a }} and {{name}}" },
  ]);
});

test("CA-2 (parseRootAnchoredTemplate directly) — same all-or-nothing rule for the modal's chip-ify commit paths", () => {
  assert.deepEqual(parseRootAnchoredTemplate("{{ vars.a }} and {{name}}"), [
    { kind: "text", value: "{{ vars.a }} and {{name}}" },
  ]);
  assert.deepEqual(parseRootAnchoredTemplate("{{ vars.a }}"), [{ kind: "var", ref: "vars.a" }]);
});

test("a secret marker (secrets.NAME) is rooted by its own syntax and needs no separate root check", () => {
  assert.deepEqual(valueToParts("Bearer {{ secrets.jwt }}").parts, [
    { kind: "text", value: "Bearer " },
    { kind: "secret", ref: "jwt" },
  ]);
});

test("an expr marker (=<jsonlogic>) is rooted by its own syntax and needs no separate root check", () => {
  assert.deepEqual(valueToParts('{{ ={"var":"vars.n"} }}').parts, [
    { kind: "expr", expr: { var: "vars.n" } },
  ]);
});

test("a vendor placeholder with a dot but no real root still stays literal (e.g. Metabase's {{tag}} shape generalised)", () => {
  assert.deepEqual(valueToParts("{{ tag.filter }}").parts, [
    { kind: "text", value: "{{ tag.filter }}" },
  ]);
});

test("CA-3 — the root set is DERIVED (Record<keyof LocalRunScope, true>), not a hand-picked list: pins the concrete set so a silent narrowing reddens here", () => {
  assert.deepEqual(
    [...RUN_SCOPE_ROOT_NAMES].sort(),
    ["documents", "foreach", "inputs", "output", "secrets", "steps", "trigger", "vars"].sort(),
  );
  // Every one of those names round-trips through valueToParts as a chip (a
  // `secret` chip for the "secrets" root — its own `secrets.` prefix takes
  // it down a different `innerToPart` arm — a `var` chip for the rest) —
  // proving the exported name LIST is the same set parseRootAnchoredTemplate
  // actually consults, not a decorative export nobody reads.
  for (const root of RUN_SCOPE_ROOT_NAMES) {
    const expected: ExprPart =
      root === "secrets" ? { kind: "secret", ref: "x" } : { kind: "var", ref: `${root}.x` };
    assert.deepEqual(
      valueToParts(`{{ ${root}.x }}`).parts,
      [expected],
      `"${root}" must be a live root`,
    );
  }
});

// --- CA-4 — the masked-seal behaviour change (acceptance 6), re-derived
// against the root-anchored rule. `ExpressionInput.tsx`'s `onLeave` seals a
// masked field only when `typeof partsToValue(parts) === "string"`. -------

test("CA-4 — a masked field holding a ROOTED {{ }} yields an ExprValue: onLeave's typeof check no longer seals it", () => {
  const { parts } = valueToParts("{{ vars.x }}");
  const v = partsToValue(parts);
  assert.equal(typeof v, "object");
  assert.deepEqual(v, { type: "expr", parts: [{ kind: "var", ref: "vars.x" }] });
});

test("CA-4 — a masked field holding an UNROOTED {{ }} (a vendor placeholder) still parses to a plain string: onLeave's typeof check still seals it", () => {
  const { parts } = valueToParts("{{name}}");
  const v = partsToValue(parts);
  assert.equal(typeof v, "string");
  assert.equal(v, "{{name}}");
});

test("CA-4 — an unterminated {{ (parseTemplate keeps it literal) still seals too", () => {
  const { parts } = valueToParts("prefix {{ open");
  const v = partsToValue(parts);
  assert.equal(typeof v, "string");
  assert.equal(v, "prefix {{ open");
});

// --- The round-trip parallel to expression-dom.test.ts:382-407's
// order-asserting idiom: parse -> paint into a real DOM host -> read back,
// asserted BY VALUE and IN ORDER (a count assertion is explicitly
// insufficient — see that file's own note at :382-395). -------------------

{
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (globalThis as unknown as { Node: unknown }).Node = dom.window.Node;

  test("parseRootAnchoredTemplate -> paintParts -> readParts round-trips a var marker mid-string, in order", () => {
    const host = dom.window.document.createElement("div");
    const parts = parseRootAnchoredTemplate("a {{ vars.x }} b");
    paintParts(host as unknown as HTMLElement, parts);
    assert.deepEqual(readParts(host as unknown as HTMLElement), [
      { kind: "text", value: "a " },
      { kind: "var", ref: "vars.x" },
      { kind: "text", value: " b" },
    ]);
  });
}

// --- TA2 acceptance-3 fixture table: a `||`/`??` chain is an `expr` part, so it must be
// validated OPERAND-BY-OPERAND, all-or-nothing, same as any other marker — never the
// "expr is always ours" exemption the pre-TA2 tree gave every expr part. The engine's own
// copy of this exact table lives at `w6w-workflow/tests/expr_test.ts`; the two must agree.

test("chain fixture 1 — a rooted single-operand chain chips as one expr part (not a bogus var whose ref is garbage)", () => {
  assert.deepEqual(parseRootAnchoredTemplate('{{ inputs.from || "+1234567" }}'), [
    { kind: "expr", expr: { or: [{ var: "inputs.from" }, "+1234567"] } },
  ]);
});

test("chain fixture 2 — three rooted var operands chip as one expr part", () => {
  assert.deepEqual(
    parseRootAnchoredTemplate("{{ inputs.form || inputs.form2 || vars.defaultValue }}"),
    [
      {
        kind: "expr",
        expr: {
          or: [{ var: "inputs.form" }, { var: "inputs.form2" }, { var: "vars.defaultValue" }],
        },
      },
    ],
  );
});

test("chain fixture 3 — a ?? chain chips as one expr part", () => {
  assert.deepEqual(parseRootAnchoredTemplate('{{ vars.a ?? "z" }}'), [
    { kind: "expr", expr: { "??": [{ var: "vars.a" }, "z"] } },
  ]);
});

test("chain fixture 4 — operand 1 unrooted refuses the whole marker to a byte-identical literal", () => {
  const src = '{{ badroot.x || "y" }}';
  assert.deepEqual(parseRootAnchoredTemplate(src), [{ kind: "text", value: src }]);
});

test("chain fixture 5 — operand 2 unrooted refuses too (a first-operand-only check would wrongly pass this)", () => {
  const src = "{{ vars.a || badroot.x }}";
  assert.deepEqual(parseRootAnchoredTemplate(src), [{ kind: "text", value: src }]);
});

test("chain fixture 6 — mixed || and ?? operators refuse via hasRefusedChainToken, never fall through as a plain var", () => {
  const src = "{{ vars.a || vars.b ?? vars.c }}";
  assert.deepEqual(parseRootAnchoredTemplate(src), [{ kind: "text", value: src }]);
});

test("chain fixture 7 — a secrets. operand refuses outright, never falls through as an ordinary var", () => {
  const src = '{{ secrets.K || "x" }}';
  assert.deepEqual(parseRootAnchoredTemplate(src), [{ kind: "text", value: src }]);
});

test("chain fixture 8 — the = escape hatch stays exempt: coalesceOperandRefs does not recognise raw JSONLogic as a chain", () => {
  assert.deepEqual(parseRootAnchoredTemplate('{{ ={"var":"anything.at.all"} }}'), [
    { kind: "expr", expr: { var: "anything.at.all" } },
  ]);
});
