// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.meta.test.ts  (Node 24)
//
// Same jsdom + react-dom/client + act harness as `ExpressionEditorModal.rail.test.ts`.
// T3.2.3: the Metadata group (R-7), chip labels (varLabel) and save/reload.
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

// json-binding mode mounts a CodeMirror JsonEditor, which needs these (same shims as
// `ParamsForm.json-binding.test.ts`).
g.Window = dom.window.Window;
const raf = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.requestAnimationFrame = raf;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
(dom.window as unknown as Record<string, unknown>).requestAnimationFrame = raf;
(dom.window as unknown as Record<string, unknown>).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as NodeJS.Timeout);
const rangeProto = dom.window.Range.prototype as unknown as Record<string, unknown>;
rangeProto.getClientRects = () => [];
rangeProto.getBoundingClientRect = () => ({
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
});

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

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
};
const { upstreamStateSources } = await import("../step-preview-state.ts");
const { excludeSelfStep } = await import("../components/ExpressionOptions.tsx");
const { varLabel } = await import("../components/expression-dom.ts");

const q = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)) as HTMLElement[];
// A node's meta is offered only in the Metadata section: one row per node, its caret opening the
// leaves. Workflow state never carries a per-node Metadata chip.
const toggles = (c: ParentNode) => q(c, '[data-testid="expr-metadata-node-toggle"]');
const stateChips = (c: ParentNode) => q(c, '[data-testid="expr-meta-toggle"]');
const leaves = (c: ParentNode) => q(c, '[data-testid="expr-metadata-fields"] .w6w-exprmodal-item');
const leafBtn = (c: ParentNode, i: number) =>
  leaves(c)[i].querySelector(".w6w-exprmodal-source") as HTMLElement;
const copyBtn = (c: ParentNode, i: number) =>
  leaves(c)[i].querySelector('[data-testid="expr-copy-to-editor"]') as HTMLElement;
const KEYS = ["app", "version", "action", "connectionId"];
const LABELS = ["App", "App version", "Action", "Connection ID"];

const nodeOf = (id: string, app: string, action: string) => ({
  id,
  type: "step",
  position: { x: 0, y: 0 },
  data: { step: { id, uses: { app, action } }, isInternal: false },
});
const EXT = "io.w6w.eventbrite";

async function mountExt(overrides: Partial<Props> = {}) {
  return mountModal({
    options: { steps: [{ id: "ev", hasMeta: true }] },
    ...overrides,
  });
}

test("M1 - composed projection, before any test: exactly one Metadata group, for the external step", async () => {
  const nodes = [
    nodeOf("trig", "@w6w/trigger", "trigger"),
    nodeOf("ev", EXT, "get-event"),
    nodeOf("code", "@w6w/script", "run"),
    nodeOf("call", "@w6w/call", "call"),
    nodeOf("ctl", "@w6w/control", "merge"),
    nodeOf("self", EXT, "get-event"),
    nodeOf("later", EXT, "get-event"),
    nodeOf("other", EXT, "get-event"),
  ];
  const ids = ["trig", "ev", "code", "call", "ctl", "self", "later"];
  const edges = ids.slice(0, -1).map((s, i) => ({ id: s, source: s, target: ids[i + 1] }));
  const steps = excludeSelfStep(
    // biome-ignore lint/suspicious/noExplicitAny: structural test nodes
    upstreamStateSources("self", nodes as any, edges, { actionDef: () => undefined }).steps,
    "self",
  );
  const { container } = await mountModal({ options: { steps } });
  assert.equal(toggles(container).length, 1);
  assert.equal(stateChips(container).length, 0, "no Metadata chip beside the state row");
  const saved: unknown[] = [];
  const m = await mountModal({ options: { steps }, onSave: (v) => saved.push(v) });
  await click(toggles(m.container)[0]);
  await click(leafBtn(m.container, 0));
  assert.deepEqual(saved, []);
  await click(m.container.querySelector('[data-testid="expr-save"]') as Element);
  assert.deepEqual(saved, ["{{ nodes.ev.meta.app }}"]);
});

for (const [i, k] of KEYS.entries()) {
  test(`M2 - picking the ${k} leaf then Save saves nodes.ev.meta.${k}`, async () => {
    const { container, onSaveCalls } = await mountExt();
    await click(toggles(container)[0]);
    await click(leafBtn(container, i));
    await click(container.querySelector('[data-testid="expr-save"]') as Element);
    assert.deepEqual(onSaveCalls, [`{{ nodes.ev.meta.${k} }}`]);
  });
  test(`M3 - the copy icon on the ${k} leaf inserts a chip with that ref`, async () => {
    const { container } = await mountExt();
    await click(toggles(container)[0]);
    await click(copyBtn(container, i));
    const chips = q(container, ".w6w-exprmodal-chips .w6w-expr-chip");
    assert.equal(chips.length, 1);
    assert.equal(chips[0].getAttribute("data-ref"), `nodes.ev.meta.${k}`);
  });
}

test("M4 - the Metadata row follows hasMeta === true only, and is independent of the fields caret", async () => {
  const withOutputs = {
    id: "ev",
    hasMeta: true,
    outputs: [{ key: "id" }],
    outputsFrom: "declared" as const,
  };
  for (const st of [
    withOutputs,
    { id: "ev", hasMeta: true, needsTest: true },
    { id: "ev", hasMeta: true },
  ]) {
    const { container } = await mountModal({ options: { steps: [st] } });
    assert.equal(toggles(container).length, 1);
    assert.equal(stateChips(container).length, 0);
  }
  for (const st of [{ id: "ev" }, { id: "ev", hasMeta: false }]) {
    const { container } = await mountModal({ options: { steps: [st] } });
    assert.equal(toggles(container).length, 0);
  }
  const { container } = await mountModal({ options: { steps: [withOutputs] } });
  const caret = q(container, '[data-testid="expr-caret-fields"]')[0];
  const t = toggles(container)[0];
  assert.equal(t.getAttribute("aria-expanded"), "false");
  await click(t);
  assert.equal(t.getAttribute("aria-expanded"), "true");
  assert.equal(caret.getAttribute("aria-expanded"), "false", "opening meta does not open fields");
  await click(t);
  await click(caret);
  assert.equal(caret.getAttribute("aria-expanded"), "true");
  assert.equal(t.getAttribute("aria-expanded"), "false", "opening fields does not open meta");
  assert.equal(q(container, '[data-testid="expr-metadata-fields"]').length, 0);
});

test("M4b - the Metadata row's caret shows the closed/open glyph, switching with aria-expanded", async () => {
  const { container } = await mountExt();
  const t = toggles(container)[0];
  assert.equal(t.getAttribute("aria-expanded"), "false");
  assert.equal(t.textContent, "▸");
  await click(t);
  assert.equal(t.getAttribute("aria-expanded"), "true");
  assert.equal(t.textContent, "▾");
});

test("M5 - exactly the four labels, and no value, ever", async () => {
  const { container } = await mountExt();
  await click(toggles(container)[0]);
  assert.deepEqual(
    leaves(container).map((l) => l.querySelector(".w6w-exprmodal-source-label")?.textContent),
    LABELS,
  );
  assert.equal(
    q(container, '[data-testid="expr-metadata-fields"]')[0].textContent,
    ["App", "App version", "Action", "Connection ID"].map((l) => `·${l}`).join(""),
    "labels plus the leaf sigil, nothing else",
  );
  await click(copyBtn(container, 1));
  assert.equal(q(container, ".w6w-exprmodal-result")[0].textContent, " ");
});

test("M6 - save/reload: meta chips read readably; other values round-trip", async () => {
  for (const value of [
    { type: "expr" as const, parts: [{ kind: "var" as const, ref: "nodes.ev.meta.connectionId" }] },
    "{{ nodes.ev.meta.connectionId }}",
  ]) {
    const { container } = await mountExt({ value });
    const chips = q(container, ".w6w-exprmodal-chips .w6w-expr-chip");
    assert.equal(chips.length, 1);
    assert.equal(chips[0].getAttribute("data-ref"), "nodes.ev.meta.connectionId");
    assert.notEqual(
      chips[0].querySelector(".w6w-expr-chip-label")?.textContent,
      "nodes.ev.meta.connectionId",
    );
  }
  for (const text of ["{{ nodes.ev.output.id }}", "{{ vars.x }}"]) {
    const { container, onSaveCalls } = await mountExt({ value: text });
    await click(q(container, "button").find((b) => b.textContent === "Save") as HTMLElement);
    assert.equal(onSaveCalls.length, 1);
    const saved = onSaveCalls[0];
    const ref = text.includes("vars") ? "vars.x" : "nodes.ev.output.id";
    assert.deepEqual(saved, `{{ ${ref} }}`);
  }
});

test("M7 - json-binding mode: one Metadata row per app step; a click into an empty draft binds", async () => {
  const saved: unknown[] = [];
  const { container } = await mountModal({
    mode: "json-binding",
    onSaveJson: (v) => saved.push(v),
    options: { steps: [{ id: "ev", hasMeta: true }, { id: "plain" }] },
  });
  assert.equal(toggles(container).length, 1);
  await click(toggles(container)[0]);
  const app = leaves(container).find(
    (l) => l.querySelector(".w6w-exprmodal-source-label")?.textContent === "App",
  );
  await click(app?.querySelector(".w6w-exprmodal-source") as HTMLElement);
  // Into an empty draft a click binds and closes.
  assert.deepEqual(saved, ["{{ nodes.ev.meta.app }}"]);
});

test("V0 - varLabel meta labels are exact for an id sharing no letters with any key", () => {
  assert.equal(varLabel("steps.zz.meta.app"), "zz meta · app");
  assert.equal(varLabel("steps.zz.meta.version"), "zz meta · version");
  assert.equal(varLabel("steps.zz.meta.action"), "zz meta · action");
  assert.equal(varLabel("steps.zz.meta.connectionId"), "zz meta · connectionId");
});

test("V1-V5 - varLabel meta branch", () => {
  for (const k of KEYS) {
    const ref = `steps.a.meta.${k}`;
    const l = varLabel(ref);
    assert.notEqual(l, ref, `${k}: differs from raw ref`);
    assert.notEqual(l, varLabel(`steps.a.output.meta.${k}`), `${k}: differs from the output form`);
    assert.ok(l.includes("a") && l.includes(k), `${k}: contains id and key`);
    assert.equal(
      varLabel(`steps.my.step.meta.${k}`),
      `steps.my.step.meta.${k}`,
      `${k}: dotted id is verbatim`,
    );
  }
  assert.equal(varLabel("steps.a.output.meta.app"), "a.meta.app");
  assert.equal(varLabel("steps.a.output"), "a");
  assert.equal(varLabel("steps.a.meta.foo"), "steps.a.meta.foo");
  assert.equal(varLabel("steps.a.meta"), "steps.a.meta");
});
