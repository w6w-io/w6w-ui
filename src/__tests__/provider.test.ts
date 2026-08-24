// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/provider.test.ts  (Node 24)
//
// Covers `<W6WUIProvider theme>`'s DOM wrapper (provider.tsx) — the CSS half
// of the theming fix (theme.test.ts covers the JS/context half). Mirrors
// DeleteButton.test.ts:1-46's JSDOM/`act` setup.
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
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { W6WUIProvider } = await import("../provider.tsx");

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

// Minimal stand-in — nothing under test calls it.
const fakeApi = {} as Parameters<typeof W6WUIProvider>[0]["api"];

test("W6WUIProvider — theme omitted: no extra DOM wrapper (unchanged from before this fix)", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi,
        children: React.createElement("span", { "data-testid": "child" }, "hi"),
      }),
    );
  });
  // No [data-theme] anywhere, and the child is a direct child of #root — no
  // wrapper div was introduced.
  assert.equal(container?.querySelector("[data-theme]"), null);
  assert.equal(container?.firstElementChild?.getAttribute("data-testid"), "child");
  await act(async () => {
    root.unmount();
  });
});

test("W6WUIProvider — theme='light' wraps children in a data-theme anchor, invisible to layout", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(W6WUIProvider, {
        api: fakeApi,
        theme: "light",
        children: React.createElement("span", { "data-testid": "child" }, "hi"),
      }),
    );
  });
  const wrapper = container?.querySelector("[data-theme]");
  assert.ok(wrapper);
  assert.equal(wrapper.getAttribute("data-theme"), "light");
  assert.equal((wrapper as HTMLElement).style.display, "contents");
  assert.ok(wrapper.querySelector('[data-testid="child"]'));
  await act(async () => {
    root.unmount();
  });
});
