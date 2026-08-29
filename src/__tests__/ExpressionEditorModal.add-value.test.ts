// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.add-value.test.ts  (Node 24)
//
// Mirrors `ExpressionEditorModal.chips.test.ts`'s jsdom + react-dom/client +
// act harness verbatim (same rig, same `<dialog>` shims) — no third harness
// stood up here. Covers the two criteria that are naturally unit-level: A2
// (the "+ Add" control is gated on the matching host callback, and ONLY on
// it — nothing else on `options` toggles it) and A6 (a rejected create keeps
// the nested modal open with the message shown, `pending` cleared). The
// stacked-dialog geometry/focus/Escape/backdrop criteria (A4/A7/A8/A9) need a
// real browser and real CSS — those live in
// `test/expr-template/expr-template-guards.test.cjs`.
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
// `el.showModal()` in a mount effect, which would otherwise throw. Both the
// editor's own dialog AND the nested "+ Add" dialog share this prototype.
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

// React tracks the input's previous value on the DOM node itself to decide
// whether an `input` event changed anything; setting `.value =` directly goes
// through THAT override and would make React think nothing changed. Go
// through the native prototype setter instead (the standard trick for
// driving a controlled input from outside React) so the dispatched `input`
// event is seen as a real change.
const inputProto = (
  dom.window as unknown as { HTMLInputElement: { prototype: Record<string, unknown> } }
).HTMLInputElement.prototype;
const nativeValueSetter = Object.getOwnPropertyDescriptor(inputProto, "value")?.set as
  | ((v: string) => void)
  | undefined;

const setInputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    nativeValueSetter?.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};

// ── A2 — callback-gated affordance, both halves in one test ────────────────

test("A2 — the + Add control renders iff the matching host callback is supplied, one per store, never on Inputs/Documents/Workflow state", async () => {
  const { container: bare } = await mountModal({ options: { vars: ["a"], secrets: ["s"] } });
  assert.equal(
    bare.querySelectorAll('[data-testid^="expr-add-"]').length,
    0,
    "no callback bound anywhere on options => no + Add button at all",
  );

  const { container: withCallbacks } = await mountModal({
    options: {
      vars: ["a"],
      secrets: ["s"],
      inputs: ["in1"],
      documents: [{ key: "doc1" }],
      steps: [{ id: "st1" }],
      createVar: async () => {},
      createSecret: async () => {},
    },
  });
  assert.equal(
    withCallbacks.querySelectorAll('[data-testid^="expr-add-"]').length,
    2,
    "exactly one + Add button per callback supplied",
  );
  assert.ok(
    groupFor(withCallbacks, "Variables")?.querySelector('[data-testid="expr-add-var"]'),
    "the Variables group must carry the var + Add button",
  );
  assert.ok(
    groupFor(withCallbacks, "Secrets")?.querySelector('[data-testid="expr-add-secret"]'),
    "the Secrets group must carry the secret + Add button",
  );
  for (const label of ["Inputs", "Documents", "Workflow state"]) {
    const group = groupFor(withCallbacks, label);
    assert.ok(group, `expected a ${label} group to be present in this fixture`);
    assert.equal(
      group?.querySelectorAll('[data-testid^="expr-add-"]').length,
      0,
      `${label} has no writable store — it must never gain a + Add control`,
    );
  }
});

// ── A6 — a rejected create keeps the nested modal open ─────────────────────

test("A6 — a rejected createVar keeps the nested modal open, clears pending, and shows the rejection message", async () => {
  const rejection = new Error('A var named "x" already exists.');
  const { container } = await mountModal({
    options: {
      vars: [],
      secrets: [],
      createVar: async () => {
        throw rejection;
      },
    },
  });

  const addBtn = container.querySelector('[data-testid="expr-add-var"]') as HTMLButtonElement;
  assert.ok(addBtn, "the + Add button must be present (createVar is bound)");
  await act(async () => {
    addBtn.click();
  });

  const dialog = container.querySelector('dialog[aria-label="Add variable"]');
  assert.ok(dialog, "the nested Add-variable dialog must be open");

  const nameInput = dialog?.querySelector(
    '[data-testid="expr-add-value-name"]',
  ) as HTMLInputElement;
  const valueInput = dialog?.querySelector(
    '[data-testid="expr-add-value-value"]',
  ) as HTMLInputElement;
  await setInputValue(nameInput, "x");
  await setInputValue(valueInput, "y");

  const saveBtn = dialog?.querySelector('[data-testid="expr-add-value-save"]') as HTMLButtonElement;
  assert.equal(saveBtn.disabled, false, "name + value filled => Save must be enabled");
  await act(async () => {
    saveBtn.click();
  });
  // Let the rejected promise's catch/finally microtasks flush.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.ok(
    container.querySelector('dialog[aria-label="Add variable"]'),
    "the nested modal must still be in the DOM after a rejected create — no optimistic close",
  );
  const errEl = container.querySelector(".w6w-result.w6w-error");
  assert.ok(errEl, "the rejection must render inline");
  assert.equal(errEl?.textContent, rejection.message);
  const saveBtnAfter = container.querySelector(
    '[data-testid="expr-add-value-save"]',
  ) as HTMLButtonElement;
  assert.equal(
    saveBtnAfter.disabled,
    false,
    "pending must clear on rejection (name/value are still filled, so Save re-enables)",
  );
});
