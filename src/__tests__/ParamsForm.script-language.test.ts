// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/ParamsForm.script-language.test.ts  (Node 24)
//
// T1.2.4 — the `@w6w/script` step's `language` param drives `code`'s CodeMirror
// mode + default snippet (D-3). Mirrors `params-form-groups.test.ts`'s JSDOM +
// `react-dom/client` + `act` rig (mounting the real `ParamsForm` with a
// controlled `Harness`, since `ParamsForm` is a controlled component) plus
// `ActionTestForm.overrides.test.ts`'s CodeMirror-driving idiom
// (`EditorView.findFromDOM` + `view.dispatch`) for typing into the `code`
// editor and reading back what the mounted view actually produced.
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
// `WorkflowFlowEditor.test-tab.test.ts:47-58`, reused verbatim by
// `params-form-groups.test.ts`/`ActionTestForm.overrides.test.ts`).
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
const { EditorView } = await import("@codemirror/view");
const { ParamsForm } = await import("../ParamsForm.tsx");
const { internalNodeParams, SCRIPT_APP } = await import("../flow-types.ts");
type ActionParam = import("../types.ts").ActionParam;

const JS_DEFAULT = "// Runs as a function body. Return the step's output.\nreturn input;";
const PYTHON_DEFAULT = "# Runs as a function body. Return the step's output.\nreturn input";

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

// `ParamsForm` is a controlled component (rendered fields derive from `values`,
// not local state) — a stateful wrapper reflects an `onChange` back into the
// next render, exactly as a real consumer (`StepBuilderModal`) would, and lets
// a `language` switch happen on the SAME mounted tree (no remount).
function Harness({
  params,
  initialValues,
}: {
  params: ActionParam[];
  initialValues: Record<string, unknown>;
}) {
  const [values, setValues] = React.useState(initialValues);
  return React.createElement(ParamsForm, { params, values, onChange: setValues });
}

async function render(params: ActionParam[], values: Record<string, unknown> = {}) {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(Harness, { params, initialValues: values }));
  });
  await settle();
  return { container, root };
}

/** The mounted CodeMirror view behind an element identified by its `aria-label`. */
function viewFor(container: Element, ariaLabel: string) {
  const content = container.querySelector(`[aria-label="${ariaLabel}"] .cm-content`);
  assert.ok(content, `CodeMirror content for aria-label="${ariaLabel}" must have mounted`);
  const view = EditorView.findFromDOM(content as HTMLElement);
  assert.ok(view, `EditorView.findFromDOM must find the mounted view for "${ariaLabel}"`);
  return view;
}

// `@uiw/react-codemirror`'s controlled-`value` sync defers an external
// overwrite while its own 200ms "isTyping" latch is live (so a controlled
// re-render mid-keystroke doesn't fight the user) — matched here so a
// subsequent action (e.g. a language switch) exercises the real steady-state
// sync path rather than racing that debounce window.
const CODEMIRROR_TYPING_LATCH_MS = 200;

/** Replace the `code` editor's whole document — the real `onChange` wiring fires from this. */
async function setCode(container: Element, text: string) {
  const view = viewFor(container, "code code");
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    await new Promise((r) => setTimeout(r, CODEMIRROR_TYPING_LATCH_MS + 50));
  });
}

async function setLanguage(container: Element, value: string) {
  const select = container.querySelector('select[aria-label="Language"]') as HTMLSelectElement;
  assert.ok(select, "the Language select must render");
  const descriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLSelectElement.prototype,
    "value",
  );
  await act(async () => {
    descriptor?.set?.call(select, value);
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    // Flush CodeMirror's own post-reconfigure tick (the `code` editor remounts
    // its extensions on this same render pass) inside this `act` boundary.
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * What the mounted CodeMirror view's OWN language extension produced — its
 * registered line-comment token (`//` for JS, `#` for Python, none for plain
 * text). This is state the extension itself derives (`EditorState.languageDataAt`,
 * a core `@codemirror/state` API, not `@codemirror/language`), not the prop the
 * test passed in.
 */
function lineCommentToken(view: InstanceType<typeof EditorView>): string | undefined {
  const data = view.state.languageDataAt<{ line?: string }>("commentTokens", 0);
  return data[0]?.line;
}

const SCRIPT_PARAMS = internalNodeParams(SCRIPT_APP, "run");

test("a — fresh mount, language unset (resolves to its declared 'javascript' default): JS default shown, JS mode, no Python mode", async () => {
  const { container, root } = await render(SCRIPT_PARAMS, {});
  const view = viewFor(container, "code code");
  assert.equal(view.state.doc.toString(), JS_DEFAULT);
  // `effective("language")` resolves the unset value through the param's own
  // declared default ("javascript") — so JS mode, not "no mode", is what a
  // fresh mount actually produces here.
  assert.equal(lineCommentToken(view), "//", "language resolves through its declared default");

  await act(async () => {
    root.unmount();
  });
});

test("b — stays-mounted transition: switching language flips the editor's default AND its mode, on the same tree", async () => {
  const { container, root } = await render(SCRIPT_PARAMS, {});
  const before = viewFor(container, "code code");
  assert.equal(before.state.doc.toString(), JS_DEFAULT);
  assert.equal(lineCommentToken(before), "//");

  await setLanguage(container, "python");

  // Same mounted container — re-query the (possibly reconfigured, but not
  // remounted) view to prove the transition happened live.
  const after = viewFor(container, "code code");
  assert.equal(after.state.doc.toString(), PYTHON_DEFAULT, "default snippet flips to Python");
  assert.equal(lineCommentToken(after), "#", "CodeMirror's own language data now reads Python");

  await act(async () => {
    root.unmount();
  });
});

test("c — user code survives a language switch", async () => {
  const { container, root } = await render(SCRIPT_PARAMS, {});
  await setCode(container, "// my own code\nreturn 42;");

  await setLanguage(container, "python");

  const view = viewFor(container, "code code");
  assert.equal(
    view.state.doc.toString(),
    "// my own code\nreturn 42;",
    "an entered value is never clobbered by the language-conditional default",
  );

  await act(async () => {
    root.unmount();
  });
});

test("d — a `code` param with no `language` sibling renders exactly as today", async () => {
  const soloCode: ActionParam = {
    key: "code",
    type: "code",
    label: "Script",
    required: true,
    default: "return 1;",
  };
  const { container, root } = await render([soloCode], {});
  const view = viewFor(container, "code code");
  assert.equal(view.state.doc.toString(), "return 1;");
  assert.equal(lineCommentToken(view), undefined, "no language extension without a sibling");
  assert.equal(
    container.querySelector('select[aria-label="Language"]'),
    null,
    "no Language select is synthesized",
  );

  await act(async () => {
    root.unmount();
  });
});
