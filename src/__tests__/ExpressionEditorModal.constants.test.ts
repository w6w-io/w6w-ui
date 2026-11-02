// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.constants.test.ts  (Node 24)
// Constants group: hidden when none, read-only chips when present.
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

test("constants group is hidden when no constants are offered", async () => {
  const { container } = await mountModal({ options: { vars: ["a"] } });
  assert.equal(groupFor(container, "Constants"), null);
});

test("constants group lists read-only chips with no Add button", async () => {
  const { container } = await mountModal({
    options: { constants: ["account_id", "region"] },
  });
  const group = groupFor(container, "Constants");
  assert.ok(group, "expected a Constants group");
  assert.equal(group?.querySelector("button[data-testid='expr-add-var']"), null);
  assert.ok((group?.textContent ?? "").includes("account_id"));
  assert.ok((group?.textContent ?? "").includes("region"));
});

test("a constant chip saves as `const.<name>`", async () => {
  const { container, onSaveCalls } = await mountModal({
    options: { constants: ["account_id"] },
  });
  const btn = groupFor(container, "Constants")?.querySelector(
    ".w6w-exprmodal-source",
  ) as HTMLElement;
  assert.ok(btn);
  await act(async () => {
    btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(onSaveCalls.length, 0);
  await act(async () => {
    container
      .querySelector('[data-testid="expr-save"]')
      ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(onSaveCalls[0], "{{ const.account_id }}");
});
