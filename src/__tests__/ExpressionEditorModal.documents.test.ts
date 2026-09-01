// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.documents.test.ts  (Node 24)
//
// Mirrors `ExpressionEditorModal.add-value.test.ts`'s jsdom + react-dom/client
// + act harness verbatim (same `<dialog>` shims, same `groupFor(container,
// labelText)` helper, same `await import("../components/ExpressionEditorModal.tsx")`
// form) — no third harness stood up here (A8). Covers the document
// field-ref-plus-render-action surface (A2-A4c) and the mutation battery
// M1-M9 that is unit-testable at the `ui` level (M1/M2/M7 — the
// `format === "json"` gate and the sample-value projection — live in
// `studio/src/lib/__tests__/document-sources.test.ts` instead, since `ui`
// never holds a document's `format`; it only ever receives an already-gated
// `ExpressionDocumentSource[]`).
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

// ── A3 / M3 — isRefSafeKey filters field keys at the ONE render site ───────

test("A3/M3 — a document's unsafe field keys (a.b, {x}, leading space, empty) never reach a sub-source row; only the safe key does, and its ref is exact", async () => {
  const { container } = await mountModal({
    options: {
      documents: [
        {
          key: "doc1",
          fields: [{ key: "a.b" }, { key: "{x}" }, { key: " pad" }, { key: "" }, { key: "body" }],
        },
      ],
    },
  });
  const group = groupFor(container, "Documents");
  assert.ok(group, "expected a Documents group");
  const toggle = group?.querySelector('[data-testid="expr-toggle-fields"]') as HTMLButtonElement;
  assert.ok(toggle, "the doc1 row must carry an expand toggle — it has a surviving field");
  await click(toggle);
  const subRows = Array.from(group?.querySelectorAll(".w6w-exprmodal-subsource-row") ?? []);
  assert.equal(
    subRows.length,
    1,
    "exactly one field survives isRefSafeKey out of the five offered",
  );

  const primaryBtn = subRows[0].querySelector(".w6w-exprmodal-source") as HTMLButtonElement;
  assert.ok(primaryBtn, "the surviving row must still carry its primary insert button");
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  await click(primaryBtn);
  const chip = editor.querySelector(".w6w-expr-chip") as HTMLElement;
  assert.ok(chip, "clicking the primary button must insert a chip");
  assert.equal(
    chip.getAttribute("data-ref"),
    "documents.doc1.body",
    "the surviving row's ref must be the safe key, verbatim — not merely 'one row'",
  );
});

// ── A4 / M4 — the render action inserts the SAME ref as a `render` part ────

test("A4/M4 — the render action inserts { kind: 'render', ref }, with the SAME ref the sibling primary button would insert", async () => {
  const { container } = await mountModal({
    options: { documents: [{ key: "doc1", fields: [{ key: "body" }] }] },
  });
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  const toggle = container.querySelector('[data-testid="expr-toggle-fields"]') as HTMLButtonElement;
  assert.ok(toggle, "the doc1 row must carry an expand toggle — it has a surviving field");
  await click(toggle);
  const renderBtn = container.querySelector(
    '[data-testid="expr-insert-render"]',
  ) as HTMLButtonElement;
  assert.ok(renderBtn, "the render action must be present for a document field row");

  await click(renderBtn);
  const chip = editor.querySelector(".w6w-expr-chip") as HTMLElement;
  assert.ok(chip, "clicking the render action must insert a chip");
  assert.equal(chip.getAttribute("data-kind"), "render");
  assert.equal(
    chip.getAttribute("data-ref"),
    "documents.doc1.body",
    "the render action must never re-derive the ref (e.g. via varLabel) — it must be byte-identical to the primary button's ref",
  );
});

// ── A4a / M5 — scoped to the Documents group's field rows only ─────────────

test("A4a/M5 — the render action appears ONLY inside the Documents group's field sub-sources — never on Variables/Secrets/Inputs/Workflow-state, and never on the bare documents.<key> entry", async () => {
  const { container } = await mountModal({
    options: {
      vars: ["v1"],
      secrets: ["s1"],
      inputs: ["i1"],
      steps: [{ id: "st1", outputs: [{ key: "o1" }] }],
      documents: [{ key: "doc1", fields: [{ key: "f1" }] }],
    },
  });

  const docsGroupBeforeExpand = groupFor(container, "Documents");
  const docToggle = docsGroupBeforeExpand?.querySelector(
    '[data-testid="expr-toggle-fields"]',
  ) as HTMLButtonElement;
  assert.ok(docToggle, "the doc1 row must carry an expand toggle — it has a surviving field");
  await click(docToggle);

  const total = container.querySelectorAll('[data-testid="expr-insert-render"]').length;
  assert.equal(
    total,
    1,
    "exactly one render action in the whole rail — the one document field — not zero (survivors must be counted too)",
  );

  for (const label of ["Variables", "Secrets", "Inputs", "Workflow state"]) {
    const group = groupFor(container, label);
    assert.ok(group, `expected a ${label} group to be present in this fixture`);
    assert.equal(
      group?.querySelectorAll('[data-testid="expr-insert-render"]').length,
      0,
      `${label} must never carry the render action — the secret fence depends on Secrets staying { kind: "secret" }-only`,
    );
  }

  const docsGroup = groupFor(container, "Documents");
  assert.ok(docsGroup);
  assert.equal(docsGroup?.querySelectorAll('[data-testid="expr-insert-render"]').length, 1);
  const outsideSubsourceRow = Array.from(
    docsGroup?.querySelectorAll('[data-testid="expr-insert-render"]') ?? [],
  ).filter((el) => !el.closest(".w6w-exprmodal-subsource-row"));
  assert.equal(
    outsideSubsourceRow.length,
    0,
    "the bare documents.<key> entry's own row must never carry the render action",
  );
});

// ── A2 / M8 — the bare documents.<key> entry stays unconditional ──────────

test("A2/M8 — every document keeps its bare documents.<key> entry regardless of whether it contributes fields, with an exact ref each", async () => {
  const { container } = await mountModal({
    options: {
      // `textdoc`/`arraydoc` model what studio's gate would hand `ui` for a
      // non-`json`-format document and a `json` array-content document
      // respectively: `fields` omitted either way.
      documents: [
        { key: "textdoc" },
        { key: "arraydoc" },
        { key: "jsondoc", fields: [{ key: "a" }] },
      ],
    },
  });
  const group = groupFor(container, "Documents");
  const bareSources = Array.from(group?.querySelectorAll(".w6w-exprmodal-source") ?? []).filter(
    (el) => !el.closest(".w6w-exprmodal-subsource-row"),
  ) as HTMLButtonElement[];
  assert.equal(
    bareSources.length,
    3,
    "one bare source button per document — a mutation deleting the whole group on a gate-failing fixture would satisfy M1/M2's own assertions harder than this one",
  );

  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  for (const btn of bareSources) await click(btn);
  const refs = Array.from(editor.querySelectorAll(".w6w-expr-chip"))
    .map((el) => el.getAttribute("data-ref"))
    .sort();
  assert.deepEqual(refs, ["documents.arraydoc", "documents.jsondoc", "documents.textdoc"]);
});

// ── A4b / M9 — the existing toggle keeps working on a render-action chip ──

test("A4b/M9 — a chip inserted via the render action still carries the ⇄ toggle, and flips exactly like any other var/render chip", async () => {
  const { container } = await mountModal({
    options: { documents: [{ key: "doc1", fields: [{ key: "body" }] }] },
  });
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  const expandToggle = container.querySelector(
    '[data-testid="expr-toggle-fields"]',
  ) as HTMLButtonElement;
  assert.ok(expandToggle, "the doc1 row must carry an expand toggle — it has a surviving field");
  await click(expandToggle);
  const renderBtn = container.querySelector(
    '[data-testid="expr-insert-render"]',
  ) as HTMLButtonElement;
  await click(renderBtn);

  let chip = editor.querySelector(".w6w-expr-chip") as HTMLElement;
  assert.equal(chip.getAttribute("data-kind"), "render");
  const toggle = chip.querySelector("[data-render-toggle]") as HTMLElement;
  assert.ok(toggle, "a chip inserted via the render action must carry the toggle control");

  await click(toggle);
  chip = editor.querySelector(".w6w-expr-chip") as HTMLElement;
  assert.equal(chip.getAttribute("data-kind"), "var", "first click flips render -> var");
  assert.equal(chip.getAttribute("data-ref"), "documents.doc1.body", "the ref must not change");

  const toggleBack = chip.querySelector("[data-render-toggle]") as HTMLElement;
  await click(toggleBack);
  chip = editor.querySelector(".w6w-expr-chip") as HTMLElement;
  assert.equal(chip.getAttribute("data-kind"), "render", "second click flips var -> render");
  assert.equal(chip.getAttribute("data-ref"), "documents.doc1.body");
});

// ── A4c / M6 (ui half) — a render chip participates in the Sample values box ──

test("A4c/M6 — a render part's ref offers a Sample-values row, same as a var part's would", async () => {
  const { container } = await mountModal({
    value: { type: "expr", parts: [{ kind: "render", ref: "documents.doc1.body" }] },
  });
  const sampleBox = container.querySelector(
    ".w6w-exprmodal-preview:not(.w6w-exprmodal-result-pane)",
  );
  assert.ok(sampleBox, "expected the Sample values box to render (usedRefs is non-empty)");
  const rowLabel = Array.from(sampleBox?.querySelectorAll("label.w6w-field span") ?? []).find(
    (el) => el.textContent === "documents.doc1.body",
  );
  assert.ok(
    rowLabel,
    "a render part's ref must offer a Sample-values row, exactly like a var part's",
  );
});
