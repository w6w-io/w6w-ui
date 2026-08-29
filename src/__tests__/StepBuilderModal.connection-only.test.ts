// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/StepBuilderModal.connection-only.test.ts  (Node 24)
//
// T2.1.1 U2-U7b — `StepBuilderModal`'s `appsFilter`/`connectionOnly`/`onConnected`
// battery (A2, A3). Two rigs, neither invented here:
//
//   - U2-U4: the whole-modal jsdom rig `StepBuilderModal.homepage-tabs.test.ts`
//     establishes (`makeApi`/`withModal`, `react-dom/client` + `act`, the
//     `<dialog>` shim).
//   - U5-U7b: the recording-fake-api rig `StepBuilderModal.autoconnect.test.ts`
//     establishes (a fake `W6WApi` with call tracking, `initialApp` to skip
//     straight past the picker into the `selectedApp` branch).
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// ---- jsdom bootstrap, verbatim from both rigs above ----
const g = globalThis as unknown as Record<string, unknown>;
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>");
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
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

// jsdom implements <dialog> as an element but not its imperative API.
const proto = dom.window.HTMLDialogElement?.prototype as unknown as Record<string, unknown>;
if (proto && typeof proto.showModal !== "function") {
  proto.showModal = function showModal(this: HTMLElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLElement) {
    this.removeAttribute("open");
  };
}

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { StepBuilderModal } = await import("../StepBuilderModal.tsx");
const { W6WUIProvider } = await import("../provider.tsx");

// ---- shared fixtures ----

// Two apps that disagree — a one-app fixture cannot distinguish "filtered
// correctly" from "filtered to nothing" from "not filtered at all" (test
// plan's own note on U2-U4's fixture shape).
const SLACK = { id: "slack", displayName: "Slack" };
const GITHUB = { id: "io.w6w.github", displayName: "GitHub" };
const GITHUB_FILTER = (a: { id: string }) => a.id === "io.w6w.github";

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ── U2-U4 rig: the whole-modal home/apps tabs ───────────────────────────────

interface WholeFixture {
  apps?: Array<Record<string, unknown>>;
  connections?: Array<{ appId: string }>;
}

function makeApi(f: WholeFixture = {}) {
  return new Proxy(
    {
      listApps: () => Promise.resolve(f.apps ?? []),
      listConnections: () => Promise.resolve(f.connections ?? []),
      listFunctions: () => Promise.resolve([]),
      listWorkflows: () => Promise.resolve([]),
    } as Record<string, unknown>,
    {
      get(t, k: string) {
        if (k in t) return t[k];
        return () => Promise.resolve([]);
      },
    },
  );
}

async function mountWhole(props: Record<string, unknown>, fixture: WholeFixture = {}) {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        W6WUIProvider,
        { api: makeApi(fixture) as never, children: null } as never,
        React.createElement(StepBuilderModal, {
          onClose: () => {},
          onAdd: () => {},
          appsOnly: true,
          callables: [],
          ...props,
        } as never),
      ),
    );
  });
  await flush();
  return { container, root };
}

async function clickTab(container: Element, label: string) {
  const btn = Array.from(container.querySelectorAll(".w6w-stepbuilder-tab")).find(
    (el) => (el.textContent || "").trim() === label,
  ) as HTMLElement | undefined;
  assert.ok(btn, `tab "${label}" not found`);
  await act(async () => {
    btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const readAppIds = () =>
  Array.from(document.querySelectorAll(".w6w-apppicker-card-id")).map((el) =>
    (el.textContent || "").trim(),
  );
const readTabs = (container: Element) =>
  Array.from(container.querySelectorAll(".w6w-stepbuilder-tab")).map((el) =>
    (el.textContent || "").trim(),
  );
const openTab = (container: Element) =>
  Array.from(container.querySelectorAll(".w6w-stepbuilder-tab.active")).map((el) =>
    (el.textContent || "").trim(),
  )[0] ?? null;
const readConnectedAppNames = () =>
  Array.from(document.querySelectorAll(".w6w-readytouse .w6w-stepbuilder-item strong")).map((el) =>
    (el.textContent || "").trim(),
  );

test("U2 — appsFilter reaches the Apps tab's <AppPicker>", async () => {
  const { container, root } = await mountWhole(
    { appsFilter: GITHUB_FILTER },
    { apps: [SLACK, GITHUB], connections: [] },
  );
  await clickTab(container, "Apps");
  assert.deepEqual(
    readAppIds(),
    ["io.w6w.github"],
    "the Apps tab must show only the app appsFilter allows through",
  );
  await act(async () => {
    root.unmount();
  });
});

test('U3 — appsFilter reaches useReadyToUse: the filtered-out connected app hides "Ready to use" and the open tab falls to Apps', async () => {
  const { container, root } = await mountWhole(
    { appsFilter: GITHUB_FILTER },
    { apps: [SLACK, GITHUB], connections: [{ appId: "slack" }] },
  );
  const tabs = readTabs(container);
  assert.ok(
    !tabs.includes("Ready to use"),
    `"Ready to use" must not appear when the only connected app is filtered out; got ${JSON.stringify(tabs)}`,
  );
  assert.equal(openTab(container), "Apps", "the auto-fallback must land on Apps, not Ready to use");
  await act(async () => {
    root.unmount();
  });
});

test('U4a — with both apps connected, "Ready to use" is present and scoped to the appsFilter-allowed app only', async () => {
  const { container, root } = await mountWhole(
    { appsFilter: GITHUB_FILTER },
    { apps: [SLACK, GITHUB], connections: [{ appId: "slack" }, { appId: "io.w6w.github" }] },
  );
  const tabs = readTabs(container);
  assert.ok(
    tabs.includes("Ready to use"),
    `"Ready to use" must be present; got ${JSON.stringify(tabs)}`,
  );
  assert.deepEqual(readConnectedAppNames(), ["GitHub"]);
  await act(async () => {
    root.unmount();
  });
});

test('U4b — with no appsFilter, "Ready to use" is present with BOTH connected apps (an undefined filter is a no-op, never a hide-everything default)', async () => {
  const { container, root } = await mountWhole(
    {},
    { apps: [SLACK, GITHUB], connections: [{ appId: "slack" }, { appId: "io.w6w.github" }] },
  );
  const tabs = readTabs(container);
  assert.ok(
    tabs.includes("Ready to use"),
    `"Ready to use" must be present; got ${JSON.stringify(tabs)}`,
  );
  assert.deepEqual(readConnectedAppNames(), ["GitHub", "Slack"]);
  await act(async () => {
    root.unmount();
  });
});

// ── U5-U7b rig: connectionOnly / AppConnectionOnlyConfig, via initialApp ───

type AuthDefLike = { key: string; type: string; available?: boolean; autoSatisfied?: boolean };
type ConnLike = { id: string; appId?: string; displayName?: string; state?: string };

function makeConnApi(opts: { auths?: AuthDefLike[]; conns?: ConnLike[] } = {}) {
  const getAppActionsCalls: string[] = [];
  const api = {
    listApps: async () => [],
    listConnections: async () => [],
    listFunctions: async () => [],
    listWorkflows: async () => [],
    getAppAuth: async () => opts.auths ?? [],
    listConnectionsForApp: async () => opts.conns ?? [],
    getAppActions: async (appId: string) => {
      getAppActionsCalls.push(appId);
      // A non-empty return is deliberate: if the mutant under test (U5/U6)
      // mounts AppStepConfig instead of AppConnectionOnlyConfig, this is what
      // would populate its Action <select> — so a false negative on "no
      // action option rendered" can't hide behind an empty actions list.
      return [{ key: "send", title: "Send", params: [] }];
    },
  };
  return { api, getAppActionsCalls };
}

async function mountConnOnly(props: Record<string, unknown>, api: unknown) {
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: api as never,
        children: React.createElement(StepBuilderModal, {
          onClose: () => {},
          onAdd: () => {},
          appsOnly: true,
          callables: [],
          initialApp: GITHUB,
          ...props,
        }),
      }),
    );
  });
  await flush();
  return { container, root };
}

test("U5 — connectionOnly + initialApp renders zero .w6w-subtab and no action-bearing <select>", async () => {
  const { api } = makeConnApi({
    auths: [{ key: "tenant", type: "apiKey", available: true }],
    conns: [],
  });
  const { root } = await mountConnOnly({ connectionOnly: true }, api);

  assert.equal(document.querySelectorAll(".w6w-subtab").length, 0);
  const optionValues = Array.from(document.querySelectorAll("select option")).map(
    (o) => (o as HTMLOptionElement).value,
  );
  assert.ok(
    !optionValues.includes("send"),
    `no action-bearing <select> should render; option values were ${JSON.stringify(optionValues)}`,
  );

  await act(async () => {
    root.unmount();
  });
});

test("U6 — AppConnectionOnlyConfig never calls getAppActions", async () => {
  const { api, getAppActionsCalls } = makeConnApi({
    auths: [{ key: "tenant", type: "apiKey", available: true }],
    conns: [],
  });
  const { root } = await mountConnOnly({ connectionOnly: true }, api);

  assert.equal(getAppActionsCalls.length, 0);

  await act(async () => {
    root.unmount();
  });
});

test("U7 — onConnected fires only on the footer button (never on auto-select), carrying (connectionId, app)", async () => {
  const calls: Array<[string, unknown]> = [];
  const { api } = makeConnApi({
    auths: [{ key: "tenant", type: "apiKey", available: true }],
    conns: [{ id: "c1", appId: "io.w6w.github", displayName: "Conn A" }],
  });
  const { root } = await mountConnOnly(
    {
      connectionOnly: true,
      onConnected: (connectionId: string, app: unknown) => calls.push([connectionId, app]),
    },
    api,
  );

  assert.equal(
    calls.length,
    0,
    "auto-selecting the sole existing connection must not fire onConnected",
  );

  const footerButtons = Array.from(document.querySelectorAll(".w6w-stepconfig-footer button"));
  const nextBtn = footerButtons.find((b) => (b.textContent || "").trim() === "Next →") as
    | HTMLElement
    | undefined;
  assert.ok(nextBtn, "the footer's action button must be present");
  await act(async () => {
    nextBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

  assert.equal(calls.length, 1, "must fire exactly once, on click");
  assert.equal(calls[0][0], "c1");
  assert.deepEqual(calls[0][1], GITHUB);

  await act(async () => {
    root.unmount();
  });
});

test("U7b — WITHOUT connectionOnly, the same initialApp still renders all three AppStepConfig subtabs", async () => {
  const { api } = makeConnApi({
    auths: [{ key: "tenant", type: "apiKey", available: true }],
    conns: [],
  });
  const { root } = await mountConnOnly({}, api);

  assert.equal(document.querySelectorAll(".w6w-subtab").length, 3);

  await act(async () => {
    root.unmount();
  });
});
