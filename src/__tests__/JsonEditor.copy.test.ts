// Run: node --import ./src/test-jsx-loader.mjs --test src/__tests__/JsonEditor.copy.test.ts  (Node 24)
//
// Mirrors two existing rigs rather than inventing a third: the recording
// clipboard stub from `src/components/__tests__/Copyable.test.ts:54-60`, and
// the `Window`/`requestAnimationFrame`/`cancelAnimationFrame` trio a
// CodeMirror 6 mount needs, first added at
// `StepEditModal.setup-and-configure.test.ts:8,50-52`.
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

// CodeMirror 6 needs these three (verified necessary + jointly sufficient at
// `WorkflowFlowEditor.test-tab.test.ts:47-58`).
g.Window = dom.window.Window;
const raf = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
g.requestAnimationFrame = raf;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
(dom.window as unknown as Record<string, unknown>).requestAnimationFrame = raf;
(dom.window as unknown as Record<string, unknown>).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as NodeJS.Timeout);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { JsonEditor } = await import("../JsonEditor.tsx");

/** Installs a stub clipboard `writeText`, recording every call. Mirrors
 *  `Copyable.test.ts:54-60`. */
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

/** Flush the async tick CodeMirror's view creation needs (shimmed RAF above). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

test("J1 — copyable renders exactly one button, no .w6w-copyable wrapper, and copies the value exactly once", async () => {
  const calls = stubClipboard();
  const { container, root } = mountRoot();

  await act(async () => {
    root.render(
      React.createElement(JsonEditor, {
        value: '{"a":1}',
        onChange: () => {},
        copyable: true,
      }),
    );
  });
  await settle();

  // Checked BEFORE the button count, on purpose: this is the assertion a
  // shape-(a) regression (wrapping <JsonEditor> in <Copyable> instead of an
  // internal button) fails, and it must be the one that actually runs red —
  // not shadowed by the button-count assertion below, which a shape-(a) tree
  // would also fail (its button lands outside `.w6w-json-editor` entirely),
  // but for the wrong reason.
  assert.equal(
    container.querySelector(".w6w-copyable"),
    null,
    "no .w6w-copyable element anywhere — this is shape (b), not shape (a)",
  );
  const editor = container.querySelector(".w6w-json-editor");
  assert.ok(editor, "the editor wrapper must render");
  const buttons = editor.querySelectorAll("button");
  assert.equal(buttons.length, 1, "exactly one button inside .w6w-json-editor");

  await act(async () => {
    buttons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(calls, ['{"a":1}'], "writeText must receive the value exactly, once");

  await act(async () => {
    root.unmount();
  });
});

test("J2 — without `copyable`, zero buttons render inside .w6w-json-editor", async () => {
  const { container, root } = mountRoot();

  await act(async () => {
    root.render(
      React.createElement(JsonEditor, {
        value: '{"a":1}',
        onChange: () => {},
      }),
    );
  });
  await settle();

  const editor = container.querySelector(".w6w-json-editor");
  assert.ok(editor);
  assert.equal(
    editor.querySelectorAll("button").length,
    0,
    "the other five mounts must render byte-identically to today's DOM",
  );

  await act(async () => {
    root.unmount();
  });
});

test("J3 — readOnly is irrelevant: a click on the editor's own content does not copy, only the button does", async () => {
  const calls = stubClipboard();
  const { container, root } = mountRoot();

  await act(async () => {
    root.render(
      React.createElement(JsonEditor, {
        value: '{"a":1}',
        onChange: () => {},
        copyable: true,
        readOnly: true,
      }),
    );
  });
  await settle();

  const content = container.querySelector(".cm-content");
  assert.ok(content, "CodeMirror's own content area must have mounted");
  await act(async () => {
    content.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(
    calls,
    [],
    "a click on the editor's own content area must not copy — never Copyable's readOnly box-click mode",
  );

  const button = container.querySelector(".w6w-json-editor button");
  assert.ok(button, "the copy button must be present");
  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.deepEqual(calls, ['{"a":1}'], "a click on the button itself copies the value");

  await act(async () => {
    root.unmount();
  });
});

test('J4 — a11y: the button\'s accessible name is constant across states, and an aria-live="polite" region is present', async () => {
  stubClipboard();
  const { container, root } = mountRoot();

  await act(async () => {
    root.render(
      React.createElement(JsonEditor, {
        value: '{"a":1}',
        onChange: () => {},
        copyable: true,
      }),
    );
  });
  await settle();

  const button = container.querySelector(".w6w-json-editor button");
  assert.ok(button, "the copy button must be present");
  const labelBefore = button.getAttribute("aria-label");
  assert.ok(labelBefore, "the button must have an accessible name");

  const status = container.querySelector('[aria-live="polite"]');
  assert.ok(status, 'an aria-live="polite" status element must be present');

  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });

  assert.equal(
    button.getAttribute("aria-label"),
    labelBefore,
    "the button's accessible name must stay constant across states — a glyph swap carries no accessible signal",
  );

  await act(async () => {
    root.unmount();
  });
});
