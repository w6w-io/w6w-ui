// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/StepBuilderModal.app-triggers.test.ts  (Node 24)
//
// T-0 (contract T1.1.3, Part B): the Triggers tab's "App triggers" section.
// Mirrors ../../__tests__/StepBuilderModal.commit.test.ts's JSDOM + react-dom
// mount rig.
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

// jsdom implements <dialog> as an element but not its imperative API — `Modal`
// (StepBuilderModal's wrapper) calls `showModal()` in a mount effect.
const dialogProto = dom.window.HTMLDialogElement?.prototype as unknown as Record<string, unknown>;
if (dialogProto && typeof dialogProto.showModal !== "function") {
  dialogProto.showModal = function showModal(this: HTMLElement) {
    this.setAttribute("open", "");
  };
  dialogProto.close = function close(this: HTMLElement) {
    this.removeAttribute("open");
  };
}

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { StepBuilderModal } = await import("../StepBuilderModal.tsx");
const { W6WUIProvider } = await import("../provider.tsx");
type W6WApi = Awaited<ReturnType<typeof import("../provider.tsx").useW6WApi>>;

/** The minimum `useReadyToUse` needs to settle, PLUS whatever `overrides`
 *  adds — `listTriggerApps`/`getAppTriggers`/`createSubscription` are NOT
 *  included here, so a test that never passes them in `overrides` gets an
 *  object that genuinely OMITS the key (case (c) — a `Proxy`-style
 *  answer-everything stub would defeat that assertion). */
function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listApps: async () => [],
    listConnections: async () => [],
    listFunctions: async () => [],
    listWorkflows: async () => [],
    ...overrides,
  } as unknown as W6WApi;
}

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

async function openTriggersTab(container: Element) {
  // Flush the useReadyToUse effect (Promise.all-ish, several api calls).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const triggersTab = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Triggers",
  );
  assert.ok(triggersTab, "the Triggers tab button must render");
  await act(async () => {
    triggersTab.click();
  });
}

const APP_TRIGGERS_TEXT = "App triggers";

test("(a) workflowId present + listTriggerApps present ⇒ the App-triggers section renders", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi({ listTriggerApps: async () => [] }),
        children: React.createElement(StepBuilderModal, {
          onClose: () => {},
          onAdd: () => "step_1",
          workflowId: "wf_1",
        }),
      }),
    );
  });
  await openTriggersTab(container);
  assert.ok(container.textContent?.includes(APP_TRIGGERS_TEXT), "the section must render");
  await act(async () => {
    root.unmount();
  });
});

test("(b) workflowId absent ⇒ the App-triggers section does not render", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi({ listTriggerApps: async () => [] }),
        children: React.createElement(StepBuilderModal, {
          onClose: () => {},
          onAdd: () => "step_1",
          // no workflowId
        }),
      }),
    );
  });
  await openTriggersTab(container);
  assert.ok(
    !container.textContent?.includes(APP_TRIGGERS_TEXT),
    "the section must NOT render without workflowId",
  );
  await act(async () => {
    root.unmount();
  });
});

test("(c) listTriggerApps absent ⇒ the App-triggers section does not render", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi(), // listTriggerApps genuinely omitted
        children: React.createElement(StepBuilderModal, {
          onClose: () => {},
          onAdd: () => "step_1",
          workflowId: "wf_1",
        }),
      }),
    );
  });
  await openTriggersTab(container);
  assert.ok(
    !container.textContent?.includes(APP_TRIGGERS_TEXT),
    "the section must NOT render when the api omits listTriggerApps",
  );
  await act(async () => {
    root.unmount();
  });
});

test("(d)+(e) choosing a trigger creates exactly one Subscription with the pinned shape, and onAdd is never called", async () => {
  const { container, root } = mountRoot();
  const onAddCalls: unknown[] = [];
  const createCalls: unknown[][] = [];
  const closeCalls: number[] = [];

  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi({
          listTriggerApps: async () => [{ id: "slack", displayName: "Slack" }],
          getAppTriggers: async (appId: string) => {
            assert.equal(appId, "slack");
            return [{ key: "new-message", title: "New Message" }];
          },
          createSubscription: async (...args: unknown[]) => {
            createCalls.push(args);
            return { id: "sub_1", appId: "slack", triggerKey: "new-message", workflowId: "wf_1" };
          },
        }),
        children: React.createElement(StepBuilderModal, {
          onClose: () => closeCalls.push(1),
          onAdd: (step: unknown) => {
            onAddCalls.push(step);
            return "step_1";
          },
          workflowId: "wf_1",
        }),
      }),
    );
  });
  await openTriggersTab(container);

  // Flush AppTriggersSection's `listTriggerApps()` fetch.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  const appCard = container.querySelector(".w6w-apppicker-card") as HTMLButtonElement | null;
  assert.ok(appCard, "the trigger-declaring app must render as a pickable card");
  assert.equal(createCalls.length, 0, "no create call before an app is even picked");

  await act(async () => {
    appCard.click();
  });
  // Flush AppTriggerPicker's `getAppTriggers()` fetch.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  const triggerButton = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("New Message"),
  ) as HTMLButtonElement | undefined;
  assert.ok(triggerButton, "the declared trigger must render as a pickable row");
  assert.equal(createCalls.length, 0, "no create call before the trigger is clicked");

  await act(async () => {
    triggerButton.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(createCalls.length, 1, "exactly one createSubscription call, on the click");
  assert.deepEqual(createCalls[0], [
    "slack",
    "new-message",
    { workflowId: "wf_1", connectionId: null, params: {} },
  ]);
  assert.equal(onAddCalls.length, 0, "onAdd must NEVER be called from the app-triggers section");
  assert.equal(closeCalls.length, 1, "the modal closes via onClose on success");

  await act(async () => {
    root.unmount();
  });
});
