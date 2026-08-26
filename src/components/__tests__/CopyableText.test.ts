// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/components/__tests__/CopyableText.test.ts  (Node 24)
//
// Mirrors ./Copyable.test.ts's JSDOM + react-dom rig, including its stub
// `navigator.clipboard`.
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
const { CopyableText, cropText } = await import("../CopyableText.tsx");

function stubClipboard() {
  const calls: string[] = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: {
      writeText: async (text: string) => {
        calls.push(text);
      },
    },
    configurable: true,
  });
  return calls;
}

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

// A-3's fixture table, verbatim — the acceptance, not an illustration.
const FIXTURES: Array<{
  value: string;
  chars?: number;
  crop: "start" | "end" | "middle";
  result: string;
}> = [
  { value: "123456789", chars: 6, crop: "start", result: "…456789" },
  { value: "123456789", chars: 6, crop: "end", result: "123456…" },
  { value: "123456789", chars: 6, crop: "middle", result: "123…789" },
  { value: "123456789", chars: 9, crop: "middle", result: "123456789" },
  { value: "123456789", chars: 20, crop: "end", result: "123456789" },
  { value: "123456789", crop: "end", result: "123456789" },
  { value: "123456789", chars: 0, crop: "end", result: "123456789" },
  { value: "1234567", chars: 4, crop: "middle", result: "12…67" },
];

for (const [i, f] of FIXTURES.entries()) {
  test(`cropText row ${i + 1} — value=${f.value} chars=${f.chars} crop=${f.crop}`, () => {
    assert.equal(cropText(f.value, f.chars, f.crop), f.result);
  });
}

// Supplementary — NOT one of A-3's pinned 8 rows. `head = Math.floor(chars/2)`
// (mutation M1) is mathematically INDISTINGUISHABLE from `Math.ceil` on every
// pinned row: rows 3 and 8 are the table's only `middle` cases with `chars`
// small enough to reach the split arithmetic, and both pass an EVEN `chars`
// (6, 4) — floor and ceil of an even number are identical, so M1 does not
// redden against the pinned table alone (measured; see this task's result.md
// for the mutation-battery finding, `[case: contract-self-contradiction]`).
// An ODD `chars` is what actually discriminates head-rounding — this row
// pins that the implementation is `ceil`, not `floor`.
test("cropText (supplementary, odd chars) — middle splits head = ceil(chars/2), not floor", () => {
  assert.equal(cropText("123456789", 5, "middle"), "123…89");
});

test("CopyableText renders the CROPPED text in the span but hands the FULL value to Copyable", async () => {
  const calls = stubClipboard();
  const { container, root } = mountRoot();
  const value = "123456789";

  await act(async () => {
    root.render(React.createElement(CopyableText, { value, chars: 6, crop: "end" }));
  });

  const span = container.querySelector("span:not(.w6w-copyable-status)");
  assert.ok(span, "the cropped text must render in a <span>");
  assert.equal(span.textContent, "123456…", "the SPAN shows the cropped text");

  const button = container.querySelector("button");
  assert.ok(button);
  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(calls, [value], "the clipboard must receive the FULL, uncropped value");

  await act(async () => {
    root.unmount();
  });
});

test("CopyableText renders the .w6w-copyable--bare modifier class", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(CopyableText, { value: "hello" }));
  });
  const wrap = container.querySelector(".w6w-copyable");
  assert.ok(wrap);
  assert.ok(wrap.classList.contains("w6w-copyable--bare"));
  await act(async () => {
    root.unmount();
  });
});
