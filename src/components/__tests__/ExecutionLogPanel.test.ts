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

async function openPayload(container: HTMLElement, title: string) {
  const details = Array.from(
    container.querySelectorAll<HTMLDetailsElement>("details.w6w-execution-log-json"),
  ).find((element) => element.querySelector("summary")?.textContent === title);
  assert.ok(details, `expected the ${title} disclosure`);
  await act(async () => {
    details.querySelector("summary")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return details;
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

test("node — each row names its kind and its app · action; a built-in node is named from its own definition", async () => {
  const steps: ExecutionLogStep[] = [
    {
      id: "order_placed_1",
      status: "succeeded",
      node: {
        app: "vip.cohost.w6w",
        action: "order-placed",
        trigger: true,
        appName: "Cohost",
        actionName: "Order Placed",
      },
    },
    { id: "render_body", status: "succeeded", node: { app: "@w6w/template", action: "render" } },
    { id: "manual_trigger_1", status: "skipped", node: { app: "@w6w/trigger", action: "manual" } },
    { id: "mail_send_1", status: "failed", node: { app: "io.w6w.sendgrid", action: "mail-send" } },
    { id: "plain", status: "succeeded" },
  ];
  const { container, root } = await mountPanel({ steps });
  try {
    const rows = [...container.querySelectorAll(".w6w-execution-log-row")];
    const kind = (r: Element) => r.querySelector('[data-testid="execution-log-kind"]')?.textContent;
    const uses = (r: Element) => r.querySelector('[data-testid="execution-log-uses"]')?.textContent;
    assert.deepEqual(rows.map(kind), ["Trigger", "Node", "Trigger", "Node", undefined]);
    assert.deepEqual(rows.map(uses), [
      "Cohost · Order Placed",
      "Template · Render template",
      // A built-in trigger is a trigger even with no `trigger` flag on its `uses`.
      // …and a name its app and action share is said once.
      "Manual trigger",
      // No display names from the host ⇒ the raw ids, never an empty line.
      "io.w6w.sendgrid · mail-send",
      undefined,
    ]);
    assert.ok(rows[0]?.querySelector(".w6w-execution-log-kind-trigger"));
    assert.equal(rows[1]?.querySelector(".w6w-execution-log-kind-trigger"), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test("A2 — empty list renders without throwing, and shows an empty state, not a broken frame", async () => {
  const html = await renderPanel({ steps: [] });
  assert.match(html, /No nodes have run yet\./);
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

test("input and output start collapsed independently and open as foldable JSON", async () => {
  const { container, root } = await mountPanel({ steps: [RUN_LONGER] });
  await openDetailsAt(container, 0);
  const payloads = Array.from(
    container.querySelectorAll<HTMLDetailsElement>("details.w6w-execution-log-json"),
  );
  assert.equal(payloads.length, 2);
  assert.ok(payloads.every((details) => !details.open));
  assert.equal(container.querySelector(".w6w-result-viewer"), null);
  const input = await openPayload(container, "Input");
  assert.ok(input.querySelector(".w6w-json-node"));
  assert.equal(payloads[1].open, false);
  assert.ok(!container.textContent?.includes("abc123"), "Output stays unmounted");
  await openPayload(container, "Output");
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });
  assert.match(html, /w6w-result-viewer/, "expected the shared JSON viewer");
  assert.match(html, /Expand all/);
  assert.match(html, /Collapse all/);
  assert.doesNotMatch(
    html,
    /class="w6w-result"/,
    'must not fall back to ActionTestForm\'s ad-hoc <pre class="w6w-result"> idiom',
  );
  assert.match(html, /a@example\.com/, "the input value must actually be rendered");
  assert.match(html, /abc123/, "the output value must actually be rendered");
});

test("JSON payloads stay unmounted until both their row and payload are expanded", async () => {
  const { container, root } = await mountPanel({ steps: [RUN_LONGER] });

  const closedHtml = container.innerHTML;
  assert.doesNotMatch(
    closedHtml,
    /w6w-result-viewer/,
    "no JSON viewer should mount while collapsed",
  );
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
  assert.equal(container.querySelector(".w6w-result-viewer"), null);
  await openPayload(container, "Input");
  await openPayload(container, "Output");
  const openHtml = container.innerHTML;
  await act(async () => {
    root.unmount();
  });

  assert.match(openHtml, /w6w-result-viewer/, "the JSON viewer mounts when expanded");
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
  assert.match(html, /No nodes have run yet\./, "the empty state itself is untouched");

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

// ─── Errors (26-10-04-01-fixes T1.1.1): step `error`, run `runError`/`stepErrors` ─
// Each error renders in TriggerFillForm's StepError visual (`w6w-result
// w6w-error`, optional `<code>` badge, message). Every fixture uses a distinct
// literal per field, so a dropped field can't hide behind a sibling's text.

/** Occurrences of `needle` in `html`. */
function count(html: string, needle: string) {
  return html.split(needle).length - 1;
}

test("E1 — a failed step with only `error` renders code + message in the error visual, and no <details>", async () => {
  const html = await renderPanel({
    steps: [
      {
        id: "mail_send_1",
        status: "failed",
        error: { code: "execute_error", message: "`toEmail` is required" },
      },
    ],
  });
  assert.match(html, /`toEmail` is required/, `the error message must render: ${html}`);
  assert.match(html, /<code>execute_error<\/code>/, `the code badge must render: ${html}`);
  assert.match(html, /class="w6w-result w6w-error"/, `the TriggerFillForm visual: ${html}`);
  assert.doesNotMatch(html, /<details/, "an error alone is not something to disclose");
});

const FAILED_WITH_INPUT: ExecutionLogStep = {
  id: "s",
  status: "failed",
  input: { to: "" },
  error: { code: "c_one", message: "boom-one" },
};

test("E2 — a failed step with input keeps its <details>, and shows the error while still collapsed", async () => {
  const html = await renderPanel({ steps: [FAILED_WITH_INPUT] });
  assert.match(html, /<details/, "a step with input keeps its disclosure");
  assert.match(html, /boom-one/, `the message must be in the DOM while collapsed: ${html}`);
  assert.match(html, /<code>c_one<\/code>/, `the code must be in the DOM while collapsed: ${html}`);
  assert.doesNotMatch(html, /w6w-code-block/, "Input stays lazy — no CodeBlock while collapsed");
});

test("E3 — opening a failed row's Input does not duplicate the error", async () => {
  const { container, root } = await mountPanel({ steps: [FAILED_WITH_INPUT] });
  await openDetailsAt(container, 0);
  await openPayload(container, "Input");
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });
  assert.match(html, /w6w-result-viewer/, "Input must render once opened");
  assert.equal(count(html, "boom-one"), 1, `the error must appear exactly once: ${html}`);
});

test("E4 — runError renders in the EMPTY branch, alongside the empty state", async () => {
  const html = await renderPanel({
    steps: [],
    runError: { code: "plan_invalid", message: "run-level-msg" },
  });
  assert.match(html, /run-level-msg/, `the run error message must render: ${html}`);
  assert.match(html, /<code>plan_invalid<\/code>/, `the run error code must render: ${html}`);
  assert.match(html, /No nodes have run yet\./, "the empty state itself still renders");
  assert.ok(
    at(html, "run-level-msg") < at(html, "w6w-execution-log-empty"),
    `the run error sits above the empty state: ${html}`,
  );
});

test("E5 — runError and every stepErrors entry render, in order, above the step rows, label falling back to stepId", async () => {
  const { container, root } = await mountPanel({
    steps: [RUN_LONGER],
    runError: { message: "rl-2" },
    stepErrors: [
      { stepId: "a", error: { message: "rec-a" } },
      { stepId: "b", label: "Bee", error: { code: "cb", message: "rec-b" } },
    ],
  });
  const html = container.innerHTML;
  const blocks = [...container.querySelectorAll(".w6w-result.w6w-error")].map((b) => b.innerHTML);
  await act(async () => {
    root.unmount();
  });

  for (const literal of ["rl-2", "rec-a", "rec-b", "Bee", "<code>cb</code>"]) {
    assert.ok(html.includes(literal), `expected ${literal} in: ${html}`);
  }
  assert.equal(blocks.length, 3, `one block per error (run + 2 recorded), got: ${blocks.length}`);
  assert.match(blocks[0], /rl-2/, "the run-level block comes first");
  assert.match(blocks[1], />a</, `the first entry falls back to its stepId label: ${blocks[1]}`);
  assert.match(blocks[1], /rec-a/);
  assert.match(blocks[2], />Bee</, `the second entry uses its label: ${blocks[2]}`);
  assert.doesNotMatch(blocks[2], />b</, "a supplied label replaces the stepId");
  assert.ok(at(html, "rec-a") < at(html, "rec-b"), "stepErrors keep the given order");
  assert.ok(
    at(html, "rl-2") < at(html, "w6w-execution-log-row"),
    `the run-level block sits above the first step row: ${html}`,
  );
});

test("E6 — no error anywhere ⇒ no w6w-error in the markup, in either branch", async () => {
  const populated = await renderPanel({ steps: [RUN_LONGER] });
  assert.doesNotMatch(populated, /w6w-error/, `populated branch grew an error: ${populated}`);
  assert.doesNotMatch(populated, /w6w-execution-log-errors/, "no empty errors wrapper either");

  const empty = await renderPanel({ steps: [], stepErrors: [] });
  assert.doesNotMatch(empty, /w6w-error/, `empty branch grew an error: ${empty}`);
  assert.doesNotMatch(empty, /w6w-execution-log-errors/, "empty stepErrors adds no wrapper node");
});

// ─── R-1 follow-ups (26-10-04-01-fixes T3.1.1): E-1, E-2 ─────────────────────
// Structural pins for two placements the E-tests above only cover by text:
// where a step's error sits relative to its `<details>`, and where the run
// error sits relative to the dismiss head.

test("E7 — a collapsed failed step's error is a direct child of its row, never inside <details>", async () => {
  const { container, root } = await mountPanel({ steps: [FAILED_WITH_INPUT] });
  const details = container.querySelectorAll("details");
  const insideDetails = container.querySelectorAll("details .w6w-error").length;
  const rowChildren = container.querySelectorAll("li.w6w-execution-log-row > .w6w-error");
  const rowChildText = rowChildren[0]?.textContent ?? "";
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });

  assert.equal(details.length, 1, `the step keeps its one <details>: ${html}`);
  assert.equal(details[0].hasAttribute("open"), false, "the row is still collapsed");
  assert.equal(insideDetails, 0, `no error may render inside the <details>: ${html}`);
  assert.equal(rowChildren.length, 1, `exactly one error as the row's own child: ${html}`);
  assert.match(rowChildText, /boom-one/, "that child is the step's own error");
});

test("E8 — with onDismiss and runError, the dismiss control precedes the run error in BOTH branches", async () => {
  const runError = { code: "rc_eight", message: "run-eight-msg" };
  for (const steps of [[], [RUN_SHORTER]] as ExecutionLogStep[][]) {
    const branch = steps.length === 0 ? "empty" : "populated";
    const { container, root } = await mountPanel({ steps, runError, onDismiss: () => {} });
    const dismiss = container.querySelector('[data-testid="execution-log-dismiss"]');
    const errorBlock = [...container.querySelectorAll(".w6w-result.w6w-error")].find((el) =>
      el.textContent?.includes("run-eight-msg"),
    );
    const order = dismiss && errorBlock ? dismiss.compareDocumentPosition(errorBlock) : 0;
    const html = container.innerHTML;
    await act(async () => {
      root.unmount();
    });

    assert.ok(dismiss, `${branch} branch: the dismiss control must render: ${html}`);
    assert.ok(errorBlock, `${branch} branch: the run error must render: ${html}`);
    assert.ok(
      order & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      `${branch} branch: the run error must come AFTER the dismiss control: ${html}`,
    );
    assert.ok(
      at(html, "execution-log-dismiss") < at(html, "run-eight-msg"),
      `${branch} branch: markup order agrees: ${html}`,
    );
  }
});
