// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/theme.test.ts  (Node 24)
//
// Covers the new `provided` precedence step `detectTheme`/`useEffectiveTheme`
// gained for `<W6WUIProvider theme>` (provider.tsx) — sits between the
// explicit per-component prop and the pre-existing `data-theme`-on-`<html>`/
// OS-preference fallback. Mirrors DeleteButton.test.ts:1-46's JSDOM/`act` setup.
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

let prefersDark = false;
function makeMatchMedia() {
  return (query: string) => ({
    matches: query.includes("dark") && prefersDark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
g.matchMedia = makeMatchMedia();
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
const { detectTheme, useEffectiveTheme, ProvidedThemeCtx } = await import("../theme.ts");

test("detectTheme — explicit prop wins over everything, including a provider value", () => {
  assert.equal(detectTheme("dark", "light"), "dark");
});

test("detectTheme — provider `theme` wins over data-theme on <html> and OS preference", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  prefersDark = true;
  assert.equal(detectTheme(undefined, "light"), "light");
  document.documentElement.removeAttribute("data-theme");
  prefersDark = false;
});

test("detectTheme — falls through to data-theme on <html> when no explicit/provided value", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  assert.equal(detectTheme(undefined, undefined), "dark");
  document.documentElement.removeAttribute("data-theme");
});

test("detectTheme — falls through to OS prefers-color-scheme as the last resort", () => {
  prefersDark = true;
  assert.equal(detectTheme(undefined, undefined), "dark");
  prefersDark = false;
  assert.equal(detectTheme(undefined, undefined), "light");
});

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

test("useEffectiveTheme — reads ProvidedThemeCtx (what <W6WUIProvider theme> sets) over an OS dark preference", async () => {
  prefersDark = true;
  document.documentElement.removeAttribute("data-theme");
  const { root } = mountRoot();
  const seen: string[] = [];
  function Probe() {
    seen.push(useEffectiveTheme());
    return null;
  }
  await act(async () => {
    root.render(
      React.createElement(
        ProvidedThemeCtx.Provider,
        { value: "light" },
        React.createElement(Probe),
      ),
    );
  });
  assert.equal(seen.at(-1), "light");
  await act(async () => {
    root.unmount();
  });
  prefersDark = false;
});

test("useEffectiveTheme — with no provider in the tree, still resolves OS preference as before (backward compatible)", async () => {
  prefersDark = true;
  document.documentElement.removeAttribute("data-theme");
  const { root } = mountRoot();
  const seen: string[] = [];
  function Probe() {
    seen.push(useEffectiveTheme());
    return null;
  }
  await act(async () => {
    root.render(React.createElement(Probe));
  });
  assert.equal(seen.at(-1), "dark");
  await act(async () => {
    root.unmount();
  });
  prefersDark = false;
});
