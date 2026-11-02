// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.output-shape.test.ts  (Node 24)
//
// Same jsdom + react-dom/client + act harness as `ExpressionEditorModal.rail.test.ts`.
// Covers app-action output shapes in the Workflow state rail: nested path fields,
// the "from the last test run" note, and the "run a test" hint.
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

const { isRefSafePath, outputFieldTree } = await import("../components/expression-dom.ts");

test("isRefSafePath — each dot segment is checked on its own", () => {
  assert.equal(isRefSafePath("start.utc"), true);
  assert.equal(isRefSafePath("id"), true);
  assert.equal(isRefSafePath("start..utc"), false);
  assert.equal(isRefSafePath("a.{b}"), false);
  assert.equal(isRefSafePath(" a.b"), false);
});

test("a step row's ▸ caret expands its fields and inserts nothing", async () => {
  const { container } = await mountModal({
    options: {
      steps: [{ id: "ev", outputs: [{ key: "name.text", path: true }], outputsFrom: "declared" }],
    },
  });
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  const group = groupFor(container, "Previous steps");
  const caret = group?.querySelector('[data-testid="expr-caret-fields"]') as HTMLElement;
  assert.equal(caret.textContent, "▸");
  assert.equal(
    group?.querySelector(".w6w-exprmodal-source .w6w-expr-chip-sigil"),
    null,
    "the chip no longer carries its own ▸ — the caret replaces it",
  );
  await click(caret);
  assert.equal(caret.getAttribute("aria-expanded"), "true");
  assert.equal(caret.textContent, "▾");
  assert.equal(
    group?.querySelectorAll(".w6w-exprmodal-subsources .w6w-exprmodal-source").length,
    1,
  );
  assert.equal(editor.querySelectorAll(".w6w-expr-chip").length, 0, "the caret inserts nothing");
  await click(caret);
  assert.equal(group?.querySelectorAll(".w6w-exprmodal-subsources").length, 0);
});

test("a declared nested path field inserts steps.<id>.output.<path>", async () => {
  const { container } = await mountModal({
    options: {
      steps: [
        {
          id: "ev",
          outputs: [
            { key: "start.utc", label: "Start (UTC)", path: true },
            { key: "bad..path", path: true },
          ],
          outputsFrom: "declared",
        },
      ],
    },
  });
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  const group = groupFor(container, "Previous steps");
  await click(group?.querySelector('[data-testid="expr-toggle-fields"]') as Element);
  const subs = group?.querySelectorAll(".w6w-exprmodal-subsources .w6w-exprmodal-source") ?? [];
  assert.equal(subs.length, 1, "the unreachable path is dropped, the nested one kept");
  assert.equal(
    group?.querySelector('[data-testid="expr-fields-from-test"]'),
    null,
    "declared fields carry no test-run note",
  );
  await click(
    subs[0].parentElement?.querySelector('[data-testid="expr-copy-to-editor"]') as Element,
  );
  const chip = editor.querySelector(".w6w-expr-chip") as HTMLElement;
  assert.equal(chip.getAttribute("data-ref"), "nodes.ev.output.start.utc");
});

test("outputFieldTree — each field shows its own name, nested under its nearest listed ancestor", () => {
  const rows = outputFieldTree([
    { key: "event", path: true },
    { key: "event.tz", path: true },
    { key: "event.start.utc", path: true },
    { key: "tickets", path: true },
    { key: "a.b" },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.field.key, r.depth, r.name]),
    [
      ["event", 0, "event"],
      ["event.tz", 1, "tz"],
      ["event.start.utc", 1, "start.utc"],
      ["tickets", 0, "tickets"],
      ["a.b", 0, "a.b"],
    ],
  );
});

test("a field row shows only its own name, indents under its parent and keeps the full ref", async () => {
  const { container } = await mountModal({
    options: {
      steps: [
        {
          id: "conv",
          outputs: [
            { key: "event", path: true },
            { key: "event.name", path: true },
          ],
          outputsFrom: "fresh",
        },
      ],
    },
  });
  const group = groupFor(container, "Previous steps");
  await click(group?.querySelector('[data-testid="expr-caret-fields"]') as Element);
  const rows = Array.from(
    group?.querySelectorAll(".w6w-exprmodal-subsources .w6w-exprmodal-source") ?? [],
  ) as HTMLElement[];
  assert.deepEqual(
    rows.map((b) => b.textContent),
    ["event", "name"],
  );
  assert.equal(rows[1].title, "Insert conv.event.name");
  assert.equal((rows[1].parentElement as HTMLElement).style.paddingLeft, "14px");
  assert.equal(rows[0].classList.contains("w6w-expr-chip-var"), false, "a field is not a chip");
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  await click(
    rows[1].parentElement?.querySelector('[data-testid="expr-copy-to-editor"]') as Element,
  );
  assert.equal(
    (editor.querySelector(".w6w-expr-chip") as HTMLElement).getAttribute("data-ref"),
    "nodes.conv.output.event.name",
  );
});

test("a dotted key WITHOUT path stays a literal key and is dropped, as before", async () => {
  const { container } = await mountModal({
    options: { steps: [{ id: "trig", outputs: [{ key: "a.b" }] }] },
  });
  assert.equal(container.querySelectorAll('[data-testid="expr-toggle-fields"]').length, 0);
});

test("fields from a test run say so when expanded", async () => {
  const { container } = await mountModal({
    options: {
      steps: [{ id: "ev", outputs: [{ key: "id", path: true }], outputsFrom: "fresh" }],
    },
  });
  const group = groupFor(container, "Previous steps");
  await click(group?.querySelector('[data-testid="expr-toggle-fields"]') as Element);
  const note = group?.querySelector('[data-testid="expr-fields-from-test"]');
  assert.equal(note?.textContent, "Fields from the last test run");
});

test("a step with no known shape tells the author to run a test, and still offers its whole output", async () => {
  const { container } = await mountModal({
    options: { steps: [{ id: "ev", needsTest: true }] },
  });
  const group = groupFor(container, "Previous steps");
  const hint = group?.querySelector('[data-testid="expr-needs-test"]');
  assert.equal(hint?.textContent, "Run a test of this step to see its fields");
  assert.equal(container.querySelectorAll('[data-testid="expr-toggle-fields"]').length, 0);
  const editor = container.querySelector(".w6w-exprmodal-chips") as HTMLElement;
  await click(
    group?.querySelector('.w6w-exprmodal-item [data-testid="expr-copy-to-editor"]') as Element,
  );
  assert.equal(
    (editor.querySelector(".w6w-expr-chip") as HTMLElement).getAttribute("data-ref"),
    "nodes.ev.output",
  );
});

// ── declared output shapes: merge, hints, trigger.event, value sources ──────

const expandFields = async (container: HTMLElement) => {
  const group = groupFor(container, "Previous steps") as HTMLElement;
  await click(group.querySelector('[data-testid="expr-toggle-fields"]') as Element);
  return group;
};

test("real {a,b} + declared {b,c}: a, b, c listed, only c muted 'declared by the app'", async () => {
  const { container } = await mountModal({
    options: {
      steps: [
        {
          id: "ev",
          outputs: [
            { key: "a", path: true },
            { key: "b", path: true },
            { key: "c", path: true, declaredOnly: true },
          ],
          outputsFrom: "fresh",
        },
      ],
    },
  });
  const group = await expandFields(container);
  const rows = Array.from(
    group.querySelectorAll(".w6w-exprmodal-subsources .w6w-exprmodal-source"),
  );
  assert.deepEqual(
    rows.map((b) => b.querySelector(".w6w-exprmodal-source-label")?.textContent),
    ["a", "b", "c"],
  );
  const muted = rows.filter((b) => b.classList.contains("is-declared-only"));
  assert.equal(muted.length, 1);
  assert.equal(muted[0].querySelector(".w6w-exprmodal-source-label")?.textContent, "c");
  assert.equal(muted[0].textContent?.includes("declared by the app"), true);
  assert.equal(rows[0].textContent, "a");
});

for (const mode of ["expression", "json-binding"] as const) {
  for (const [from, text, id] of [
    ["fresh", "Fields from the last test run", "expr-fields-from-test"],
    ["persisted", "Fields from last test", "expr-fields-from-test"],
    ["declared", "declared by the app", "expr-fields-from-declared"],
    ["sample", "example from the app", "expr-fields-from-sample"],
  ] as const) {
    test(`hint for a ${from} base in ${mode} mode`, async () => {
      const { container } = await mountModal({
        ...(mode === "json-binding" ? { mode } : {}),
        options: { steps: [{ id: "ev", outputs: [{ key: "id", path: true }], outputsFrom: from }] },
      });
      const group = await expandFields(container);
      assert.equal(group.querySelector(`[data-testid="${id}"]`)?.textContent, text);
    });
  }
}

test("trigger.event lists the app trigger's declared fields as insertable references", async () => {
  const { container } = await mountModal({
    options: {
      hasTrigger: true,
      eventOutputs: [
        { key: "order_id", path: true },
        { key: "attendees.0.email", path: true },
      ],
      eventOutputsFrom: "declared",
    },
  });
  const group = groupFor(container, "Previous steps") as HTMLElement;
  await click(group.querySelector('[data-testid="expr-caret-event"]') as Element);
  const box = group.querySelector('[data-testid="expr-event-fields"]') as HTMLElement;
  assert.equal(
    box.querySelector('[data-testid="expr-fields-from-declared"]')?.textContent,
    "declared by the app",
  );
  const titles = Array.from(box.querySelectorAll(".w6w-exprmodal-source")).map(
    (b) => (b as HTMLElement).title,
  );
  assert.deepEqual(titles, [
    "Insert trigger.event.order_id",
    "Insert trigger.event.attendees.0.email",
  ]);
});

test("Result names the tier of a sample- or persisted-sourced value, nothing for fresh", async () => {
  const note = async (tier: "sample" | "persisted" | "fresh") => {
    const { container } = await mountModal({
      value: "{{ nodes.s.output.a }}",
      options: {
        steps: [{ id: "s", outputs: [{ key: "a", path: true }] }],
        sampleValues: { "nodes.s.output.a": "v" },
        valueSources: { "nodes.s.output.a": tier },
      },
    });
    return container.querySelector('[data-testid="expr-result-source"]')?.textContent ?? null;
  };
  assert.equal(await note("sample"), "example from the app");
  assert.equal(await note("persisted"), "from last test");
  assert.equal(await note("fresh"), null);
});
