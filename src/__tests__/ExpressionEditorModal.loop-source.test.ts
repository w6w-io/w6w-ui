// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.loop-source.test.ts  (Node 24)
//
// T2.4.1: the rail "Loop" group, its inserts, and the Result preview of foreach.* / nodes.* (D-X1).
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
const { upstreamSampleValues, upstreamStateSources } = await import("../step-preview-state.ts");
const { workflowToFlow } = await import("../flow-utils.ts");
const { buildResolveScope, resolveParamValue } = await import("../resolve-params.ts");

const q = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)) as HTMLElement[];
const FIELDS = ["name", "sourceId", "price", "quantity"];
const tickets = [
  { name: "GA", sourceId: "s1", price: 10, quantity: 5 },
  { name: "VIP", sourceId: "s2", seats: 2 },
];
const step = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  uses: { app: "io.w6w.stub", action: "run" },
  position: { x: 0, y: 0 },
  ...extra,
});
const graph = workflowToFlow({
  nodes: [
    step("create_event_1"),
    step("eventbrite_to_cohost_1"),
    {
      ...step("for_each_1"),
      uses: { app: "@w6w/control", action: "foreach" },
      with: {
        items: "{{ nodes.eventbrite_to_cohost_1.output.tickets }}",
        body: ["update_event_ticket_1"],
      },
    },
    step("update_event_ticket_1"),
  ],
  edges: [
    { from: "create_event_1", to: "eventbrite_to_cohost_1" },
    { from: "eventbrite_to_cohost_1", to: "for_each_1" },
  ],
  // biome-ignore lint/suspicious/noExplicitAny: structural fixture
} as any);
const testOutputs = {
  create_event_1: { id: "E1" },
  eventbrite_to_cohost_1: { tickets },
};
const proj = (outs: Record<string, unknown> | undefined) =>
  upstreamStateSources("update_event_ticket_1", graph.nodes, graph.edges, { testOutputs: outs });
const loopLabels = (c: ParentNode) =>
  q(c, '[data-testid="expr-loop-group"] .w6w-exprmodal-source-label').map((e) => e.textContent);
const loopBtn = (c: ParentNode, label: string) =>
  q(c, '[data-testid="expr-loop-group"] .w6w-exprmodal-source').find(
    (b) => b.querySelector(".w6w-exprmodal-source-label")?.textContent === label,
  ) as HTMLElement;
const loopToggle = (c: ParentNode) =>
  q(c, '[data-testid="expr-loop-group"] [data-testid="expr-toggle-fields"]')[0];

test("R0 - the item keys nest under Current item, collapsed until its 'N fields' toggle opens", async () => {
  const p = proj(testOutputs);
  const m = await mountModal({ options: { steps: p.steps, loop: p.loop } });
  assert.deepEqual(loopLabels(m.container), ["Current item", "Index"]);
  const toggle = loopToggle(m.container);
  assert.equal(toggle.textContent, "4 fields ›");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(loopLabels(m.container), ["Current item", ...FIELDS, "Index"]);
  const nested = q(m.container, '[data-testid="expr-loop-fields"] .w6w-exprmodal-source-label');
  assert.deepEqual(
    nested.map((e) => e.textContent),
    FIELDS,
  );
  await click(loopBtn(m.container, "price"));
  await click(m.container.querySelector('[data-testid="expr-save"]') as Element);
  assert.deepEqual(m.onSaveCalls, ["{{ foreach.item.price }}"]);
});

test("R1 - Loop group: Current item, its fields, Index; each inserts its ref for Save", async () => {
  const p = proj(testOutputs);
  assert.equal(p.loop?.itemOutputs?.length, 4);
  const labels = ["Current item", ...FIELDS, "Index"];
  const refs = ["foreach.item", ...FIELDS.map((f) => `foreach.item.${f}`), "foreach.index"];
  for (const [i, label] of labels.entries()) {
    const m = await mountModal({ options: { steps: p.steps, loop: p.loop } });
    await click(loopToggle(m.container));
    assert.deepEqual(loopLabels(m.container), labels);
    await click(loopBtn(m.container, label));
    await click(m.container.querySelector('[data-testid="expr-save"]') as Element);
    assert.deepEqual(m.onSaveCalls, [`{{ ${refs[i]} }}`], label);
  }
});

test("R1b - a For each's saved Test sample lists the item keys when nothing upstream resolves", async () => {
  const { foreachTestFixture, foreachTestSample } = await import("../step-preview-state.ts");
  const fx = foreachTestFixture([{ id: 7, title: "Gala", venue: { city: "TLV" } }], {});
  const sample = foreachTestSample({ with: fx.with } as never);
  assert.ok(sample);
  const p = upstreamStateSources("update_event_ticket_1", graph.nodes, graph.edges, {
    loopSamples: { for_each_1: sample },
  });
  const labels = ["Current item", "id", "title", "venue", "venue.city", "Index"];
  const m = await mountModal({ options: { steps: p.steps, loop: p.loop } });
  await click(loopToggle(m.container));
  assert.deepEqual(loopLabels(m.container), labels);
  await click(loopBtn(m.container, "title"));
  await click(m.container.querySelector('[data-testid="expr-save"]') as Element);
  assert.deepEqual(m.onSaveCalls, ["{{ foreach.item.title }}"]);
});

test("R2 - the group renders with empty steps, and without field rows when there is no sample", async () => {
  const { container } = await mountModal({
    options: { steps: [], loop: { foreachId: "for_each_1" } },
  });
  assert.deepEqual(loopLabels(container), ["Current item", "Index"]);
  assert.equal(loopToggle(container), undefined);
  assert.equal(proj(undefined).loop?.foreachId, "for_each_1");
});

test("R3 - json-binding mode: group renders and 'No upstream steps' does not", async () => {
  const { container } = await mountModal({
    mode: "json-binding",
    options: {
      steps: [],
      loop: {
        foreachId: "for_each_1",
        itemSample: tickets[0],
        itemOutputs: FIELDS.map((key) => ({ key, path: true })),
      },
    },
  });
  assert.equal(loopLabels(container).length, 2);
  await click(loopToggle(container));
  assert.equal(loopLabels(container).length, 6);
  assert.equal(container.textContent?.includes("No upstream steps"), false);
});

test("R4 - no loop, no group; and steps-only still shows 'No upstream steps' gate unchanged", async () => {
  const { container } = await mountModal({ mode: "json-binding", options: {} });
  assert.equal(q(container, '[data-testid="expr-loop-group"]').length, 0);
  assert.equal(container.textContent?.includes("No upstream steps"), true);
});

test("P1 - text-mode Result preview: nodes ref, foreach.item field and index all render", async () => {
  const p = proj(testOutputs);
  const sampleValues = upstreamSampleValues(p.steps, testOutputs, {}, p.loop);
  const expect: [string, string][] = [
    ["{{ nodes.create_event_1.output.id }}", "E1"],
    ["{{ foreach.item.name }}", "GA"],
    ["{{ foreach.index }}", "0"],
  ];
  for (const [value, shown] of expect) {
    const { container } = await mountModal({
      value,
      options: { steps: p.steps, loop: p.loop, sampleValues },
    });
    assert.equal(q(container, ".w6w-exprmodal-result")[0].textContent, shown, value);
  }
});

test("P2 - JSON-mode scope resolves foreach.item.name and foreach.index", () => {
  const scope = buildResolveScope({ "foreach.item": tickets[0], "foreach.index": 0 }, undefined);
  const name = resolveParamValue("{{ foreach.item.name }}", scope)[0];
  assert.equal(name.status === "resolved" && name.value, "GA");
  const idx = resolveParamValue("{{ foreach.index }}", scope)[0];
  assert.equal(idx.status === "resolved" && idx.value, 0);
});

const { ConditionEditor } = await import("../ConditionEditor.tsx");
const { ExpressionOptionsProvider } = await import("../components/ExpressionOptions.tsx");
const { evaluate } = await import("@w6w/expr");

async function mountCondition(condition: unknown = true, readOnly = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let saved: Record<string, unknown> = { condition, other: "preserved" };
  function Harness() {
    const [values, setValues] = React.useState(saved);
    return React.createElement(ExpressionOptionsProvider, {
      value: {
        loop: { foreachId: "for_each_1", itemOutputs: [{ key: "enabled" }, { key: "id" }] },
        sampleValues: { "foreach.item.enabled": true, "foreach.item.id": "hook-1" },
      },
      children: React.createElement(ConditionEditor, {
        values,
        readOnly,
        onChange: (next) => {
          saved = next;
          setValues(next);
        },
      }),
    });
  }
  await act(async () => root.render(React.createElement(Harness)));
  return { container, root, saved: () => saved };
}

test("condition textboxes save typed comparisons and preserve them through editor switches", async () => {
  const m = await mountCondition();
  const field = m.container.querySelector<HTMLElement>('[aria-label="Condition field"]');
  const value = m.container.querySelector<HTMLElement>('[aria-label="Condition value"]');
  assert.ok(field);
  assert.ok(value);
  assert.equal(m.container.querySelector('[aria-label="Condition value type"]'), null);
  await act(async () => {
    field.textContent = "{{ foreach.item.enabled }}";
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => {
    value.textContent = "true";
    value.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const condition = m.saved().condition as { $expr: unknown };
  assert.equal(evaluate(condition.$expr, { foreach: { item: { enabled: true } } }), true);
  assert.equal(evaluate(condition.$expr, { foreach: { item: { enabled: false } } }), false);
  assert.equal(m.saved().other, "preserved");
  await act(async () => {
    value.textContent = "false";
    value.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(
    evaluate((m.saved().condition as { $expr: unknown }).$expr, {
      foreach: { item: { enabled: false } },
    }),
    true,
  );
  const before = structuredClone(m.saved());
  const advanced = m.container.querySelector<HTMLButtonElement>(
    '[aria-label="Edit condition expression"]',
  );
  assert.ok(advanced);
  await click(advanced);
  assert.ok(m.container.querySelector(".cm-editor"));
  const simple = m.container.querySelector<HTMLButtonElement>(
    '[aria-label="Use comparison fields"]',
  );
  assert.ok(simple);
  await click(simple);
  assert.deepEqual(m.saved(), before);
  assert.equal(m.container.querySelector('[aria-label="Condition value"]')?.textContent, "false");
  await act(async () => m.root.unmount());
});

test("custom If expressions stay in the advanced editor without being overwritten", async () => {
  const condition = {
    $expr: { and: [{ var: "foreach.item.enabled" }, { "!=": [{ var: "foreach.item.id" }, ""] }] },
  };
  const m = await mountCondition(condition);
  assert.ok(m.container.querySelector(".cm-editor"));
  assert.equal(m.container.querySelector('[aria-label="Condition field"]'), null);
  assert.deepEqual(m.saved().condition, condition);
  await act(async () => m.root.unmount());
});

test("saved comparison fields reopen and honor read-only mode", async () => {
  const condition = { $expr: { "===": [{ var: "foreach.item.id" }, "hook-1"] } };
  const m = await mountCondition(condition, true);
  assert.equal(
    m.container.querySelector('[aria-label="Condition field"]')?.getAttribute("contenteditable"),
    "false",
  );
  assert.equal(m.container.querySelector('[aria-label="Condition value"]')?.textContent, "hook-1");
  assert.equal(
    m.container.querySelector('[aria-label="Condition value"]')?.getAttribute("contenteditable"),
    "false",
  );
  assert.deepEqual(m.saved().condition, condition);
  await act(async () => m.root.unmount());
});

const { RouterEditor } = await import("../RouterEditor.tsx");
const { StopEditor } = await import("../StopEditor.tsx");

test("Router adds four condition ports plus default and preserves ids when reordered", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let saved: Record<string, unknown> = {};
  function Harness() {
    const [values, setValues] = React.useState(saved);
    return React.createElement(RouterEditor, {
      values,
      onChange: (next) => {
        saved = next;
        setValues(next);
      },
    });
  }
  await act(async () => root.render(React.createElement(Harness)));
  for (let i = 0; i < 3; i++) {
    const add = q(container, "button").find((el) => el.textContent?.includes("Add route"));
    assert.ok(add);
    await click(add);
  }
  type Route = { id: string; default?: boolean };
  const before = (saved.routes as Route[]).map((r) => r.id);
  assert.equal(container.querySelectorAll(".w6w-router-route").length, 4);
  assert.equal(container.querySelectorAll("fieldset").length, 0);
  assert.equal(container.textContent?.includes("Default"), false);
  assert.equal((saved.routes as Route[]).at(-1)?.default, true);
  const grip = container.querySelector<HTMLButtonElement>('[aria-label="Reorder Route 1"]');
  assert.ok(grip);
  assert.equal(grip.draggable, true);
  await act(async () =>
    grip.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  assert.deepEqual(
    (saved.routes as Route[]).map((r) => r.id),
    [before[1], before[0], ...before.slice(2)],
  );
  await act(async () => root.unmount());
});

test("Stop offers unconditional or conditional termination without an accidental true condition", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let saved: Record<string, unknown> = {};
  function Harness() {
    const [values, setValues] = React.useState(saved);
    return React.createElement(StopEditor, {
      values,
      onChange: (next) => {
        saved = next;
        setValues(next);
      },
    });
  }
  await act(async () => root.render(React.createElement(Harness)));
  const mode = container.querySelector<HTMLSelectElement>('[aria-label="Stop when"]');
  assert.ok(mode);
  assert.equal(mode.value, "always");
  await act(async () => {
    mode.value = "condition";
    mode.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.equal(saved.condition, false);
  assert.ok(container.querySelector('[aria-label="Condition field"]'));
  await act(async () => {
    mode.value = "always";
    mode.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.equal(saved.condition, true);
  await act(async () => root.unmount());
});
