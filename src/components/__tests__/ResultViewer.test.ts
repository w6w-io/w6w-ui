// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/components/__tests__/ResultViewer.test.ts  (Node 24)
//
// Rig = Copyable.test.ts's header, including its `Object.defineProperty(globalThis, "navigator", …)`
// block and `stubClipboard` — jsdom implements no Clipboard API at all, so R7 proves
// the STATE MACHINE (the exact bytes handed to `writeText`), never that bytes
// reached a system clipboard. jsdom also executes no iframe, so R3 proves only
// that the payload's markup is not in THIS document — the real-Chromium claim
// (no script runs, no request leaves) is `test/html-preview/html-preview-xss.test.ts`.
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
const { ResultViewer } = await import("../ResultViewer.tsx");
const { HTML_PREVIEW_CSP } = await import("../HtmlPreview.tsx");
const { RESULT_RENDER_MAX_CHARS } = await import("../result-format.ts");

/** Installs a stub clipboard `writeText`, recording every call. */
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

async function mount(value: unknown, format?: "auto" | "json") {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(ResultViewer, { value, format }));
  });
  return { container, root };
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function byText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  assert.ok(found, `no button labelled ${text}`);
  return found as HTMLButtonElement;
}

function openStates(container: HTMLElement): boolean[] {
  return Array.from(container.querySelectorAll("details.w6w-json-node")).map(
    (d) => (d as HTMLDetailsElement).open,
  );
}

const HTML_PAYLOAD =
  "<!doctype html><html><body><h1>vendor page</h1><script>window.__pwned=1</script></body></html>";

test("explicit JSON format preserves root strings and copies the exact JSON value", async () => {
  for (const value of [HTML_PAYLOAD, '{"value":123}', "# Heading", "", null, false, 0]) {
    const calls = stubClipboard();
    const { container, root } = await mount(value, "json");
    assert.ok(container.querySelector('[data-format="json"]'));
    assert.equal(container.querySelector("iframe"), null);
    assert.equal(container.querySelector(".w6w-json-leaf")?.textContent, JSON.stringify(value));
    await click(container.querySelector('[aria-label="Copy result"]') as Element);
    assert.deepEqual(calls, [JSON.stringify(value)]);
    await act(async () => root.unmount());
  }
});

test("R1 — json: 3 nodes, depth-2 open, collapsed text still in the DOM", async () => {
  const { container, root } = await mount({ a: { b: { c: "deep-leaf" } }, n: 1 });

  assert.ok(container.querySelector('[data-format="json"]'), "root must announce data-format=json");
  assert.equal(container.querySelectorAll("details.w6w-json-node").length, 3);
  assert.deepEqual(openStates(container), [true, true, false]);
  assert.ok(
    (container.textContent ?? "").includes("deep-leaf"),
    "collapsed text must stay in the DOM",
  );
  assert.equal(container.querySelectorAll(".w6w-result").length, 0, "never class .w6w-result");

  await act(async () => {
    root.unmount();
  });
});

test("R2 — Expand all opens every node; Collapse all leaves only the root open", async () => {
  const { container, root } = await mount({ a: { b: { c: "deep-leaf" } }, n: 1 });

  await click(byText(container, "Expand all"));
  assert.deepEqual(openStates(container), [true, true, true]);

  await click(byText(container, "Collapse all"));
  assert.deepEqual(openStates(container), [true, false, false]);

  await act(async () => {
    root.unmount();
  });
});

test("R3 — html renders only inside the sandboxed iframe; Source is inert source", async () => {
  const { container, root } = await mount(HTML_PAYLOAD);

  assert.equal(container.querySelectorAll("iframe.w6w-html-preview").length, 1);
  const iframe = container.querySelector("iframe.w6w-html-preview");
  assert.ok(iframe);
  assert.equal(iframe.getAttribute("sandbox"), "");
  // The payload is a srcdoc string, never this document's markup.
  assert.equal(container.querySelector(".w6w-result-viewer script, .w6w-result-viewer h1"), null);
  assert.equal(container.querySelectorAll(".w6w-result").length, 0, "never class .w6w-result");

  // Clicked by its DOM hook, not by its label: a mutant that drops `data-mode`
  // must die here, and `aria-pressed` is the toggle's only announced state.
  const source = container.querySelector('[data-mode="source"]');
  assert.ok(source, "the toggle must carry data-mode");
  const rendered = container.querySelector('[data-mode="rendered"]');
  assert.ok(rendered);
  assert.equal(rendered.getAttribute("aria-pressed"), "true", "rendered is the default");
  assert.equal(source.getAttribute("aria-pressed"), "false");
  await click(source);
  assert.equal(
    (container.querySelector('[data-mode="source"]') as HTMLButtonElement).getAttribute(
      "aria-pressed",
    ),
    "true",
    "Source must announce itself as pressed after the click",
  );
  assert.equal(
    (container.querySelector('[data-mode="rendered"]') as HTMLButtonElement).getAttribute(
      "aria-pressed",
    ),
    "false",
  );
  assert.equal(container.querySelectorAll("iframe.w6w-html-preview").length, 0);
  const block = container.querySelector(".w6w-code-block");
  assert.ok(block, "source view must be a code block");
  assert.ok((block.textContent ?? "").includes("<h1>"), "source must show the raw markup");
  // The source CodeBlock is NOT copyable: one copy button per viewer, ever.
  assert.equal(
    container.querySelectorAll(".w6w-copyable-btn").length,
    1,
    "exactly one copy button (the viewer's own)",
  );

  await act(async () => {
    root.unmount();
  });
});

test("R4 — markdown renders through Markdown; Source shows the raw text", async () => {
  const { container, root } = await mount("# Title-marker\n\n- a\n- b");

  const h1 = container.querySelector(".w6w-result-viewer h1");
  assert.ok(h1, "rendered markdown must produce a real heading");
  assert.equal((h1.textContent ?? "").trim(), "Title-marker");

  await click(byText(container, "Source"));
  assert.equal(
    container.querySelector(".w6w-result-viewer h1"),
    null,
    "source view renders no heading",
  );
  const block = container.querySelector(".w6w-code-block");
  assert.ok(block);
  assert.ok((block.textContent ?? "").includes("# Title-marker"));

  await act(async () => {
    root.unmount();
  });
});

test("R5 — xml is highlighted source, with no render path and no toggle", async () => {
  const { container, root } = await mount("<a><b>1</b></a>");

  assert.equal(container.querySelector("[data-format]")?.getAttribute("data-format"), "xml");
  assert.ok(container.querySelector(".w6w-code-block"), "xml must be shown as source");
  assert.equal(container.querySelectorAll("iframe").length, 0, "xml is never rendered");
  assert.equal(
    container.querySelectorAll("[data-mode]").length,
    0,
    "xml has no Rendered/Source toggle",
  );
  // The xml source block is `copyable={false}`: the viewer owns the one button.
  assert.equal(
    container.querySelectorAll(".w6w-copyable-btn").length,
    1,
    "exactly one copy button (the viewer's own)",
  );

  await act(async () => {
    root.unmount();
  });
});

test("R6 — an over-limit html string never renders: note + source only", async () => {
  const big = `<!doctype html><html><body>${"x".repeat(RESULT_RENDER_MAX_CHARS)}</body></html>`;
  const { container, root } = await mount(big);

  assert.equal(container.querySelectorAll("iframe").length, 0, "over the cap: never an iframe");
  assert.equal(
    container.querySelectorAll("[data-mode]").length,
    0,
    "over the cap: no toggle offered",
  );
  assert.ok(container.querySelector(".w6w-result-viewer-note"), "the reader must be told why");

  await act(async () => {
    root.unmount();
  });
});

test("R7 — the hover copy button writes the pretty JSON exactly", async () => {
  const calls = stubClipboard();
  const { container, root } = await mount({ n: 1 });

  const wrap = container.querySelector(".w6w-copyable--hover");
  assert.ok(wrap, "the copy affordance must carry the hover modifier");
  const button = wrap.querySelector('button[aria-label="Copy result"]');
  assert.ok(button, "one copy button, at the top-right of the wrapper");
  assert.equal(container.querySelectorAll('button[aria-label="Copy result"]').length, 1);

  await click(button);
  assert.deepEqual(calls, ['{\n  "n": 1\n}']);

  await act(async () => {
    root.unmount();
  });
});

test("R8 — HTML_PREVIEW_CSP is the pinned string, verbatim", async () => {
  assert.equal(
    HTML_PREVIEW_CSP,
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
  );
});

// ── R9 — the highlighting bound (eval B1) ───────────────────────────────────
//
// Prism is the slow part of a big result, and its cost is NOT bounded by
// `RESULT_RENDER_MAX_CHARS`: a 300 KB markdown source or a 4 MB xml body spent
// tens of seconds in it, which made the size guard a pessimisation. Above
// `RESULT_HIGHLIGHT_MAX_CHARS` a source view must therefore be plain text.
// The bound is module-private, so the number is spelled out here — a literal
// 65536, deliberately NOT imported, so this test fails if the module's value
// moves without the behaviour being reconsidered.
const HIGHLIGHT_MAX = 65536;

/** An xml body of exactly `n` characters (starts `<`, ends `>` ⇒ format xml). */
function xmlOf(n: number): string {
  return `<a>${"x".repeat(n - 7)}</a>`;
}

/** An html document of exactly `n` characters. */
function htmlOf(n: number): string {
  const head = "<!doctype html><body>";
  const tail = "</body>";
  return `${head}${"x".repeat(n - head.length - tail.length)}${tail}`;
}

/** A markdown document of exactly `n` characters (a heading ⇒ format markdown). */
function markdownOf(n: number): string {
  const head = "# Title\n";
  return `${head}${"a".repeat(n - head.length)}`;
}

/** A `.w6w-result-viewer-text` `<pre>` whose text is EXACTLY `text`. */
function assertPlainText(container: HTMLElement, text: string, where: string) {
  assert.equal(
    container.querySelectorAll(".w6w-code-block").length,
    0,
    `${where}: over the highlight bound, Prism must not see the value`,
  );
  const pre = container.querySelector(".w6w-result-viewer-text");
  assert.ok(pre, `${where}: the source must still be shown, as plain text`);
  assert.equal(pre.textContent, text, `${where}: the plain-text source must be the input, exactly`);
}

test("R9 — source views over the highlight bound are plain text, not Prism", async () => {
  // The bound itself: exactly 65536 characters is still highlighted, one
  // character more is not. Each case mounts fresh — the mode is per-mount.
  {
    const text = xmlOf(HIGHLIGHT_MAX);
    assert.equal(text.length, HIGHLIGHT_MAX);
    const { container, root } = await mount(text);
    assert.ok(
      container.querySelector(".w6w-code-block"),
      "xml at exactly the bound must still be highlighted",
    );
    await act(async () => {
      root.unmount();
    });
  }
  {
    const text = markdownOf(HIGHLIGHT_MAX);
    assert.equal(text.length, HIGHLIGHT_MAX);
    const { container, root } = await mount(text);
    await click(container.querySelector('[data-mode="source"]') as Element);
    assert.ok(
      container.querySelector(".w6w-code-block"),
      "a markdown source at exactly the bound must still be highlighted",
    );
    await act(async () => {
      root.unmount();
    });
  }

  // One character over the bound: every source path degrades to plain text.
  {
    const text = xmlOf(HIGHLIGHT_MAX + 1);
    const { container, root } = await mount(text);
    assertPlainText(container, text, "xml");
    await act(async () => {
      root.unmount();
    });
  }
  {
    const text = htmlOf(HIGHLIGHT_MAX + 1);
    const { container, root } = await mount(text);
    // Under RESULT_RENDER_MAX_CHARS: the toggle is still offered, so reach the
    // source view the way a reader does.
    await click(container.querySelector('[data-mode="source"]') as Element);
    assertPlainText(container, text, "html source");
    await act(async () => {
      root.unmount();
    });
  }
  {
    const text = markdownOf(HIGHLIGHT_MAX + 1);
    const { container, root } = await mount(text);
    await click(container.querySelector('[data-mode="source"]') as Element);
    assertPlainText(container, text, "markdown source");
    await act(async () => {
      root.unmount();
    });
  }
  {
    // The over-limit fallback is the case that actually hung (eval B1: 300 KB
    // markdown, 24.5 s). It must be plain text, and still carry the note.
    const text = htmlOf(RESULT_RENDER_MAX_CHARS + 1);
    const { container, root } = await mount(text);
    assert.ok(container.querySelector(".w6w-result-viewer-note"), "the note must stay");
    assertPlainText(container, text, "html over-limit");
    await act(async () => {
      root.unmount();
    });
  }
});

// ── R10 — the render cap boundary ───────────────────────────────────────────

test("R10 — at exactly RESULT_RENDER_MAX_CHARS html still renders; +1 does not", async () => {
  {
    const text = htmlOf(RESULT_RENDER_MAX_CHARS);
    assert.equal(text.length, RESULT_RENDER_MAX_CHARS);
    const { container, root } = await mount(text);
    assert.equal(
      container.querySelectorAll("iframe.w6w-html-preview").length,
      1,
      "the cap is inclusive: at exactly the cap the html still renders",
    );
    assert.equal(container.querySelectorAll("[data-mode]").length, 2, "and the toggle is offered");
    assert.equal(container.querySelector(".w6w-result-viewer-note"), null, "no note at the cap");
    await act(async () => {
      root.unmount();
    });
  }
  {
    const { container, root } = await mount(htmlOf(RESULT_RENDER_MAX_CHARS + 1));
    assert.equal(container.querySelectorAll("iframe").length, 0, "one over: never rendered");
    assert.equal(container.querySelectorAll("[data-mode]").length, 0);
    assert.ok(container.querySelector(".w6w-result-viewer-note"));
    await act(async () => {
      root.unmount();
    });
  }
});

// ── R11 — reader-facing details a mutant could silently drop ────────────────

test("R11 — maxHeight reaches the scrolling body, tree leaves quoted, empty containers are leaves", async () => {
  {
    const { container, root } = await mount({ n: 1 });
    const body = container.querySelector(".w6w-result-viewer-body") as HTMLElement;
    assert.ok(body);
    assert.equal(body.style.maxHeight, "320px", "the default cap must reach the body");
    assert.equal(body.style.overflow, "auto", "the body is the element that scrolls");
    await act(async () => {
      root.unmount();
    });
  }
  {
    // A tabular result: string leaves keep their quotes (so a leaf can never be
    // mistaken for structure), numbers and booleans stay bare.
    const { container, root } = await mount({ s: "hi", n: 1, b: true, z: null });
    assert.equal(container.querySelector(".w6w-json-string")?.textContent, '"hi"');
    assert.equal(container.querySelector(".w6w-json-number")?.textContent, "1");
    assert.equal(container.querySelector(".w6w-json-boolean")?.textContent, "true");
    assert.equal(container.querySelector(".w6w-json-null")?.textContent, "null");
    // The summary reads `{…} 4 keys`: a space before the count, and the plural
    // agrees with the number (a bare `{…}4 keys` and "1 keys" both read wrong).
    assert.equal(container.querySelector("summary")?.textContent, "{…} 4 keys");
    await act(async () => {
      root.unmount();
    });
  }
  {
    // …and the singular, plus the array wording.
    const { container, root } = await mount({ one: [] });
    assert.equal(container.querySelector("summary")?.textContent, "{…} 1 key");
    await act(async () => {
      root.unmount();
    });
  }
  {
    const { container, root } = await mount([1, 2]);
    assert.equal(container.querySelector("summary")?.textContent, "[…] 2 items");
    await act(async () => {
      root.unmount();
    });
  }
  {
    // An empty container has nothing to collapse: it must read as a leaf, not
    // as a `<details>` that opens onto nothing.
    const { container, root } = await mount({ e: {}, arr: [] });
    assert.equal(
      container.querySelectorAll("details.w6w-json-node").length,
      1,
      "only the non-empty root is a <details>",
    );
    const text = container.textContent ?? "";
    assert.ok(text.includes("{}"), "an empty object reads {}");
    assert.ok(text.includes("[]"), "an empty array reads []");
    await act(async () => {
      root.unmount();
    });
  }
  {
    // `maxHeight` is a prop, not a constant.
    const container = document.getElementById("root") as HTMLElement;
    container.innerHTML = "";
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(ResultViewer, { value: { n: 1 }, maxHeight: 500 }));
    });
    const body = container.querySelector(".w6w-result-viewer-body") as HTMLElement;
    assert.equal(body.style.maxHeight, "500px");
    await act(async () => {
      root.unmount();
    });
  }
  {
    // The `text` branch is a plain `<pre>` and still never carries `.w6w-result`.
    const { container, root } = await mount("plain sentence");
    assert.equal(container.querySelector("[data-format]")?.getAttribute("data-format"), "text");
    assert.ok(container.querySelector("pre.w6w-result-viewer-text"));
    assert.equal(container.querySelectorAll(".w6w-result").length, 0);
    await act(async () => {
      root.unmount();
    });
  }
});

test("R12 — a hand-collapsed node is re-opened by Expand all (the tree is remounted)", async () => {
  const { container, root } = await mount({ a: { b: { c: "deep-leaf" } }, n: 1 });
  assert.deepEqual(openStates(container), [true, true, false]);

  // The reader closes the root by hand. Nothing about the props changes, so
  // React would not touch that DOM node again — only a remount re-applies
  // `open`, which is what the epoch counter in the `key` is for.
  const first = container.querySelector("details.w6w-json-node") as HTMLDetailsElement;
  first.open = false;
  assert.deepEqual(openStates(container), [false, true, false]);

  await click(byText(container, "Expand all"));
  assert.deepEqual(openStates(container), [true, true, true], "Expand all must win over the DOM");

  await act(async () => {
    root.unmount();
  });

  // …and the other direction: the reader opens the deepest node by hand, then
  // Collapse all must put the tree back to its depth-1 default.
  const second = await mount({ a: { b: { c: "deep-leaf" } }, n: 1 });
  const third = second.container.querySelectorAll("details.w6w-json-node")[2] as HTMLDetailsElement;
  third.open = true;
  assert.deepEqual(openStates(second.container), [true, true, true]);

  await click(byText(second.container, "Collapse all"));
  assert.deepEqual(
    openStates(second.container),
    [true, false, false],
    "Collapse all must win over a hand-opened node",
  );

  await act(async () => {
    second.root.unmount();
  });
});

test("R13 — a value whose copy text throws still renders the pane", async () => {
  // `resultCopyText` runs `JSON.stringify`, which throws on a BigInt. The pane
  // must keep showing the result; only the clipboard payload degrades.
  const calls = stubClipboard();
  const { container, root } = await mount({ n: 1n });

  assert.ok(container.querySelector('[data-format="json"]'), "the viewer must survive the throw");
  assert.ok(container.querySelector("details.w6w-json-node"));

  const button = container.querySelector('button[aria-label="Copy result"]');
  assert.ok(button);
  await click(button);
  assert.deepEqual(calls, ["[object Object]"], "the copy text degrades to a best-effort string");

  await act(async () => {
    root.unmount();
  });
});
