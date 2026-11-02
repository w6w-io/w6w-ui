import { type ReactNode, useMemo, useState } from "react";
import { CodeBlock } from "../CodeBlock.tsx";
import { Markdown } from "../Markdown.tsx";
import { Copyable } from "./Copyable.tsx";
import { HtmlPreview } from "./HtmlPreview.tsx";
import { JsonTree } from "./JsonTree.tsx";
import { RESULT_RENDER_MAX_CHARS, detectResultFormat, resultCopyText } from "./result-format.ts";

export interface ResultViewerProps {
  /** The result as the host received it: an already-parsed value, or a raw
   *  response body string. The format is sniffed from this ROOT value only
   *  (`detectResultFormat`); string leaves inside a JSON tree stay text. */
  value: unknown;
  /** Keep an already-parsed payload as JSON, including strings; default sniffs the format. */
  format?: "auto" | "json";
  /** Height cap of the scrolling body, in px. Default 320. */
  maxHeight?: number;
  /** Extra class on the root, for spacing in the consuming pane. */
  className?: string;
}

/** Which of the two views the reader is on. Only ever offered for `html` and
 *  `markdown`, the two formats that have both a rendered and a source form. */
type Mode = "rendered" | "source";

/**
 * Above this many characters a source view is plain wrapped text, not a
 * `CodeBlock`.
 *
 * Highlighting is not free and its cost is not bounded by the render cap: a
 * 4 MB xml body, or a 300 KB markdown source over `RESULT_RENDER_MAX_CHARS`,
 * took tens of seconds inside Prism — far slower than the raw `<pre>` this
 * component replaces, i.e. the size guard made things WORSE (T0.1.1 eval B1).
 * A `<pre>` is instant, and at 64 KB the reader is scrolling anyway, so the
 * colour carries nothing they can use.
 */
const RESULT_HIGHLIGHT_MAX_CHARS = 65536;

/**
 * The source form of `text`: highlighted when it is small enough for the colour
 * to be worth its cost, plain wrapped text when it is not.
 *
 * EVERY source view goes through here — xml, the Rendered/Source toggle and
 * the over-limit fallback — so there is exactly one place that decides when
 * Prism is allowed to see a value.
 */
function renderSource(text: string, language: "markup" | "markdown"): ReactNode {
  if (text.length > RESULT_HIGHLIGHT_MAX_CHARS) {
    return <pre className="w6w-result-viewer-text">{text}</pre>;
  }
  return <CodeBlock code={text} language={language} copyable={false} wrap />;
}

/**
 * Read-only display of one result value, chosen by its format:
 *
 * | format     | body                                                       |
 * | ---------- | ---------------------------------------------------------- |
 * | `json`     | a collapsible `JsonTree`, with Expand all / Collapse all    |
 * | `xml`      | source (`CodeBlock`, `markup`, when small enough)           |
 * | `html`     | `HtmlPreview` — an empty-sandbox iframe — or source         |
 * | `markdown` | `Markdown` — or source                                      |
 * | `text`     | a plain `<pre>`                                             |
 *
 * Read-only means read-only: nothing here takes an `onChange`, and the one
 * interactive affordance besides the collapsers and the Rendered/Source
 * toggle is `Copyable`'s button, overlaying the top-right corner and revealed
 * on hover (`w6w-copyable--hover`).
 *
 * **Vendor HTML never touches this document.** The `html` format renders only
 * through `HtmlPreview` — an `<iframe sandbox="">` whose `srcdoc` opens with a
 * restrictive CSP meta as its first element — so a hostile payload cannot run
 * script and cannot reach this page's origin or its data. Nothing in this
 * component is ever passed to `dangerouslySetInnerHTML`. Accepted residual: a
 * reader's CLICK on a link inside the preview navigates the frame itself (a
 * page load in a sandboxed, scriptless, cookie-less document) — nothing more.
 * Above `RESULT_RENDER_MAX_CHARS` even that path is skipped: an oversized
 * document is shown as source, with a note saying so. Source views are handed
 * to `renderSource`, which drops Prism above `RESULT_HIGHLIGHT_MAX_CHARS`.
 *
 * The copy button always writes `resultCopyText(detected)` — pretty-printed
 * JSON for a tree, the raw string for every other format — so what lands on
 * the clipboard is what the reader means by "the result", not the on-screen
 * rendering. If that computation throws (circular value, `BigInt`), the view
 * still renders and the button writes a best-effort string instead.
 */
export function ResultViewer(props: ResultViewerProps) {
  const { value, format = "auto", maxHeight = 320, className } = props;
  // Sniffed once per value: the format decides both the body and the bar, and
  // re-sniffing on every unrelated re-render would re-parse a big string.
  const d = useMemo(
    () =>
      format === "json" ? { format: "json" as const, data: value } : detectResultFormat(value),
    [value, format],
  );

  const [mode, setMode] = useState<Mode>("rendered");
  // JSON only: the open depth Expand all / Collapse all switch to, plus the
  // counter used as `JsonTree`'s `key` — remounting is what re-applies
  // `open` to `<details>` elements the reader has toggled by hand.
  const [expandDepth, setExpandDepth] = useState(2);
  const [treeEpoch, setTreeEpoch] = useState(0);

  const text = d.format === "json" ? "" : d.text;
  const renderable = d.format === "html" || d.format === "markdown";
  const overLimit = renderable && text.length > RESULT_RENDER_MAX_CHARS;

  // The clipboard payload, computed once: `resultCopyText` runs `JSON.stringify`,
  // which THROWS on a circular value or a `BigInt`, and a throw here would
  // unmount the pane — the reader would lose the result they are looking at.
  // Degrade the copy text instead: a raw string as-is, anything else stringified
  // as best it can be.
  const copyText = useMemo(() => {
    try {
      return resultCopyText(d);
    } catch {
      return typeof value === "string" ? value : String(value);
    }
  }, [d, value]);

  let body: ReactNode;
  if (d.format === "json") {
    body = <JsonTree key={treeEpoch} value={d.data} expandDepth={expandDepth} />;
  } else if (d.format === "xml") {
    // XML is shown as source, never parsed or rendered: it can carry the same
    // hostile constructs as HTML, and there is no sandbox for an SVG/XML tree.
    body = renderSource(d.text, "markup");
  } else if (d.format === "text") {
    body = <pre className="w6w-result-viewer-text">{d.text}</pre>;
  } else {
    const language = d.format === "html" ? "markup" : "markdown";
    if (overLimit) {
      // Too big to render: hand the reader the source rather than a 4 MB
      // iframe/DOM, and say why the Rendered view is not on offer.
      body = (
        <>
          <div className="w6w-muted w6w-small w6w-result-viewer-note">
            Too large to render — showing source.
          </div>
          {renderSource(d.text, language)}
        </>
      );
    } else if (mode === "source") {
      body = renderSource(d.text, language);
    } else if (d.format === "html") {
      // The ONLY path that renders vendor HTML — see the component doc.
      body = <HtmlPreview html={d.text} />;
    } else {
      body = <Markdown content={d.text} />;
    }
  }

  let bar: ReactNode = null;
  if (d.format === "json") {
    bar = (
      <div className="w6w-result-viewer-bar">
        <button
          type="button"
          className="w6w-btn w6w-btn-ghost"
          onClick={() => {
            setExpandDepth(Number.POSITIVE_INFINITY);
            setTreeEpoch((n) => n + 1);
          }}
        >
          Expand all
        </button>
        <button
          type="button"
          className="w6w-btn w6w-btn-ghost"
          onClick={() => {
            setExpandDepth(1);
            setTreeEpoch((n) => n + 1);
          }}
        >
          Collapse all
        </button>
      </div>
    );
  } else if (renderable && !overLimit) {
    bar = (
      <div className="w6w-result-viewer-bar">
        <button
          type="button"
          className={`w6w-btn w6w-btn-ghost${mode === "rendered" ? " active" : ""}`}
          data-mode="rendered"
          aria-pressed={mode === "rendered"}
          onClick={() => setMode("rendered")}
        >
          Rendered
        </button>
        <button
          type="button"
          className={`w6w-btn w6w-btn-ghost${mode === "source" ? " active" : ""}`}
          data-mode="source"
          aria-pressed={mode === "source"}
          onClick={() => setMode("source")}
        >
          Source
        </button>
      </div>
    );
  }

  return (
    <div
      className={["w6w-result-viewer", className ?? ""].filter(Boolean).join(" ")}
      data-format={d.format}
    >
      {bar}
      <Copyable value={copyText} label="Copy result" className="w6w-copyable--hover">
        <div className="w6w-result-viewer-body" style={{ maxHeight, overflow: "auto" }}>
          {body}
        </div>
      </Copyable>
    </div>
  );
}
