// Run: node --import ./src/test-jsx-loader.mjs --test src/components/__tests__/ExecutionLogPanel.test.ts  (Node 24)
//
// Mirrors `Copyable.test.ts`'s header (JSDOM + navigator + matchMedia +
// MutationObserver + IS_REACT_ACT_ENVIRONMENT) — the CodeMirror-specific
// Window/requestAnimationFrame trio `JsonEditor.copy.test.ts` needs is not
// required here: `CodeBlock` (used for input/output — see A3 in the
// component's own doc comment) mounts no CodeMirror, only `<pre><code>` plus
// `Copyable`'s plain DOM listeners.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import type { ExecutionLogPanelProps, ExecutionLogStep } from "../ExecutionLogPanel.tsx";
import type { StepStatus, StepStatusPillProps } from "../StepStatusPill.tsx";

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
const { ExecutionLogPanel } = await import("../ExecutionLogPanel.tsx");
const { StepStatusPill } = await import("../StepStatusPill.tsx");

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

async function renderPill(props: StepStatusPillProps) {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(StepStatusPill, props));
  });
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });
  return html;
}

async function renderPanel(props: ExecutionLogPanelProps) {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(ExecutionLogPanel, props));
  });
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });
  return html;
}

/** Like `renderPanel`, but keeps the root mounted so a test can interact
 *  with the live DOM (e.g. open a row's `<details>`) before reading html. */
async function mountPanel(props: ExecutionLogPanelProps) {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(ExecutionLogPanel, props));
  });
  return { container, root };
}

/** Clicks the Nth row's `<summary>` — the real user gesture that opens a
 *  `.w6w-section` disclosure — and waits out the native `toggle` event,
 *  which jsdom (like real browsers) dispatches asynchronously rather than
 *  synchronously with the click. */
async function openDetailsAt(container: HTMLElement, index: number) {
  const details = container.querySelectorAll("details")[index];
  assert.ok(details, `expected a <details> element at index ${index}`);
  const summary = details.querySelector("summary");
  assert.ok(summary, "expected a <summary> inside the details element");
  await act(async () => {
    summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ALL_STATES: StepStatus[] = ["pending", "running", "succeeded", "failed", "skipped"];
const DEFAULT_LABELS: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
};

// ─── StepStatusPill ─────────────────────────────────────────────────────────

test("A1/M1 — every StepStatus renders its own visible text label, not colour alone", async () => {
  for (const state of ALL_STATES) {
    const html = await renderPill({ state });
    assert.match(
      html,
      new RegExp(`class="w6w-step-pill-label">${DEFAULT_LABELS[state]}<`),
      `expected the ${state} pill's own text label in: ${html}`,
    );
  }
});

test("M2 — the five StepStatus values render five distinct pill classNames", async () => {
  const classNames: string[] = [];
  for (const state of ALL_STATES) {
    const html = await renderPill({ state });
    const m = html.match(/^<span class="(w6w-step-pill w6w-step-pill-[^"]+)"/);
    assert.ok(m, `expected a w6w-step-pill className in: ${html}`);
    classNames.push(m[1]);
  }
  const distinct = new Set(classNames);
  assert.equal(
    distinct.size,
    ALL_STATES.length,
    `expected ${ALL_STATES.length} distinct classNames, got: ${classNames.join(", ")}`,
  );
});

test("A1 — ariaLabel overrides the pill's accessible label; label overrides the visible text", async () => {
  const html = await renderPill({ state: "failed", ariaLabel: "Step failed", label: "Oops" });
  assert.match(html, /aria-label="Step failed"/);
  assert.match(html, /class="w6w-step-pill-label">Oops</);
});

// ─── ExecutionLogPanel ──────────────────────────────────────────────────────

const RUN_LONGER: ExecutionLogStep = {
  id: "z-step",
  label: "Z step",
  status: "succeeded",
  startedAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:00:01.200Z",
  input: { to: "a@example.com" },
  output: { messageId: "abc123" },
};
const RUN_SHORTER: ExecutionLogStep = { id: "a-step", label: "A step", status: "failed" };

test("A2 — empty list renders without throwing, and shows an empty state, not a broken frame", async () => {
  const html = await renderPanel({ steps: [] });
  assert.match(html, /No steps have run yet\./);
  assert.doesNotMatch(html, /w6w-execution-log-row/);
});

test("A2/A3 — a run with zero finished steps (pending, no timing/input/output) renders without throwing, and neither row gets an expand affordance", async () => {
  const steps: ExecutionLogStep[] = [
    { id: "s1", status: "pending" },
    { id: "s2", status: "pending" },
  ];
  const html = await renderPanel({ steps });
  assert.equal(html.split('w6w-execution-log-row"').length - 1, 2, "expected two step rows");
  assert.equal(
    html.split("w6w-step-pill-pending").length - 1,
    2,
    "both rows must show the pending pill",
  );
  assert.doesNotMatch(
    html,
    /<details/,
    "neither row has input or output — no <details> disclosure to render at all",
  );
  assert.doesNotMatch(
    html,
    /Not available\./,
    "no empty disclosure body should render 'Not available.' — the row itself renders nothing to disclose",
  );
});

test("A3/M4 — a step with neither input nor output has no expand affordance at all", async () => {
  const html = await renderPanel({ steps: [{ id: "s", status: "succeeded" }] });
  assert.doesNotMatch(
    html,
    /<details/,
    "expected no <details> element for a step with no input/output",
  );
  assert.doesNotMatch(
    html,
    /<summary/,
    "expected no summary/toggle for a step with no input/output",
  );
});

test("A2/M5 — steps render in the GIVEN order, not sorted by id", async () => {
  const html = await renderPanel({ steps: [RUN_LONGER, RUN_SHORTER] });
  const zIndex = html.indexOf("Z step");
  const aIndex = html.indexOf("A step");
  assert.ok(zIndex !== -1 && aIndex !== -1, "both step labels must render");
  assert.ok(
    zIndex < aIndex,
    "expected the GIVEN order (Z step before A step) — id-sorted would put A step first",
  );
});

test("A2 — timing: both timestamps + elapsed when known, 'Started …' with only startedAt, a dash otherwise", async () => {
  const htmlBoth = await renderPanel({ steps: [RUN_LONGER] });
  assert.match(htmlBoth, /2026-09-01T00:00:00\.000Z/);
  assert.match(htmlBoth, /2026-09-01T00:00:01\.200Z/);
  assert.match(htmlBoth, /1\.2s/);

  const htmlStartedOnly = await renderPanel({
    steps: [{ id: "s", status: "running", startedAt: "2026-09-01T00:00:00.000Z" }],
  });
  assert.match(htmlStartedOnly, /Started 2026-09-01T00:00:00\.000Z/);

  const htmlNeither = await renderPanel({ steps: [{ id: "s", status: "pending" }] });
  assert.match(htmlNeither, /class="w6w-execution-log-timing">—</);
});

test("A2/M3 — the closed row's always-visible summary shows the label AND the timing, not either dropped", async () => {
  const html = await renderPanel({ steps: [RUN_LONGER] });
  assert.match(html, /Z step/, "expected the step label to be visible while collapsed");
  assert.match(html, /1\.2s/, "expected the elapsed timing to be visible while collapsed");
  assert.doesNotMatch(
    html,
    /class="w6w-execution-log-timing">—</,
    "must not fall back to the dash timing when timing is actually known",
  );
});

test("A1/M1 — a step with input/output starts with no `open` attribute on its <details> (collapsed by default)", async () => {
  const html = await renderPanel({ steps: [RUN_LONGER] });
  const detailsTag = html.match(/<details[^>]*>/);
  assert.ok(detailsTag, "expected a <details> element for a step with input/output");
  assert.doesNotMatch(
    detailsTag[0],
    /\bopen\b/,
    `expected no "open" attribute on a freshly rendered row, got: ${detailsTag[0]}`,
  );
});

test("A3 — input/output render through CodeBlock's structured idiom once opened, never a bare w6w-result <pre> dump", async () => {
  const { container, root } = await mountPanel({ steps: [RUN_LONGER] });
  await openDetailsAt(container, 0);
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });
  assert.match(html, /w6w-code-block/, "expected CodeBlock's own className to appear");
  assert.doesNotMatch(
    html,
    /class="w6w-result"/,
    'must not fall back to ActionTestForm\'s ad-hoc <pre class="w6w-result"> idiom',
  );
  assert.match(html, /a@example\.com/, "the input value must actually be rendered");
  assert.match(html, /abc123/, "the output value must actually be rendered");
});

test("A5/M2 — a collapsed row renders no CodeBlock/JSON content in the DOM at all until opened", async () => {
  const { container, root } = await mountPanel({ steps: [RUN_LONGER] });

  const closedHtml = container.innerHTML;
  assert.doesNotMatch(closedHtml, /w6w-code-block/, "no CodeBlock should mount while collapsed");
  assert.doesNotMatch(
    closedHtml,
    /a@example\.com/,
    "the input value must not be present in the DOM while collapsed",
  );
  assert.doesNotMatch(
    closedHtml,
    /abc123/,
    "the output value must not be present in the DOM while collapsed",
  );

  await openDetailsAt(container, 0);
  const openHtml = container.innerHTML;
  await act(async () => {
    root.unmount();
  });

  assert.match(openHtml, /w6w-code-block/, "CodeBlock must mount once the row is opened");
  assert.match(openHtml, /a@example\.com/, "the input value must appear once opened");
  assert.match(openHtml, /abc123/, "the output value must appear once opened");
});

test("A4 — no inline colour/position:fixed literal reaches the markup", async () => {
  const html = await renderPanel({ steps: [RUN_LONGER] });
  assert.doesNotMatch(html, /position:\s*fixed/);
});

test("A4/M5 — _execution-log.scss does not redefine .w6w-section's border/background/border-radius/padding on the row selector", async () => {
  const scssUrl = new URL("../../styles/_execution-log.scss", import.meta.url);
  const scss = await readFile(scssUrl, "utf8");
  const rowRule = scss.match(/\.w6w-execution-log-row\s*\{([^}]*)\}/);
  assert.ok(rowRule, "expected a `.w6w-execution-log-row { ... }` rule in _execution-log.scss");
  const body = rowRule[1];
  assert.doesNotMatch(
    body,
    /\bborder\s*:/,
    "border must come from .w6w-section, not be redefined here",
  );
  assert.doesNotMatch(
    body,
    /\bbackground\s*:/,
    "background must come from .w6w-section, not be redefined here",
  );
  assert.doesNotMatch(
    body,
    /\bborder-radius\s*:/,
    "border-radius must come from .w6w-section, not be redefined here",
  );
  assert.doesNotMatch(
    body,
    /\bpadding\s*:/,
    "padding must come from .w6w-section, not be redefined here",
  );
});

// ─── A4 (T1.1.1): the optional dismiss control ──────────────────────────────
// `onDismiss` is supplied ⇒ a header row carrying an `IconButton` whose click
// calls it and nothing else. Omitted ⇒ no header row at all. Asserted in BOTH
// render branches: the reported repro (M1) is a run with no steps yet, i.e. the
// `w6w-execution-log-empty` branch, which a head mounted only above the `<ol>`
// would never reach.

/** The index of the first occurrence of `needle`, or -1. */
function at(html: string, needle: string) {
  return html.indexOf(needle);
}

test("A4/M1 — with onDismiss supplied, the EMPTY branch renders the dismiss control above the empty state, and clicking it calls onDismiss exactly once", async () => {
  let calls = 0;
  const { container, root } = await mountPanel({
    steps: [],
    onDismiss: () => {
      calls += 1;
    },
  });

  const dismiss = container.querySelector('[data-testid="execution-log-dismiss"]');
  assert.ok(dismiss, "the empty branch must render the dismiss control");
  assert.equal(
    dismiss.getAttribute("aria-label"),
    "Dismiss run log",
    "the control carries its own accessible name",
  );
  const html = container.innerHTML;
  assert.ok(
    at(html, "w6w-execution-log-head") < at(html, "w6w-execution-log-empty"),
    `the head must render above the body, got: ${html}`,
  );
  assert.match(html, /No steps have run yet\./, "the empty state itself is untouched");

  await act(async () => {
    dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const afterClick = calls;

  await act(async () => {
    root.unmount();
  });
  assert.equal(afterClick, 1, "one click is exactly one onDismiss call");
});

test("A4 — with onDismiss supplied, the POPULATED branch renders the same dismiss control above the step list", async () => {
  let calls = 0;
  const { container, root } = await mountPanel({
    steps: [RUN_SHORTER],
    onDismiss: () => {
      calls += 1;
    },
  });

  const dismiss = container.querySelector('[data-testid="execution-log-dismiss"]');
  assert.ok(dismiss, "a populated panel must render the dismiss control too");
  const html = container.innerHTML;
  assert.ok(
    at(html, "w6w-execution-log-head") < at(html, "w6w-execution-log-row"),
    `the head must render above the rows, got: ${html}`,
  );
  assert.equal(
    container.querySelectorAll(".w6w-execution-log-row").length,
    1,
    "the step rows are still rendered below the head",
  );

  await act(async () => {
    dismiss.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  const afterClick = calls;

  await act(async () => {
    root.unmount();
  });
  assert.equal(afterClick, 1, "one click is exactly one onDismiss call");
});

test("A4/M2 — with onDismiss omitted, no dismiss control and no header row exist in EITHER branch", async () => {
  const empty = await renderPanel({ steps: [] });
  assert.doesNotMatch(empty, /execution-log-dismiss/, `empty branch grew a control: ${empty}`);
  assert.doesNotMatch(empty, /w6w-execution-log-head/, `empty branch grew the head row: ${empty}`);

  const populated = await renderPanel({ steps: [RUN_LONGER] });
  assert.doesNotMatch(
    populated,
    /execution-log-dismiss/,
    `populated branch grew a control: ${populated}`,
  );
  assert.doesNotMatch(
    populated,
    /w6w-execution-log-head/,
    `populated branch grew the head row: ${populated}`,
  );
  assert.match(populated, /w6w-execution-log-row-header/, "the rows themselves are unchanged");
});
