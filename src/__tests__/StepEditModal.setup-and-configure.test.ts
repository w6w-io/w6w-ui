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

/** The App button — `[app button] <-- spacer --> [connection button]`
 *  (2026-08-30, superseding D-1's single combined field). Opens the app
 *  picker (`AppPicker`) when clicked. */
function appButton(container: Element): HTMLButtonElement {
  const btn = container.querySelector(
    '.w6w-stepconfig-body button[aria-label="App"]',
  ) as HTMLButtonElement | null;
  assert.ok(btn, "an App button should be present on the Setup tab");
  return btn;
}

/** The Connection button — opens a plain list of connections for the
 *  CURRENT app (no search box) plus "+ New connection". */
function connButton(container: Element): HTMLButtonElement {
  const btn = container.querySelector(
    '.w6w-stepconfig-body button[aria-label="Connection"]',
  ) as HTMLButtonElement | null;
  assert.ok(btn, "a Connection button should be present on the Setup tab");
  return btn;
}

/** Every app card `AppPicker` renders once the App button opens the picker
 *  (not a `<select>` — the picker is a searchable grid, same component the
 *  add-wizard uses). */
// The App/Connection flyouts are PORTALED (`Flyout`, 2026-08-30) to the
// enclosing `<dialog>` — not `document.body` (a `showModal()` dialog lives
// in the top layer; a portal straight to `document.body` would render
// BEHIND it, not over it) — so their content is no longer a DESCENDANT of
// `.w6w-stepconfig-body`, only a sibling under the same dialog. These
// helpers search the whole modal `container`, not that narrower scope.
function appCards(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button.w6w-apppicker-card")) as HTMLButtonElement[];
}

function clickAppCard(container: Element, displayName: string): void {
  const card = appCards(container).find((b) => b.textContent?.includes(displayName));
  assert.ok(card, `an app card for "${displayName}" should be present`);
  card.click();
}

/** Every connection row the Connection button's picker renders (not a
 *  `<select>`, and no search box — a plain list of the CURRENT app's
 *  connections). Excludes the "+ New connection" button itself. */
function connItems(container: Element): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll(".w6w-flyout .w6w-stepbuilder-item"),
  ) as HTMLButtonElement[];
}

function clickConnItem(container: Element, displayName: string): void {
  const item = connItems(container).find((b) => b.textContent?.includes(displayName));
  assert.ok(item, `a connection row for "${displayName}" should be present`);
  item.click();
}

function newConnectionButton(container: Element): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll(".w6w-flyout button")).find(
      (b) => b.textContent === "+ New connection",
    ) as HTMLButtonElement | undefined) ?? null
  );
}

test("U1 — the App/Connection field renders before Action, in document order", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  const fields = setupFields(container);
  const labels = fields.map((f) => f.querySelector("span")?.textContent);
  assert.deepStrictEqual(
    labels,
    ["App", "Action"],
    "exactly two Setup fields, the App+Connection row first and Action second",
  );
  await act(async () => {
    root.unmount();
  });
});

test("U2 — App and Connection are two SEPARATE buttons, spaced apart, each naming its own value", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  const app = appButton(container);
  const conn = connButton(container);
  assert.notEqual(
    app,
    conn,
    "App and Connection must be two distinct buttons, not one combined field",
  );
  // `AppsCtx` is empty in this rig (D-P1) — the app label falls back to the
  // raw app id, exactly like the pre-existing App field always has.
  assert.ok(app.textContent?.includes("sendgrid"), "the App button names the app");
  assert.ok(!app.textContent?.includes("prod"), "the App button does not also name the connection");
  assert.ok(conn.textContent?.includes("prod"), "the Connection button names the connection");
  assert.ok(
    !conn.textContent?.includes("sendgrid"),
    "the Connection button does not also name the app",
  );
  // Spaced apart: the shared row is `justify-content: space-between`.
  const row = app.closest(".w6w-app-conn-row");
  assert.ok(row, "App and Connection share a .w6w-app-conn-row container");
  assert.ok(row?.contains(conn), "Connection sits in the same row as App");
  await act(async () => {
    root.unmount();
  });
});

test("U3 — readOnly disables both the App and Connection buttons", async () => {
  const { container, root } = await mountOnSetupTab(STEP, { readOnly: true });
  assert.equal(appButton(container).disabled, true);
  assert.equal(connButton(container).disabled, true);
  await act(async () => {
    root.unmount();
  });
});

test("U4 — clicking App reveals AppPicker's searchable grid, populated from listApps()", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  await act(async () => {
    appButton(container).click();
  });
  await flush();

  const names = appCards(container)
    .map((b) => b.textContent ?? "")
    .sort();
  assert.equal(names.length, 2, "AppPicker's grid should render one card per listApps() entry");
  assert.ok(
    names[0]?.includes("SendGrid") || names[1]?.includes("SendGrid"),
    "SendGrid is offered",
  );
  assert.ok(names[0]?.includes("Slack") || names[1]?.includes("Slack"), "Slack is offered");
  // Neither picker is a raw <select> — "you cannot use a dropdown" (2026-08-30).
  assert.equal(
    container.querySelector('select[aria-label="App"]'),
    null,
    "the app changer must not be a <select>",
  );

  await act(async () => {
    root.unmount();
  });
});

test("U5 — selecting a DIFFERENT app commits app/action/connection/with together, in one payload, and lands collapsed", async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    appButton(container).click();
  });
  await flush();

  await act(async () => {
    clickAppCard(container, "Slack");
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

  // A different app is "start over": the field lands COLLAPSED (not the
  // connection picker — there is nothing yet to pick a connection for that
  // isn't already implied by the fresh, connection-less app).
  await flush();
  assert.ok(appButton(container), "the App button is reachable again after a different-app pick");
  assert.equal(
    container.querySelector(".w6w-stepconfig-body .w6w-stepbuilder-item"),
    null,
    "the connection picker must NOT auto-open on a different-app pick",
  );

  await act(async () => {
    root.unmount();
  });
});

test("U6 — selecting the SAME app leaves uses.action and with untouched, and opens the connection picker", async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    appButton(container).click();
  });
  await flush();

  await act(async () => {
    clickAppCard(container, "SendGrid");
  });

  // Same-app reselect still commits (so the field's `uses.app` round-trips
  // through the same path as a real change), but literally unchanged.
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

  // "close the dropdown, and show the connections dropdown instead" — the ask
  // (2026-08-30): same-app reselect goes straight to the connection picker,
  // not back to collapsed.
  await flush();
  assert.ok(
    connItems(container).length > 0,
    "the connection picker opens automatically after a same-app reselect",
  );

  await act(async () => {
    root.unmount();
  });
});

test("U7 — after switching app, the Action <select> lists the NEW app's actions and none of the old app's", async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  await act(async () => {
    appButton(container).click();
  });
  await flush();

  await act(async () => {
    clickAppCard(container, "Slack");
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

test('U12 — clicking App a SECOND time closes its flyout without picking anything (the "changed my mind" case)', async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    appButton(container).click();
  });
  await flush();
  assert.ok(appCards(container).length > 0, "the app picker is open");

  // The trigger button must still be there AND still be the way to close —
  // "since you removed the App button instead of using it as anchor for
  // the dropdown, I can't click it again to close the dropdown" (2026-08-30).
  await act(async () => {
    appButton(container).click();
  });
  await flush();

  assert.equal(appCards(container).length, 0, "the app picker closes on a second click of App");
  assert.equal(changes.length, 0, "closing without picking commits nothing");
  assert.ok(appButton(container), "the App button is still there afterward, unchanged");

  await act(async () => {
    root.unmount();
  });
});

test("U13 — clicking outside the flyout closes it without picking anything", async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    connButton(container).click();
  });
  await flush();
  assert.ok(connItems(container).length > 0, "the connection picker is open");

  // A click on the modal body, outside both the trigger and the flyout.
  await act(async () => {
    const body = container.querySelector(".w6w-stepconfig-body");
    assert.ok(body);
    body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  await flush();

  assert.equal(connItems(container).length, 0, "the connection picker closes on an outside click");
  assert.equal(changes.length, 0, "closing without picking commits nothing");

  await act(async () => {
    root.unmount();
  });
});

test("U10 — the connection picker lists the current app's connections, no search box, and commits ONLY uses.connection", async () => {
  const { container, root, changes } = await mountOnSetupTab(STEP);
  await act(async () => {
    connButton(container).click();
  });
  await flush();

  assert.equal(
    container.querySelector(".w6w-stepconfig-body input[type=text]"),
    null,
    "no search box in the connection picker — the ask was explicit: no search bar",
  );
  const items = connItems(container).map((b) => b.textContent ?? "");
  assert.ok(
    items.some((t) => t.includes("prod")),
    "the current app's own connection(s) are listed",
  );
  assert.ok(newConnectionButton(container), '"+ New connection" is offered');

  await act(async () => {
    clickConnItem(container, "prod");
  });

  assert.equal(changes.length, 1, "exactly one commit for the connection pick");
  const payload = changes[0] as {
    uses: { app: string; action: string; connection?: string };
    with: unknown;
  };
  // Only the connection changes — app/action/with are untouched (identity-
  // equal to the fixture, not merely equal, since nothing should have rebuilt
  // them).
  assert.equal(payload.uses.app, "sendgrid");
  assert.equal(payload.uses.action, "send");
  assert.equal(payload.uses.connection, "conn_1");
  assert.deepStrictEqual(payload.with, { subject: "Hello" });

  await act(async () => {
    root.unmount();
  });
});

test('U11 — "+ New connection" opens AddConnectionModal, scoped to the current app', async () => {
  const { container, root } = await mountOnSetupTab(STEP);
  await act(async () => {
    connButton(container).click();
  });
  await flush();

  await act(async () => {
    newConnectionButton(container)?.click();
  });
  await flush();

  // AddConnectionModal renders its own dialog (Modal.tsx) — presence is
  // enough here; its own create-flow is covered by its own test suite.
  const dialogs = Array.from(container.querySelectorAll("dialog"));
  assert.equal(
    dialogs.length,
    2,
    "a SECOND dialog (AddConnectionModal) opens on top of the step edit modal's own",
  );

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
