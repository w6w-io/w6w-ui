// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/StepEditModal.setup-and-configure.test.ts  (Node 24)
//
// Mirrors `WorkflowFlowEditor.test-tab.test.ts`'s jsdom + react-dom/client +
// act rig verbatim (same file it itself mirrors, `StepBuilderModal.commit.test.ts`)
// rather than inventing a second one. See that file's header for why each shim
// exists (`<dialog>.showModal`, `@xyflow/react`'s own stylesheet import, and —
// belt-and-suspenders here, since neither Setup nor the Configure props view
// mounts `JsonEditor`/CodeMirror — the requestAnimationFrame trio).
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

g.Window = dom.window.Window;
const raf = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.requestAnimationFrame = raf;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
(dom.window as unknown as Record<string, unknown>).requestAnimationFrame = raf;
(dom.window as unknown as Record<string, unknown>).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as NodeJS.Timeout);

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
const { StepEditModal } = await import("../WorkflowFlowEditor.tsx");
const { W6WUIProvider } = await import("../provider.tsx");
const { ExpressionOptionsProvider } = await import("../components/ExpressionOptions.tsx");
type W6WApi = Awaited<ReturnType<typeof import("../provider.tsx").useW6WApi>>;
type FlowStep = import("../flow-types.ts").FlowStep;

const APPS = [
  { id: "sendgrid", displayName: "SendGrid" },
  { id: "slack", displayName: "Slack" },
];

const ACTIONS_BY_APP: Record<string, { key: string; title: string; params?: unknown[] }[]> = {
  sendgrid: [
    { key: "send", title: "Send", params: [{ key: "subject", type: "string", label: "Subject" }] },
  ],
  slack: [{ key: "post-message", title: "Post message", params: [] }],
};

const CONNS_BY_APP: Record<
  string,
  { id: string; appId: string; authKey: string; displayName: string }[]
> = {
  sendgrid: [{ id: "conn_1", appId: "sendgrid", authKey: "apiKey", displayName: "prod" }],
  slack: [{ id: "conn_2", appId: "slack", authKey: "oauth2", displayName: "workspace" }],
};

/** A SendGrid-send-shaped fixture — the literal value U6 asserts against. */
const STEP: FlowStep = {
  id: "mail_1",
  uses: { app: "sendgrid", action: "send", connection: "conn_1" },
  with: { subject: "Hello" },
};

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listApps: async () => APPS,
    getAppAuth: async () => [],
    listConnectionsForApp: async (appId: string) => CONNS_BY_APP[appId] ?? [],
    listConnections: async () => [],
    getAppActions: async (appId: string) => ACTIONS_BY_APP[appId] ?? [],
    invokeAction: async () => ({ value: {} }),
    listStepTests: async () => [],
    saveStepTest: async () => ({ id: "t1" }),
    recordStepTestRun: async () => {},
    createConnection: async () => ({
      id: "c1",
      appId: "sendgrid",
      authKey: "apiKey",
      state: "ok" as const,
    }),
    startAppOAuthFlow: async () => ({ authorizationUrl: "" }),
    ...overrides,
  } as unknown as W6WApi;
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Mounts `StepEditModal` on the given step, clicks the Setup subtab, and
 *  returns the container plus a recording `onChange` sink — every assertion
 *  below reads THAT (the committed `FlowStep`), never component state. */
async function mountOnSetupTab(
  step: FlowStep,
  opts: { readOnly?: boolean; apiOverrides?: Record<string, unknown> } = {},
) {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  const changes: unknown[] = [];

  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi(opts.apiOverrides),
        children: React.createElement(ExpressionOptionsProvider, {
          value: { sampleValues: {} },
          children: React.createElement(StepEditModal, {
            workflowId: "wf_1",
            step,
            upstreamSteps: [],
            onChange: (next: unknown) => changes.push(next),
            onClose: () => {},
            readOnly: opts.readOnly,
          }),
        }),
      }),
    );
  });
  await flush();

  const setupTab = Array.from(container.querySelectorAll(".w6w-subtabs button")).find(
    (b) => b.textContent === "Setup",
  ) as HTMLButtonElement | undefined;
  assert.ok(setupTab, "the Setup subtab button should be present");
  await act(async () => {
    setupTab.click();
  });
  await flush();

  return { container, root, changes };
}

function setupFields(container: Element): Element[] {
  const stack = container.querySelector(".w6w-stepconfig-body .w6w-stack");
  assert.ok(stack, "the Setup tab's .w6w-stack should be present");
  return Array.from(stack.children).filter((el) => el.classList.contains("w6w-field"));
}

function changeButton(container: Element): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll(".w6w-stepconfig-body button")).find(
    (b) => b.textContent === "Change",
  ) as HTMLButtonElement | undefined;
  assert.ok(btn, "a Change button should be present on the Setup tab");
  return btn;
}

test("U1 — the combined App+Connection field renders before Action, in document order", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  const fields = setupFields(container);
  const labels = fields.map((f) => f.querySelector("span")?.textContent);
  assert.deepStrictEqual(
    labels,
    ["App", "Action"],
    "exactly two Setup fields, the combined App field first and Action second — no standalone Connection field",
  );
  await act(async () => {
    root.unmount();
  });
});

test("U2 — exactly one Change button, and the collapsed row names both the app and the connection", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  const buttons = Array.from(container.querySelectorAll(".w6w-stepconfig-body button")).filter(
    (b) => b.textContent === "Change",
  );
  assert.equal(
    buttons.length,
    1,
    "exactly one Change button — a two-button AppStepConfig port (D-1) would fail this",
  );
  const row = container.querySelector(".w6w-stepconfig-body .w6w-conn-label");
  assert.ok(row, "the collapsed field should render a .w6w-conn-label row");
  // `AppsCtx` is empty in this rig (D-P1) — the app label falls back to the
  // raw app id, exactly like the pre-existing App field always has.
  assert.ok(row.textContent?.includes("sendgrid"), "the row names the app");
  assert.ok(row.textContent?.includes("prod"), "the row names the connection");
  await act(async () => {
    root.unmount();
  });
});

test("U3 — readOnly disables the Change button", async () => {
  const { container, root } = await mountOnSetupTab(STEP, { readOnly: true });
  const btn = changeButton(container);
  assert.equal(btn.disabled, true);
  await act(async () => {
    root.unmount();
  });
});

test("U4 — clicking Change reveals an app <select> populated from listApps()", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  await act(async () => {
    changeButton(container).click();
  });
  await flush();

  const appSelect = container.querySelector('select[aria-label="App"]') as HTMLSelectElement | null;
  assert.ok(appSelect, "an app <select> should be present after Change");
  const values = Array.from(appSelect.options)
    .map((o) => o.value)
    .sort();
  assert.deepStrictEqual(values, ["sendgrid", "slack"], "options come from listApps()");

  const connSelect = container.querySelector(
    'select[aria-label="Connection"]',
  ) as HTMLSelectElement | null;
  assert.ok(connSelect, "a connection <select> for the selected app should be present too (A3)");

  await act(async () => {
    root.unmount();
  });
});

test("U5 — selecting a DIFFERENT app commits app/action/connection/with together, in one payload", async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    changeButton(container).click();
  });
  await flush();

  const appSelect = container.querySelector('select[aria-label="App"]') as HTMLSelectElement;
  await act(async () => {
    appSelect.value = "slack";
    appSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });

  assert.equal(changes.length, 1, "exactly one commit for the app switch");
  const payload = changes[0] as {
    uses: { app: string; action: string; connection?: string };
    with: unknown;
  };
  assert.equal(payload.uses.app, "slack");
  assert.equal(payload.uses.action, "");
  assert.equal(payload.uses.connection, undefined);
  assert.deepStrictEqual(payload.with, {});

  // The collapsed field is reachable again without remounting the modal (A3).
  await flush();
  assert.ok(
    container.querySelector(".w6w-stepconfig-body .w6w-conn-label"),
    "the field returns to its collapsed display after a pick",
  );

  await act(async () => {
    root.unmount();
  });
});

test("U6 — selecting the SAME app leaves uses.action and with deep-equal to the original fixture", async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    changeButton(container).click();
  });
  await flush();

  const appSelect = container.querySelector('select[aria-label="App"]') as HTMLSelectElement;
  await act(async () => {
    appSelect.value = "sendgrid";
    appSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });

  const payload = changes[changes.length - 1] as {
    uses: { app: string; action: string; connection?: string };
    with: unknown;
  };
  assert.equal(payload.uses.app, "sendgrid");
  // Literal fixture values, per the contract — never a value read back out of
  // the component's own rendered state.
  assert.equal(payload.uses.action, "send");
  assert.equal(payload.uses.connection, "conn_1");
  assert.deepStrictEqual(payload.with, { subject: "Hello" });

  await act(async () => {
    root.unmount();
  });
});

test("U7 — after switching app, the Action <select> lists the NEW app's actions and none of the old app's", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  await act(async () => {
    changeButton(container).click();
  });
  await flush();

  const appSelect = container.querySelector('select[aria-label="App"]') as HTMLSelectElement;
  await act(async () => {
    appSelect.value = "slack";
    appSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();

  const fields = setupFields(container);
  const actionField = fields.find((f) => f.querySelector("span")?.textContent === "Action");
  assert.ok(actionField, "the Action field should still be present");
  const actionSelect = actionField.querySelector("select") as HTMLSelectElement | null;
  assert.ok(actionSelect, "the Action field should render a <select> for a non-internal step");
  const optionValues = Array.from(actionSelect.options).map((o) => o.value);

  assert.ok(optionValues.includes("post-message"), "contains the new app's action");
  assert.equal(
    optionValues.includes("send"),
    false,
    "contains none of the old app's actions — a mutant that concatenates the two lists must fail this",
  );

  await act(async () => {
    root.unmount();
  });
});

test("U2/M4-guard — Change never renders twice (no AppStepConfig-shaped App-Change + Connection-Change pair)", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  const buttons = Array.from(container.querySelectorAll(".w6w-stepconfig-body button")).filter(
    (b) => b.textContent === "Change",
  );
  assert.equal(buttons.length, 1);
  await act(async () => {
    root.unmount();
  });
});

test("U8 — Configure tab: no element's text is the ports checkbox label, and NodeConfigForm's own fields still render", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi(),
        children: React.createElement(ExpressionOptionsProvider, {
          value: { sampleValues: {} },
          children: React.createElement(StepEditModal, {
            workflowId: "wf_1",
            step: STEP,
            upstreamSteps: [],
            onChange: () => {},
            onClose: () => {},
          }),
        }),
      }),
    );
  });
  await flush();
  // StepEditModal opens on Configure by default (props view) — no subtab
  // click needed, but `NodeConfigForm` lives behind the fourth "Node
  // settings" view of the props/code/params-code/config toggle.
  const nodeSettingsBtn = container.querySelector(
    '.w6w-view-toggle button[aria-label="Node settings"]',
  ) as HTMLButtonElement | null;
  assert.ok(nodeSettingsBtn, "the Node settings view toggle button should be present");
  await act(async () => {
    nodeSettingsBtn.click();
  });
  await flush();

  assert.equal(
    container.textContent?.includes("Accept multiple incoming connections"),
    false,
    "the ports checkbox is hidden (D-P2)",
  );
  assert.ok(
    container.textContent?.includes("Retry on failure"),
    "NodeConfigForm's Retry field still renders",
  );
  assert.ok(
    container.textContent?.includes("On error"),
    "NodeConfigForm's On error field still renders",
  );

  await act(async () => {
    root.unmount();
  });
});

test("U9 — the On error hint mentions retry, scoped to the hint element (not a file-wide match)", async () => {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi(),
        children: React.createElement(ExpressionOptionsProvider, {
          value: { sampleValues: {} },
          children: React.createElement(StepEditModal, {
            workflowId: "wf_1",
            step: STEP,
            upstreamSteps: [],
            onChange: () => {},
            onClose: () => {},
          }),
        }),
      }),
    );
  });
  await flush();
  const nodeSettingsBtn = container.querySelector(
    '.w6w-view-toggle button[aria-label="Node settings"]',
  ) as HTMLButtonElement | null;
  assert.ok(nodeSettingsBtn, "the Node settings view toggle button should be present");
  await act(async () => {
    nodeSettingsBtn.click();
  });
  await flush();

  const onErrorField = Array.from(container.querySelectorAll(".w6w-field")).find(
    (f) => f.querySelector("span")?.textContent === "On error",
  );
  assert.ok(onErrorField, "the On error field should be present");
  const hint = onErrorField.querySelector(".w6w-muted.w6w-small");
  assert.ok(hint, "the On error hint element should be present");
  assert.match(hint.textContent ?? "", /retr/i, "the hint now mentions retry running first");

  await act(async () => {
    root.unmount();
  });
});
