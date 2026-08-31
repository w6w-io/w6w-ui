import { Highlight, Prism } from "prism-react-renderer";
import type { PrismTheme } from "prism-react-renderer";
import { Copyable } from "./components/Copyable.tsx";

/**
 * Shell grammar, registered onto the bundled Prism.
 *
 * `prism-react-renderer` ships 50 grammars and **bash is not one of them** —
 * which is exactly the one a CLI snippet needs. The documented way to add it is
 * to assign `globalThis.Prism` and then side-effect-import
 * `prismjs/components/prism-bash`; that means a second dependency AND mutating a
 * global from inside a library, which a consuming app has no way to opt out of.
 *
 * A Prism grammar is plain data, so we register a compact one instead. It covers
 * what our snippets actually contain — comments, quoted strings, `$VAR`,
 * option flags, the line-continuation backslash, and the leading command word —
 * and nothing else. It is deliberately not a general shell parser.
 */
const SHELL_GRAMMAR = {
  comment: { pattern: /(^|[^"{\\$])#.*/, lookbehind: true },
  // Before `string`, so the `\` ending a continued line never opens one.
  continuation: { pattern: /\\$/m, alias: "punctuation" },
  string: [
    { pattern: /"(?:[^"\\]|\\[\s\S])*"/, greedy: true },
    { pattern: /'(?:[^'\\]|\\[\s\S])*'/, greedy: true },
  ],
  variable: /\$(?:\{[^}]*\}|[A-Za-z_]\w*)/,
  // `--payload`, `-w`. Kept distinct from `keyword` so a reader can pick the
  // flags out of a long command at a glance — the whole point of the CLI tab.
  parameter: { pattern: /(^|\s)--?[\w-]+/, lookbehind: true, alias: "keyword" },
  // The command word: line start, or after a pipe/`&&`/`;`.
  function: { pattern: /(^|[|&;]\s*)[\w./-]+/m, lookbehind: true },
  operator: /\|\||&&|[|&;<>]/,
  punctuation: /[{}[\]()]/,
} as const;

// Idempotent: the module may be evaluated more than once under HMR.
if (!Prism.languages.shell) {
  Prism.languages.shell = SHELL_GRAMMAR as unknown as typeof Prism.languages.shell;
  Prism.languages.bash = Prism.languages.shell;
  Prism.languages.sh = Prism.languages.shell;
}

/**
 * Languages this component can highlight.
 *
 * Every entry is either bundled with `prism-react-renderer` or registered above.
 * Typed as a union rather than `string` so a caller cannot silently ask for a
 * grammar that is not loaded — an unknown language renders as unstyled plain
 * text, which looks like a styling bug rather than a missing grammar.
 */
export type CodeLanguage =
  | "bash"
  | "shell"
  | "json"
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "yaml"
  | "sql"
  | "markdown"
  | "python"
  | "go"
  | "rust"
  | "markup"
  | "css"
  | "plaintext";

export interface CodeBlockProps {
  /** The source to display. Rendered verbatim; never parsed or executed. */
  code: string;
  /** Grammar to highlight with. Defaults to `"plaintext"` (no highlighting). */
  language?: CodeLanguage;
  /**
   * Soft-wrap long lines instead of scrolling horizontally.
   *
   * Off by default: for code, a horizontal scrollbar preserves the line
   * structure the author intended. Turn it on where the container is narrow and
   * the exact line breaks do not carry meaning.
   */
  wrap?: boolean;
  /** Show a gutter of line numbers. Off by default. */
  showLineNumbers?: boolean;
  /** Cap the height and scroll beyond it, e.g. `"320px"`. Uncapped by default. */
  maxHeight?: string;
  /** Extra class on the `<pre>`, for spacing/width in the consuming layout. */
  className?: string;
  /** Accessible label. Falls back to naming the language. */
  "aria-label"?: string;
  /**
   * Wrap the block in `<Copyable readOnly>` so the button in the block's
   * top-right corner — or a click anywhere in the box — copies the displayed
   * source verbatim. **On by default**: a code block a reader cannot copy is
   * the odd one out, not the norm.
   *
   * `className` still lands on the `<pre>` itself — this adds a wrapper around
   * it, it does not change what the `<pre>` renders.
   *
   * Turn it OFF for a block that renders without hydration. A React component
   * server-rendered with no `client:` directive (Astro's default, e.g. the
   * marketing site's `Snippet.astro`) still emits the button, but nothing is
   * listening to it — and a dead click target is worse than no button.
   */
  copyable?: boolean;
  /**
   * How long the copied checkmark shows before reverting, in ms. Default 1500.
   * Ignored unless `copyable`. See `Copyable`'s own prop for why the default is
   * worth keeping.
   */
  copiedMs?: number;
}

/**
 * The Prism theme, expressed entirely in `--w6w-*` custom properties.
 *
 * This is why `<CodeBlock>` takes no `theme` prop while `<CodeEditor>` and
 * `<JsonEditor>` do: CodeMirror themes are JavaScript, so those components must
 * resolve light/dark in JS and re-render on a change. Prism styles are plain
 * inline CSS, so the browser resolves the variables — which means the palette
 * follows `data-theme` and `prefers-color-scheme` with no JS, no observer, no
 * flash on first paint, and correct output under SSR.
 *
 * A consumer restyles this the same way they restyle everything else: override
 * `--w6w-code-*` in their own CSS.
 */
const THEME: PrismTheme = {
  plain: { color: "var(--w6w-text)", backgroundColor: "transparent" },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "var(--w6w-code-comment)", fontStyle: "italic" },
    },
    { types: ["punctuation", "continuation"], style: { color: "var(--w6w-code-punctuation)" } },
    {
      types: ["property", "tag", "constant", "symbol", "deleted"],
      style: { color: "var(--w6w-code-keyword)" },
    },
    { types: ["boolean", "number"], style: { color: "var(--w6w-code-number)" } },
    {
      types: ["selector", "attr-name", "string", "char", "builtin", "inserted"],
      style: { color: "var(--w6w-code-string)" },
    },
    {
      types: ["operator", "entity", "url", "variable"],
      style: { color: "var(--w6w-code-variable)" },
    },
    {
      types: ["atrule", "attr-value", "keyword", "parameter"],
      style: { color: "var(--w6w-code-keyword)" },
    },
    { types: ["function", "class-name"], style: { color: "var(--w6w-code-function)" } },
    { types: ["regex", "important"], style: { color: "var(--w6w-code-number)" } },
  ],
};

/**
 * Read-only, syntax-highlighted code display.
 *
 * The counterpart to `<CodeEditor>` / `<JsonEditor>`: those mount a CodeMirror
 * instance to *edit* text, which is heavy and semantically wrong for a snippet
 * nobody types into. This renders a plain `<pre><code>` with coloured spans, so
 * it is selectable, copyable, searchable by the browser's find, and costs
 * nothing per instance.
 *
 * The text is only ever placed in React children, never `dangerouslySetInnerHTML`
 * — a snippet built from user or third-party data cannot inject markup.
 */
export function CodeBlock(props: CodeBlockProps) {
  const {
    code,
    language = "plaintext",
    wrap,
    showLineNumbers,
    maxHeight,
    className,
    copyable = true,
    copiedMs,
  } = props;

  // Trailing newlines would render as a blank final row with a line number.
  const source = code.replace(/\n+$/, "");

  return (
    <Highlight theme={THEME} code={source} language={language}>
      {({ className: prismClass, style, tokens, getLineProps, getTokenProps }) => {
        const pre = (
          <pre
            className={[
              "w6w-code-block",
              wrap ? "w6w-code-block--wrap" : "",
              showLineNumbers ? "w6w-code-block--numbered" : "",
              prismClass,
              className ?? "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ ...style, ...(maxHeight ? { maxHeight, overflowY: "auto" } : null) }}
            aria-label={props["aria-label"] ?? `${language} code`}
          >
            <code>
              {(() => {
                // Keys are the token's OFFSET IN THE SOURCE, not its array index.
                // Two identical lines then still get distinct keys, and the key
                // means something a reader can check. `let` is safe here: the
                // walk is synchronous and the closure is not reused across
                // renders.
                let offset = 0;
                return tokens.map((line, i) => {
                  const lineProps = getLineProps({ line });
                  const cls = `w6w-code-line ${lineProps.className ?? ""}`;
                  const lineKey = `L${offset}`;
                  let col = offset;
                  const spans = line.map((token, tokenIndex) => {
                    const tokenProps = getTokenProps({ token });
                    // `tokenIndex` tiebreaks tokens that share an offset (e.g. a
                    // zero-length token Prism can emit) — offset alone isn't
                    // guaranteed unique within a line.
                    const key = `T${col}-${tokenIndex}`;
                    col += token.content.length;
                    return <span {...tokenProps} key={key} />;
                  });
                  // +1 for the newline the tokenizer stripped.
                  offset = col + 1;
                  return (
                    <span {...lineProps} key={lineKey} className={cls}>
                      {showLineNumbers && (
                        <span className="w6w-code-line-no" aria-hidden="true">
                          {i + 1}
                        </span>
                      )}
                      <span className="w6w-code-line-text">{spans}</span>
                    </span>
                  );
                });
              })()}
            </code>
          </pre>
        );
        return copyable ? (
          <Copyable value={source} copiedMs={copiedMs} readOnly>
            {pre}
          </Copyable>
        ) : (
          pre
        );
      }}
    </Highlight>
  );
}
