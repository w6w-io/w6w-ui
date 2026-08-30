// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionOptions.layering.test.ts
//
// `ExpressionOptionsProvider` LAYERS over what it inherits — the property that
// lets an app shell supply vars/secrets/documents once and a page add only its
// own `inputs`.
//
// The bug this exists to keep fixed: the provider used to REPLACE the context,
// so scope had to travel as an `exprOptions` prop to every consumer. A field
// the prop had not been threaded to — the `ƒx` toggles on a Function's
// Implementation mapping rows — opened the expression editor with an empty
// rail, while the same editor reached through the card's "Change" button
// (which did sit under a provider) offered the whole thing. Replacement
// semantics also meant a page could only add `inputs` by restating vars,
// secrets, documents, sampleValues and three callbacks alongside it, which is
// exactly why five pages carried a copy of the same 40-line object.
//
// The other half of the contract is negative and is asserted here too: scope
// contributed by a page must NOT be visible above it or beside it. That is what
// makes "navigate away and the `inputs` group is gone" true by construction
// rather than by teardown.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
// `navigator` is a getter-only global on Node 24 — define it rather than assign,
// exactly as the other jsdom suites in this directory do.
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { ExpressionOptionsProvider, useExpressionOptions } = await import(
  "../components/ExpressionOptions.tsx"
);
type ExpressionOptions = import("../components/ExpressionOptions.tsx").ExpressionOptions;

/** Renders nothing; reports the scope it sees at its position in the tree. */
function Probe({ onScope }: { onScope: (o: ExpressionOptions) => void }) {
  onScope(useExpressionOptions());
  return null;
}

/** Mount `tree`, run effects, and tear down. */
function render(tree: React.ReactElement): void {
  const host = dom.window.document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(tree);
  });
  act(() => {
    root.unmount();
  });
}

const h = React.createElement;

/** One contributing provider, with its children — `children` lives in props
 *  because `ExpressionOptionsProviderProps` declares it required. */
function scope(value: ExpressionOptions, children: React.ReactNode[]): React.ReactElement {
  return h(ExpressionOptionsProvider, { value, children, key: JSON.stringify(value) });
}

let probeSeq = 0;
/** A `Probe` element that reports the scope at its position. */
function probe(onScope: (o: ExpressionOptions) => void): React.ReactElement {
  probeSeq += 1;
  return h(Probe, { onScope, key: `probe-${probeSeq}` });
}

/** The app shell's contribution: what every page shares. */
const APP: ExpressionOptions = {
  vars: ["from_email"],
  secrets: ["sendgrid_key"],
  documents: [{ key: "welcome" }],
  sampleValues: { "vars.from_email": "a@b.c" },
};

test("a page's contribution layers ON TOP of the app shell's, without restating it", () => {
  let seen: ExpressionOptions | undefined;
  render(
    scope(APP, [
      // The page contributes ONE key. Everything else is inherited.
      scope({ inputs: ["to", "message"] }, [
        probe((o) => {
          seen = o;
        }),
      ]),
    ]),
  );
  assert.deepEqual(seen?.inputs, ["to", "message"], "the page's own key is in scope");
  assert.deepEqual(seen?.vars, ["from_email"], "the shell's vars survive the page provider");
  assert.deepEqual(seen?.secrets, ["sendgrid_key"]);
  assert.deepEqual(seen?.documents, [{ key: "welcome" }]);
  assert.deepEqual(
    seen?.sampleValues,
    { "vars.from_email": "a@b.c" },
    "non-list values are inherited too",
  );
});

test("scope contributed below is invisible above — a page's inputs cannot leak out", () => {
  let above: ExpressionOptions | undefined;
  let below: ExpressionOptions | undefined;
  render(
    scope(APP, [
      // A sibling of the page provider: same app shell, no page scope. This is
      // the "region outside the provider" case, and the "navigated to another
      // route" case — both are just "not a descendant".
      probe((o) => {
        above = o;
      }),
      scope({ inputs: ["to"] }, [
        probe((o) => {
          below = o;
        }),
      ]),
    ]),
  );
  assert.deepEqual(below?.inputs, ["to"]);
  assert.equal(above?.inputs, undefined, "a sibling must not see the page's inputs");
  assert.deepEqual(above?.vars, ["from_email"], "…while still seeing the shell's own scope");
});

test("a key present in the inner value WINS outright — it replaces, never unions", () => {
  let seen: ExpressionOptions | undefined;
  render(
    scope(APP, [
      // The workflow editor narrows `vars` to the rail for one step's
      // position; a union would offer refs that do not resolve there.
      scope({ vars: ["loop_item"] }, [
        probe((o) => {
          seen = o;
        }),
      ]),
    ]),
  );
  assert.deepEqual(seen?.vars, ["loop_item"]);
  assert.deepEqual(seen?.secrets, ["sendgrid_key"], "the keys it did not name are untouched");
});

test("an explicit `undefined` REMOVES an inherited key for that subtree", () => {
  let seen: ExpressionOptions | undefined;
  render(
    scope({ ...APP, inputs: ["to"] }, [
      scope({ inputs: undefined }, [
        probe((o) => {
          seen = o;
        }),
      ]),
    ]),
  );
  assert.equal(seen?.inputs, undefined, "a present-but-undefined key wins over the inherited one");
  assert.deepEqual(seen?.vars, ["from_email"], "and removes only what it named");
});

test("three levels compose — shell, page, region", () => {
  let seen: ExpressionOptions | undefined;
  render(
    scope(APP, [
      scope({ inputs: ["to"] }, [
        scope({ steps: [{ id: "gate_1" }], hasTrigger: true }, [
          probe((o) => {
            seen = o;
          }),
        ]),
      ]),
    ]),
  );
  assert.deepEqual(seen?.vars, ["from_email"]);
  assert.deepEqual(seen?.inputs, ["to"]);
  assert.deepEqual(seen?.steps, [{ id: "gate_1" }]);
  assert.equal(seen?.hasTrigger, true);
});

test("no provider at all is still an empty scope, not a crash", () => {
  let seen: ExpressionOptions | undefined;
  render(
    probe((o) => {
      seen = o;
    }),
  );
  assert.deepEqual(seen, {});
});
