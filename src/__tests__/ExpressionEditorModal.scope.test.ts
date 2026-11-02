// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/ExpressionEditorModal.scope.test.ts  (Node 24)
//
// Same jsdom + react-dom/client + act harness as `ExpressionEditorModal.meta.test.ts`.
// The rail's scope: Workflow state holds only what the edited node can read at run time (its own
// path), the Metadata section holds every node's static meta, and the sections are an accordion.
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
const { upstreamStateSources, nodeConfigSources, nodeMetaValues } = await import(
  "../step-preview-state.ts"
);
const { excludeSelfStep } = await import("../components/ExpressionOptions.tsx");

const q = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)) as HTMLElement[];
const groupFor = (container: HTMLElement, labelText: string) =>
  q(container, ".w6w-exprmodal-group-label")
    .find((l) => l.textContent === labelText)
    ?.closest(".w6w-exprmodal-group") as HTMLElement | null;
const headerOf = (group: HTMLElement) =>
  group.querySelector('[data-testid="expr-section-toggle"]') as HTMLElement;
const openSections = (container: HTMLElement) =>
  q(container, '[data-testid="expr-section-toggle"]')
    .filter((b) => b.getAttribute("aria-expanded") === "true")
    .map((b) => b.querySelector(".w6w-exprmodal-group-label")?.textContent);

const nodeOf = (id: string, app: string, action: string, w?: Record<string, unknown>) => ({
  id,
  type: "step",
  position: { x: 0, y: 0 },
  data: { step: { id, uses: { app, action }, ...(w ? { with: w } : {}) }, isInternal: false },
});
const EB = "io.w6w.eventbrite";

// The screenshot's workflow: two disconnected paths. The edited node, resource_uri_to_urn_2, sits
// on the webhook path (eb_webhook → data_normalize → it); every other node is on the manual one.
const NODES = [
  nodeOf("manual_trigger_1", "@w6w/trigger", "manual"),
  nodeOf("find_webhook", EB, "list-webhooks", { organizationId: "org_1" }),
  nodeOf("for_each_1", "@w6w/control", "foreach", { items: "x" }),
  nodeOf("if_1", "@w6w/control", "if", { condition: true }),
  nodeOf("stop_workflow_1", "@w6w/control", "stop", { reason: "done" }),
  nodeOf("create_webhook_1", EB, "create-webhook", { actions: "order.placed" }),
  nodeOf("get_event_id", "@w6w/data", "set", { vars: "a" }),
  nodeOf("resource_uri_to_urn_1", "@w6w/script", "run", { code: "1" }),
  nodeOf("eb_webhook", "@w6w/webhook", "webhook"),
  nodeOf("data_normalize", "@w6w/data", "set", { vars: "b" }),
  nodeOf("resource_uri_to_urn_2", "@w6w/script", "run", { code: "2" }),
];
const PATHS = [
  ["manual_trigger_1", "find_webhook", "for_each_1", "if_1", "create_webhook_1", "get_event_id"],
  ["get_event_id", "resource_uri_to_urn_1"],
  ["if_1", "stop_workflow_1"],
  ["eb_webhook", "data_normalize", "resource_uri_to_urn_2"],
];
const EDGES = PATHS.flatMap((p) =>
  p.slice(0, -1).map((s, i) => ({ id: `${s}-${p[i + 1]}`, source: s, target: p[i + 1] })),
);
const SUBS = [
  {
    id: "sub_1",
    appId: "@w6w/webhook",
    triggerKey: "webhook",
    workflowId: "wf_1",
    connectionId: null,
    nodeId: "eb_webhook",
    webhookUrl: "https://h/triggers/webhooks/sub_1",
  },
];

// The options the flow editor composes for the edited node (`WorkflowFlowEditor`'s merge).
function optionsFor(editingId: string) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test nodes
  const nodes = NODES as any;
  const st = upstreamStateSources(editingId, nodes, EDGES, { actionDef: () => undefined });
  return {
    steps: excludeSelfStep(st.steps, editingId),
    hasTrigger: st.hasTrigger,
    loop: st.loop,
    nodeConfigs: nodeConfigSources(nodes),
    nodeMeta: nodeMetaValues(nodes, SUBS),
    vars: ["v1"],
    secrets: ["s1"],
    createVar: async () => {},
    createSecret: async () => {},
  };
}

test("Workflow state lists only the edited node's own path: no other-path node, and no Metadata chip (meta is only in the Metadata section)", async () => {
  const { container } = await mountModal({ options: optionsFor("resource_uri_to_urn_2") });
  const state = groupFor(container, "Previous steps") as HTMLElement;
  assert.ok(state);
  const rows = q(state, ".w6w-exprmodal-source-label").map((l) => l.textContent);
  assert.deepEqual(rows, ["trigger.event", "eb_webhook", "data_normalize"]);
  for (const other of [
    "manual_trigger_1",
    "find_webhook",
    "for_each_1",
    "if_1",
    "stop_workflow_1",
    "create_webhook_1",
    "get_event_id",
    "resource_uri_to_urn_1",
  ]) {
    assert.ok(!state.textContent?.includes(other), `${other} is on another path`);
  }
  assert.equal(q(state, '[data-testid="expr-meta-toggle"]').length, 0, "no per-node Metadata chip");
  assert.equal(q(state, '[data-testid="expr-config-toggle"]').length, 0, "no config subtree");
  assert.equal(q(state, '[data-testid="expr-metadata-node"]').length, 0);
  assert.ok(!state.textContent?.includes("Metadata"));
});

test("Metadata lists every node, other paths included, with its static meta and config", async () => {
  const saved: unknown[] = [];
  const { container } = await mountModal({
    options: optionsFor("resource_uri_to_urn_2"),
    onSave: (v) => saved.push(v),
  });
  const meta = groupFor(container, "Metadata") as HTMLElement;
  assert.ok(meta);
  assert.equal(headerOf(meta).getAttribute("aria-expanded"), "false", "collapsed by default");
  await click(headerOf(meta));
  const nodes = q(meta, '[data-testid="expr-metadata-node"] .w6w-exprmodal-source-label').map(
    (l) => l.textContent,
  );
  assert.deepEqual(
    nodes,
    NODES.map((n) => n.id),
  );

  // An other-path external app node: its four app leaves, then its config.
  const nodeRow = (id: string) =>
    q(meta, '[data-testid="expr-metadata-node"]').find((r) =>
      r.textContent?.includes(id),
    ) as HTMLElement;
  await click(
    nodeRow("find_webhook").querySelector('[data-testid="expr-metadata-node-toggle"]') as Element,
  );
  let fields = q(meta, '[data-testid="expr-metadata-fields"]');
  assert.equal(fields.length, 1);
  assert.deepEqual(
    q(fields[0], ":scope > .w6w-exprmodal-item .w6w-exprmodal-source-label").map(
      (l) => l.textContent,
    ),
    ["App", "App version", "Action", "Connection ID"],
  );
  assert.ok(fields[0].querySelector('[data-testid="expr-config-toggle"]'));

  // The webhook trigger's subscription leaves and its config URL.
  await click(
    nodeRow("eb_webhook").querySelector('[data-testid="expr-metadata-node-toggle"]') as Element,
  );
  fields = q(meta, '[data-testid="expr-metadata-fields"]');
  const eb = fields[1];
  assert.deepEqual(
    q(eb, ":scope > .w6w-exprmodal-item .w6w-exprmodal-source-label").map((l) => l.textContent),
    ["Subscription ID", "Webhook URL"],
  );
  await click(eb.querySelector('[data-testid="expr-config-toggle"]') as Element);
  const url = q(eb, '[data-testid="expr-config-fields"] .w6w-exprmodal-source').find(
    (b) => b.textContent === "·url",
  ) as HTMLElement;
  await click(url);
  await click(container.querySelector('[data-testid="expr-save"]') as Element);
  assert.deepEqual(saved, ["{{ nodes.eb_webhook.meta.config.url }}"]);
});

test("Metadata: a node's id row inserts its whole nodes.<id>.meta", async () => {
  const { container } = await mountModal({ options: optionsFor("resource_uri_to_urn_2") });
  const meta = groupFor(container, "Metadata") as HTMLElement;
  await click(headerOf(meta));
  const row = q(meta, '[data-testid="expr-metadata-node"] .w6w-exprmodal-source').find(
    (b) => b.textContent === "if_1",
  ) as HTMLElement;
  await click(row);
  const chip = container.querySelector(".w6w-exprmodal-chips .w6w-expr-chip") as HTMLElement;
  assert.equal(chip.getAttribute("data-ref"), "nodes.if_1.meta");
});

test("accordion: Workflow state opens by default, one section at a time, headers and + Add always shown", async () => {
  const { container } = await mountModal({ options: optionsFor("resource_uri_to_urn_2") });
  const labels = q(container, ".w6w-exprmodal-group-label").map((l) => l.textContent);
  assert.deepEqual(labels, ["Previous steps", "Metadata", "Variables", "Documents", "Secrets"]);
  assert.deepEqual(openSections(container), ["Previous steps"]);
  const bodyOf = (label: string) =>
    (groupFor(container, label) as HTMLElement).querySelector(
      ".w6w-exprmodal-group-body",
    ) as HTMLElement & { inert?: boolean };
  assert.equal(bodyOf("Variables").inert, true, "a closed body leaves the tab order");
  assert.equal(bodyOf("Previous steps").inert, false);
  // Collapsed sections still show their + Add.
  assert.ok(container.querySelector('[data-testid="expr-add-var"]'));
  assert.ok(container.querySelector('[data-testid="expr-add-secret"]'));

  await click(headerOf(groupFor(container, "Variables") as HTMLElement));
  assert.deepEqual(openSections(container), ["Variables"], "opening one closes the other");
  await click(headerOf(groupFor(container, "Metadata") as HTMLElement));
  assert.deepEqual(openSections(container), ["Metadata"]);
  await click(headerOf(groupFor(container, "Metadata") as HTMLElement));
  assert.deepEqual(openSections(container), [], "clicking the open one collapses it");
  assert.equal(groupFor(container, "Previous steps")?.classList.contains("is-open"), false);
});

test("accordion, Function context: Inputs opens by default", async () => {
  const { container } = await mountModal({ options: { inputs: ["i1"], vars: ["v1"] } });
  assert.deepEqual(openSections(container), ["Inputs"]);
});

test("Workflow state folds in the enclosing loop's current item", async () => {
  const { container } = await mountModal({
    options: { steps: [{ id: "for_each_1" }], loop: { foreachId: "for_each_1", itemOutputs: [] } },
  });
  const state = groupFor(container, "Previous steps") as HTMLElement;
  assert.ok(state.querySelector('[data-testid="expr-loop-group"]'));
  assert.deepEqual(openSections(container), ["Previous steps"]);
  assert.ok(!groupFor(container, "Loop"), "no separate Loop section");
});
