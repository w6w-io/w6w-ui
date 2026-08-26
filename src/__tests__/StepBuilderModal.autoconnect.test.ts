// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/StepBuilderModal.autoconnect.test.ts  (Node 24)
//
// T4.2.1 — `AppStepConfig`'s third connection state: an app's `tenantAuth`/`jit`
// method is auto-satisfied for the calling scope's tenant (T3.1.1's new
// `AuthDef.autoSatisfied` field). Mirrors the harness `StepBuilderModal.commit.test.ts`
// establishes (jsdom globals, the `IS_REACT_ACT_ENVIRONMENT` flag, the dynamic
// imports, `fakeApi()`, and the `onAdd` capture) — that file already mounts
// `AppStepConfig` through `W6WUIProvider` and asserts on the committed step's
// `uses`, which is exactly the assertion surface this node needs.
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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { AppStepConfig } = await import("../StepBuilderModal.tsx");
const { W6WUIProvider } = await import("../provider.tsx");
type W6WApi = Awaited<ReturnType<typeof import("../provider.tsx").useW6WApi>>;
type AuthDefLike = { key: string; type: string; available?: boolean; autoSatisfied?: boolean };
type ConnLike = { id: string; appId?: string; authKey?: string; state?: string };

function fakeApi(
  getAppAuth: () => Promise<AuthDefLike[]>,
  listConnectionsForApp: () => Promise<ConnLike[]>,
): W6WApi {
  return {
    listApps: async () => [],
    getAppAuth,
    listConnectionsForApp,
    listConnections: async () => [],
    getAppActions: async () => [
      {
        key: "send",
        title: "Send",
        params: [],
      },
    ],
    invokeAction: async () => ({ value: {} }),
    listSavedTests: async () => [],
    createSavedTest: async () => ({}),
    updateSavedTest: async () => ({}),
    deleteSavedTest: async () => {},
    recordTestRun: async () => {},
    saveStepTest: async () => ({ id: "t1" }),
    recordStepTestRun: async () => {},
    createConnection: async () => ({
      id: "c1",
      appId: "sendgrid",
      authKey: "apiKey",
      state: "ok" as const,
    }),
    startAppOAuthFlow: async () => ({ authorizationUrl: "" }),
    listStepTests: async () => [],
  } as unknown as W6WApi;
}

// `T` per the contract's table: a `tenantAuth`-typed method, otherwise `available`.
const T = { key: "tenant", type: "tenantAuth", available: true };

async function mount(
  getAppAuth: () => Promise<AuthDefLike[]>,
  listConnectionsForApp: () => Promise<ConnLike[]>,
) {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  const onAddCalls: unknown[] = [];
  const onAdd = (step: unknown) => {
    onAddCalls.push(step);
    return "step_1"; // simulates addBuiltStep's minted id
  };
  // Progressive commit (T1.1.x) fires `onAdd` the moment Setup completes only
  // when `onDraftChange` is supplied — same wiring `commit.test.ts` uses to pin
  // the "picking the action commits" assertion; a no-op capture is enough here.
  const onDraftChange = () => {};

  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi(getAppAuth, listConnectionsForApp),
        children: React.createElement(AppStepConfig, {
          appId: "sendgrid",
          app: { id: "sendgrid", displayName: "SendGrid" },
          onAdd,
          onClose: () => {},
          onDraftChange,
        }),
      }),
    );
  });
  // Flush the auth/actions/connections effects (Promise.all in a useEffect).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  return { container, root, onAddCalls };
}

async function pickAction(container: Element) {
  const select = container.querySelector("select") as HTMLSelectElement | null;
  assert.ok(select, "action <select> should be present on the Setup tab");
  await act(async () => {
    select.value = "send";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

// Case A — auto-satisfied, no existing connections: picking the action
// completes setup with no connection, and the passive copy (P3 + P3a) renders.
test("case A: auto-satisfied with no connections — commits with no `connection`, passive copy renders", async () => {
  const { container, root, onAddCalls } = await mount(
    async () => [{ ...T, autoSatisfied: true }],
    async () => [],
  );

  await pickAction(container);

  assert.equal(onAddCalls.length, 1, "picking the action fires onAdd exactly once");
  assert.deepEqual((onAddCalls[0] as { uses: unknown }).uses, {
    app: "sendgrid",
    action: "send",
  });

  const selects = container.querySelectorAll("select");
  assert.equal(selects.length, 1, "only the action <select> renders — no connection picker");

  const text = container.textContent ?? "";
  assert.ok(
    text.includes("Connected automatically") && text.includes("this app needs no connection"),
    "P3's passive copy must be present",
  );
  assert.ok(
    text.includes("scheduled or queued run") && text.includes("still needs a connection"),
    "P3a's queued-run caveat must be present",
  );
  assert.ok(
    Array.from(container.querySelectorAll("button")).some(
      (b) => b.textContent === "Create connection",
    ),
    "the escape hatch to AddConnectionModal must be reachable",
  );

  await act(async () => {
    root.unmount();
  });
});

// Case B — no autoSatisfied, an existing connection: today's behaviour,
// unchanged. Pins the read to the FIELD, not to the auth TYPE.
test('case B: not auto-satisfied, has a connection — commits with `connection: "c1"` (unchanged)', async () => {
  const { container, root, onAddCalls } = await mount(
    async () => [{ ...T }],
    async () => [{ id: "c1", appId: "sendgrid", authKey: "tenant", state: "connected" }],
  );

  await pickAction(container);

  assert.equal(onAddCalls.length, 1, "picking the action fires onAdd exactly once");
  assert.equal((onAddCalls[0] as { uses: { connection?: string } }).uses.connection, "c1");

  await act(async () => {
    root.unmount();
  });
});

// Case C — auto-satisfied WITH an existing connection: P2's suppressed
// auto-select — the load effect must not silently pick the existing connection.
test("case C: auto-satisfied with an existing connection — still commits with no `connection`", async () => {
  const { container, root, onAddCalls } = await mount(
    async () => [{ ...T, autoSatisfied: true }],
    async () => [{ id: "c1", appId: "sendgrid", authKey: "tenant", state: "connected" }],
  );

  await pickAction(container);

  assert.equal(onAddCalls.length, 1);
  const uses = (onAddCalls[0] as { uses: Record<string, unknown> }).uses;
  assert.ok(!("connection" in uses), "an existing connection must not be silently auto-selected");

  await act(async () => {
    root.unmount();
  });
});

// Case D — an oauth2 method AND an auto-satisfied tenantAuth method: the
// auto-satisfied state wins per `.some(...)` (P1, note 1) — no connection
// picker, no `connection` key.
test("case D: oauth2 + auto-satisfied tenantAuth — auto-satisfied wins", async () => {
  const { container, root, onAddCalls } = await mount(
    async () => [
      { key: "oauth", type: "oauth2", available: true },
      { ...T, autoSatisfied: true },
    ],
    async () => [],
  );

  await pickAction(container);

  assert.equal(onAddCalls.length, 1);
  const selects = container.querySelectorAll("select");
  assert.equal(selects.length, 1, "no connection <select> renders");
  const uses = (onAddCalls[0] as { uses: Record<string, unknown> }).uses;
  assert.ok(!("connection" in uses));

  await act(async () => {
    root.unmount();
  });
});

// Case E — not auto-satisfied, no connections: the app still needs a
// connection before setup completes; picking the action alone must not fire onAdd.
test("case E: not auto-satisfied, no connections — picking the action does not commit", async () => {
  const { container, root, onAddCalls } = await mount(
    async () => [{ ...T }],
    async () => [],
  );

  await pickAction(container);

  assert.equal(onAddCalls.length, 0, "the app still needs a connection first");

  await act(async () => {
    root.unmount();
  });
});
