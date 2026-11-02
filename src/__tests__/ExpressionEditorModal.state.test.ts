// Run: node --experimental-strip-types --conditions=w6w-source --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.state.test.ts
//
// The picker's "State" section (T4.1.2, F-4): the merged workflow state a step reads, listed as
// `state.<path>` before any run, beside the relabelled "Previous steps". Same jsdom harness as
// `ExpressionEditorModal.rail.test.ts`.
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

// jsdom@30 doesn't implement <dialog>'s imperative API — `Modal.tsx` calls
// `el.showModal()` in a mount effect, which would otherwise throw.
(
  dom.window as unknown as { HTMLDialogElement: { prototype: Record<string, unknown> } }
).HTMLDialogElement.prototype.showModal = function (this: { open: boolean }) {
  this.open = true;
};
(
  dom.window as unknown as { HTMLDialogElement: { prototype: Record<string, unknown> } }
).HTMLDialogElement.prototype.close = function (this: { open: boolean }) {
  this.open = false;
};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { ExpressionEditorModal } = await import("../components/ExpressionEditorModal.tsx");

type Props = Parameters<typeof ExpressionEditorModal>[0];

async function mountModal(overrides: Partial<Props> = {}) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const onSaveCalls: unknown[] = [];
  const onCloseCalls: number[] = [];
  const props: Props = {
    value: undefined,
    options: {},
    onSave: (v) => onSaveCalls.push(v),
    onClose: () => onCloseCalls.push(1),
    ...overrides,
  };
  await act(async () => {
    root.render(React.createElement(ExpressionEditorModal, props));
  });
  return { container, root, onSaveCalls, onCloseCalls };
}

const groupFor = (container: HTMLElement, labelText: string) => {
  const labels = Array.from(container.querySelectorAll(".w6w-exprmodal-group-label"));
  const label = labels.find((l) => l.textContent === labelText);
  return label?.closest(".w6w-exprmodal-group") ?? null;
};

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
};

const { computeStateShape } = await import("../state-shape.ts");
const { WEBHOOK_APP, TRIGGER_APP } = await import("../flow-types.ts");

const labelsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".w6w-exprmodal-group-label")).map((el) => el.textContent);

type StepNode = import("../flow-utils.ts").StepNode;
type FlowStep = import("../flow-types.ts").FlowStep;
const node = (
  id: string,
  app: string,
  action: string,
  extra: Partial<FlowStep> = {},
): StepNode => ({
  id,
  type: "step",
  position: { x: 0, y: 0 },
  data: { step: { id, uses: { app, action }, ...extra }, isInternal: false },
});
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target });

// Send Confirmation: two triggers converge on Get entry and both paths write `state.order`.
function sendConfirmationShape() {
  const nodes = [
    node("order_webhook", WEBHOOK_APP, "webhook"),
    node("manual", TRIGGER_APP, "manual", {
      with: { fields: [{ key: "order_id" }, { key: "email" }] },
      state: {
        mode: "pick",
        map: [
          { from: "order_id", to: "order.id" },
          { from: "email", to: "order.email" },
        ],
      },
    }),
    node("fetch_order", "shop", "get_order", { state: { mode: "key", key: "order" } }),
    node("get_entry", "sheets", "get_row"),
  ];
  const edges = [
    edge("order_webhook", "fetch_order"),
    edge("fetch_order", "get_entry"),
    edge("manual", "get_entry"),
  ];
  return computeStateShape({
    anchorId: "get_entry",
    nodes,
    edges,
    shapes: {
      actionDef: () => ({
        output: [{ key: "id" }, { key: "email" }, { key: "total", type: "number" }],
      }),
    },
  });
}

test("Send Confirmation: the picker at Get entry lists state.order and its fields, no run needed", async () => {
  const shape = sendConfirmationShape();
  const { container, root, onSaveCalls } = await mountModal({
    options: {
      vars: ["v1"],
      steps: [{ id: "fetch_order" }, { id: "manual" }],
      hasTrigger: true,
      stateShape: { fields: shape.fields },
    },
  });
  // "State" sits right after "Previous steps"; the default open section is unchanged.
  assert.deepEqual(labelsOf(container), [
    "Previous steps",
    "State",
    "Variables",
    "Documents",
    "Secrets",
  ]);
  const openLabels = Array.from(container.querySelectorAll(".w6w-exprmodal-group.is-open")).map(
    (g) => g.querySelector(".w6w-exprmodal-group-label")?.textContent,
  );
  assert.deepEqual(openLabels, ["Previous steps"]);

  const group = groupFor(container, "State") as HTMLElement;
  assert.ok(group, "a State section");
  const rows = Array.from(
    group.querySelectorAll('[data-testid="expr-state-fields"] .w6w-exprmodal-source'),
  );
  const titles = rows.map((r) => r.getAttribute("title"));
  for (const ref of ["state.order", "state.order.id", "state.order.email", "state.order.total"]) {
    assert.ok(
      titles.some((t) => t?.includes(ref)),
      `${ref} offered (${titles.join(" | ")})`,
    );
  }
  // Only `total` (written by the webhook path alone) is flagged "some paths".
  const some = Array.from(group.querySelectorAll('[data-testid="expr-state-some-paths"]')).map(
    (el) => el.closest(".w6w-exprmodal-source")?.getAttribute("title"),
  );
  assert.equal(some.length, 1, String(some));
  assert.ok(some[0]?.includes("state.order.total"), String(some[0]));

  // Picking a field inserts the `state.<path>` ref, committed with Save.
  await click(group.querySelector('[data-testid="expr-section-toggle"]') as Element);
  const idRow = rows.find((r) => r.getAttribute("title")?.endsWith("state.order.id")) as Element;
  await click(idRow);
  await click(container.querySelector('[data-testid="expr-save"]') as Element);
  assert.deepEqual(onSaveCalls[0], "{{ state.order.id }}");
  await act(async () => root.unmount());
});

test("no State section when the merged state is empty (or absent): only the relabel shows", async () => {
  for (const stateShape of [undefined, { fields: [] }]) {
    const { container, root } = await mountModal({
      options: { vars: ["v1"], steps: [{ id: "st1" }], ...(stateShape ? { stateShape } : {}) },
    });
    assert.deepEqual(labelsOf(container), ["Previous steps", "Variables", "Documents", "Secrets"]);
    assert.equal(groupFor(container, "State"), null);
    assert.equal(groupFor(container, "Workflow state"), null);
    await act(async () => root.unmount());
  }
});
