// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/StepBuilderModal.template-node.test.ts  (Node 24)
//
// T2.1.2 — A3: prove `@w6w/template · render` is reachable through the REAL
// StepBuilderModal, not by re-stating `UtilitiesFlow`'s filter predicate in
// the test body — `ExpressionEditorModal.chips.test.ts:287-297`'s shape
// (`INTERNAL_NODES.filter(...)` copied into the test) is explicitly
// forbidden here per the contract. Mounts the real modal via the jsdom +
// react-dom rig `StepBuilderModal.homepage-tabs.test.ts` establishes,
// reused verbatim rather than a third harness.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const g = globalThis as unknown as Record<string, unknown>;
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>");
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.matchMedia =
  dom.window.matchMedia ??
  ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
(dom.window as unknown as Record<string, unknown>).matchMedia = g.matchMedia;

class FakeMutationObserver {
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
g.MutationObserver =
  (dom.window as unknown as Record<string, unknown>).MutationObserver ?? FakeMutationObserver;
(dom.window as unknown as Record<string, unknown>).MutationObserver = g.MutationObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements <dialog> as an element but not its imperative API — `Modal`
// (StepBuilderModal's wrapper) calls `showModal()` in a mount effect.
const dialogProto = dom.window.HTMLDialogElement?.prototype as unknown as Record<string, unknown>;
if (dialogProto && typeof dialogProto.showModal !== "function") {
  dialogProto.showModal = function showModal(this: HTMLElement) {
    this.setAttribute("open", "");
  };
  dialogProto.close = function close(this: HTMLElement) {
    this.removeAttribute("open");
  };
}

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { StepBuilderModal } = await import("../StepBuilderModal.tsx");
const { W6WUIProvider } = await import("../provider.tsx");
const { TEMPLATE_APP, internalNodeDef } = await import("../flow-types.ts");

/** Enough of `W6WApi` for the modal's home-tab effect to settle. The
 *  Utilities tab reads nothing from the api at all, but `useReadyToUse` runs
 *  unconditionally on mount — every other member is unreached and answers
 *  with an empty list via the `Proxy` fallback. */
function fakeApi() {
  return new Proxy(
    {
      listApps: () => Promise.resolve([]),
      listConnections: () => Promise.resolve([]),
      listFunctions: () => Promise.resolve([]),
      listWorkflows: () => Promise.resolve([]),
    } as Record<string, unknown>,
    {
      get(t, k: string) {
        if (k in t) return t[k];
        return () => Promise.resolve([]);
      },
    },
  );
}

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

test("the Utilities tab renders a 'Render template' row through the real StepBuilderModal", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(
        W6WUIProvider,
        { api: fakeApi() as never, children: null } as never,
        React.createElement(StepBuilderModal, {
          onClose: () => {},
          onAdd: () => {},
        } as never),
      ),
    );
  });
  // Flush the home-tab effect (`useReadyToUse`) before navigating away from it.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  const utilitiesTab = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Utilities",
  );
  assert.ok(utilitiesTab, "the Utilities tab button must render");
  await act(async () => {
    utilitiesTab.click();
  });

  const rows = Array.from(container.querySelectorAll(".w6w-stepbuilder-item strong")).map((el) =>
    (el.textContent || "").trim(),
  );
  assert.ok(
    rows.includes("Render template"),
    `the Utilities tab must render a "Render template" row through the real component; got ${JSON.stringify(rows)}`,
  );

  await act(async () => root.unmount());
});

test("@w6w/template · render declares exactly [template, values] — template:text, values:vars", () => {
  const def = internalNodeDef(TEMPLATE_APP, "render");
  assert.ok(def, "internalNodeDef(@w6w/template, render) must be defined");
  const params = def?.params ?? [];
  assert.deepEqual(
    params.map((p) => p.key),
    ["template", "values"],
    "param keys, in order",
  );
  const template = params.find((p) => p.key === "template");
  const values = params.find((p) => p.key === "values");
  assert.equal(template?.type, "text", "template must be expression-capable (FxField-wrapped)");
  assert.equal(values?.type, "vars", "values must render VarsField, not the generic json editor");
});
