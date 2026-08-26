// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/WorkflowFlowEditor.webhook-url.test.ts  (Node 24)
//
// I-2 (contract T1.1.3, Part B): StepEditModal's Configure tab "Webhook URL"
// panel. Mirrors ./StepBuilderModal.commit.test.ts's JSDOM + react-dom rig.
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

// Mirrors `WorkflowFlowEditor.test-tab.test.ts`'s shims — this file also
// mounts `StepEditModal` (Modal's `<dialog>` + `@xyflow/react`'s CSS import;
// CodeMirror's RAF use is defensive, this suite's Configure tab never
// switches to the "code" view).
g.Window = dom.window.Window;
const raf = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.requestAnimationFrame = raf;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
(dom.window as unknown as Record<string, unknown>).requestAnimationFrame = raf;
(dom.window as unknown as Record<string, unknown>).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as NodeJS.Timeout);

// jsdom doesn't implement <dialog>'s imperative API — `Modal.tsx` calls
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
type W6WApi = Awaited<ReturnType<typeof import("../provider.tsx").useW6WApi>>;

const WEBHOOK_STEP = {
  id: "step_1",
  uses: { app: "@w6w/webhook", action: "webhook" },
  with: {},
};
// The M7 discriminator: `isTriggerApp("@w6w/trigger")` is ALSO true, so a
// guard accidentally widened from `=== WEBHOOK_APP` to `isTriggerApp(...)`
// would still (wrongly) show the panel for this fixture — a plain,
// non-trigger app step would not distinguish that mutation.
const MANUAL_STEP = {
  id: "step_2",
  uses: { app: "@w6w/trigger", action: "manual" },
  with: {},
};

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listStepTests: async () => [],
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

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

test("(a) an existing subscription renders its webhookUrl and makes zero createSubscription calls", async () => {
  const { container, root } = mountRoot();
  const createCalls: unknown[] = [];
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi({
          listSubscriptionsForWorkflow: async () => [
            {
              id: "sub_1",
              appId: "@w6w/webhook",
              triggerKey: "webhook",
              workflowId: "wf_1",
              connectionId: null,
              webhookUrl: "https://api.example/triggers/webhooks/sub_1",
            },
          ],
          createSubscription: async (...args: unknown[]) => {
            createCalls.push(args);
            throw new Error("must not be called");
          },
        }),
        children: React.createElement(StepEditModal, {
          workflowId: "wf_1",
          step: WEBHOOK_STEP,
          upstreamSteps: [],
          onChange: () => {},
          onClose: () => {},
        }),
      }),
    );
  });
  await flush();

  // React sets an <input>'s displayed value via the DOM `.value` PROPERTY,
  // not the `value` attribute or any text node — `textContent` never sees it.
  const urlInput = container.querySelector(
    'input[aria-label="Webhook URL"]',
  ) as HTMLInputElement | null;
  assert.ok(urlInput, "the webhook URL <input> must render");
  assert.equal(urlInput.value, "https://api.example/triggers/webhooks/sub_1");
  assert.equal(createCalls.length, 0, "an existing subscription must never trigger a create call");
  assert.equal(
    container.textContent?.includes("Create webhook URL"),
    false,
    "no create button once a subscription already exists",
  );

  await act(async () => {
    root.unmount();
  });
});

test("(b) no subscription: mount + a re-render make zero calls; the click makes exactly one, with params === step.with", async () => {
  const { container, root } = mountRoot();
  const createCalls: unknown[][] = [];
  let latestWith: Record<string, unknown> = {};

  const render = () =>
    act(async () => {
      root.render(
        React.createElement(W6WUIProvider, {
          api: fakeApi({
            listSubscriptionsForWorkflow: async () => [],
            createSubscription: async (...args: unknown[]) => {
              createCalls.push(args);
              return {
                id: "sub_new",
                appId: "@w6w/webhook",
                triggerKey: "webhook",
                workflowId: "wf_1",
                connectionId: null,
                webhookUrl: "https://api.example/triggers/webhooks/sub_new",
              };
            },
          }),
          children: React.createElement(StepEditModal, {
            workflowId: "wf_1",
            step: WEBHOOK_STEP,
            upstreamSteps: [],
            onChange: (next: { with?: Record<string, unknown> }) => {
              latestWith = next.with ?? {};
            },
            onClose: () => {},
          }),
        }),
      );
    });

  await render();
  await flush();
  assert.equal(createCalls.length, 0, "no create call on mount alone");

  // A re-render with the SAME modal instance still mounted (not a fresh
  // mount) — the shape a mount-only probe cannot catch (see this file's
  // sibling contract note). Change the "Authentication" <select>, which
  // commits a new `step.with` and re-renders the whole tree in place.
  const authSelect = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "basic"),
  ) as HTMLSelectElement | undefined;
  assert.ok(authSelect, "the webhook step's Authentication <select> must render");
  await act(async () => {
    authSelect.value = "basic";
    authSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await flush();

  assert.equal(
    createCalls.length,
    0,
    "a re-render with the modal still mounted must not trigger a create call either",
  );

  const createButton = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === "Create webhook URL",
  ) as HTMLButtonElement | undefined;
  assert.ok(createButton, "the create button must render while no subscription exists");

  await act(async () => {
    createButton.click();
  });
  await flush();

  assert.equal(createCalls.length, 1, "exactly one createSubscription call, on the click");
  const [appId, triggerKey, input] = createCalls[0] as [
    string,
    string,
    { workflowId: string; connectionId: string | null; params: Record<string, unknown> },
  ];
  assert.equal(appId, "@w6w/webhook");
  assert.equal(triggerKey, "webhook");
  assert.equal(input.workflowId, "wf_1");
  assert.equal(input.connectionId, null);
  assert.deepEqual(input.params, latestWith, "params must equal the step's own current `with`");

  const newUrlInput = container.querySelector(
    'input[aria-label="Webhook URL"]',
  ) as HTMLInputElement | null;
  assert.ok(newUrlInput, "the newly created webhookUrl <input> must render");
  assert.equal(newUrlInput.value, "https://api.example/triggers/webhooks/sub_new");

  await act(async () => {
    root.unmount();
  });
});

test("(c) a non-webhook (manual trigger) step renders no Webhook URL block", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi({
          listSubscriptionsForWorkflow: async () => [],
          createSubscription: async () => {
            throw new Error("must not be called");
          },
        }),
        children: React.createElement(StepEditModal, {
          workflowId: "wf_1",
          step: MANUAL_STEP,
          upstreamSteps: [],
          onChange: () => {},
          onClose: () => {},
        }),
      }),
    );
  });
  await flush();

  assert.equal(
    container.textContent?.includes("Webhook URL"),
    false,
    "a manual-trigger step must not render the webhook panel",
  );
  assert.equal(container.textContent?.includes("Create webhook URL"), false);

  await act(async () => {
    root.unmount();
  });
});

test("(d) readOnly hides the create button; an existing URL still renders", async () => {
  // Arm 1: no subscription + readOnly ⇒ no create button.
  {
    const { container, root } = mountRoot();
    await act(async () => {
      root.render(
        React.createElement(W6WUIProvider, {
          api: fakeApi({
            listSubscriptionsForWorkflow: async () => [],
            createSubscription: async () => {
              throw new Error("must not be called");
            },
          }),
          children: React.createElement(StepEditModal, {
            workflowId: "wf_1",
            step: WEBHOOK_STEP,
            upstreamSteps: [],
            onChange: () => {},
            onClose: () => {},
            readOnly: true,
          }),
        }),
      );
    });
    await flush();
    assert.equal(
      container.textContent?.includes("Create webhook URL"),
      false,
      "readOnly must hide the create button",
    );
    await act(async () => {
      root.unmount();
    });
  }

  // Arm 2: existing subscription + readOnly ⇒ the URL still renders.
  {
    const { container, root } = mountRoot();
    await act(async () => {
      root.render(
        React.createElement(W6WUIProvider, {
          api: fakeApi({
            listSubscriptionsForWorkflow: async () => [
              {
                id: "sub_1",
                appId: "@w6w/webhook",
                triggerKey: "webhook",
                workflowId: "wf_1",
                connectionId: null,
                webhookUrl: "https://api.example/triggers/webhooks/sub_1",
              },
            ],
            // Present (per B-6's presence gate) even though `readOnly` means
            // it's never invoked — arm 1 above covers "absent entirely".
            createSubscription: async () => {
              throw new Error("must not be called");
            },
          }),
          children: React.createElement(StepEditModal, {
            workflowId: "wf_1",
            step: WEBHOOK_STEP,
            upstreamSteps: [],
            onChange: () => {},
            onClose: () => {},
            readOnly: true,
          }),
        }),
      );
    });
    await flush();
    const roUrlInput = container.querySelector(
      'input[aria-label="Webhook URL"]',
    ) as HTMLInputElement | null;
    assert.ok(roUrlInput, "an existing URL must still render when readOnly");
    assert.equal(roUrlInput.value, "https://api.example/triggers/webhooks/sub_1");
    await act(async () => {
      root.unmount();
    });
  }
});
