import { json, jsonParseLinter } from "@codemirror/lang-json";
import { lintGutter, linter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { CheckGlyph, CopyGlyph } from "./components/Copyable.tsx";
import { useCopyToClipboard } from "./components/use-copy.ts";
import { useEffectiveTheme } from "./theme.ts";
import type { ThemeMode } from "./types.ts";

export interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Fired whenever the current value parses as JSON, with the parsed value.
   * Never fires while the value is invalid — pair it with a validity flag if
   * you want to react to invalidation too (e.g., disable a Save button).
   */
  onValidChange?: (parsed: unknown) => void;
  /** Optional callback fired on every keystroke with parse validity + error. */
  onValidityChange?: (result: { valid: boolean; error?: string }) => void;

  /** Placeholder text shown when value is empty. */
  placeholder?: string;
  /** Minimum editor height. Defaults to "240px". */
  minHeight?: string;
  /** Maximum editor height before scrolling. Defaults to no cap. */
  maxHeight?: string;
  /**
   * Explicit editor height. Pass `"100%"` to fill a flex parent (the whole-config
   * "code" view). Omit to let the editor grow with its content between
   * `minHeight` and `maxHeight` — an inline JSON/group field wants this.
   */
  height?: string;

  /** Read-only mode — useful for previewing a stored definition. */
  readOnly?: boolean;

  /**
   * Explicit theme. If omitted, the editor auto-detects `data-theme` on
   * `<html>` and falls back to `prefers-color-scheme` — same behavior as
   * `<AppIcon>`. Uses CodeMirror's built-in one-dark for dark mode.
   */
  theme?: ThemeMode;

  /** Accessible label for the editor. */
  "aria-label"?: string;

  /**
   * Render an in-box copy-to-clipboard button, a direct child of this
   * component's own `.w6w-json-editor` wrapper (sibling to the CodeMirror
   * mount — no extra DOM node). Copies the current `value` verbatim.
   *
   * Off by default: the other five `<JsonEditor>` mounts in this tree are
   * not step-JSON config views and must render byte-identically to before
   * this prop existed.
   */
  copyable?: boolean;
}

/**
 * JSON editor built on CodeMirror 6. Syntax highlighting, folding, gutter with
 * lint markers for invalid JSON. Themed with the `--w6w-*` custom properties so
 * it inherits from the consumer's palette.
 *
 * ```tsx
 * <JsonEditor value={text} onChange={setText}
 *   onValidChange={(parsed) => setDefinition(parsed)}
 *   minHeight="320px" />
 * ```
 */
export function JsonEditor(props: JsonEditorProps) {
  const theme = useEffectiveTheme(props.theme);
  // Only mounted when `copyable` is on, but the hook itself must run
  // unconditionally (Rules of Hooks) — it is inert (no button, no listener)
  // until `copy()` is actually invoked from the button below.
  const { copied, copy } = useCopyToClipboard(props.value);
  const extensions = useMemo(
    () => [
      json(),
      linter(jsonParseLinter()),
      lintGutter(),
      EditorView.theme({
        "&": {
          fontSize: "13px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          backgroundColor: "var(--w6w-panel-2)",
          color: "var(--w6w-text)",
          border: "1px solid var(--w6w-border)",
          borderRadius: "8px",
        },
        "&.cm-focused": { outline: "2px solid var(--w6w-accent)" },
        ".cm-gutters": {
          backgroundColor: "var(--w6w-panel)",
          color: "var(--w6w-muted)",
          border: "none",
          borderRight: "1px solid var(--w6w-border)",
        },
        ".cm-scroller": { overflow: "auto" },
      }),
    ],
    [],
  );

  function handleChange(next: string) {
    props.onChange(next);
    if (!props.onValidChange && !props.onValidityChange) return;
    if (next.trim().length === 0) {
      props.onValidityChange?.({ valid: false, error: "Empty" });
      return;
    }
    try {
      const parsed = JSON.parse(next);
      props.onValidChange?.(parsed);
      props.onValidityChange?.({ valid: true });
    } catch (e) {
      props.onValidityChange?.({ valid: false, error: (e as Error).message });
    }
  }

  return (
    <div className="w6w-json-editor" aria-label={props["aria-label"] ?? "JSON editor"}>
      <CodeMirror
        value={props.value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={props.placeholder}
        readOnly={props.readOnly}
        // `readOnly` alone only blocks CodeMirror's own transactions
        // (`EditorState.readOnly`) — it leaves the content DOM
        // `contenteditable="true"`, so a screen reader / a11y test still sees
        // it as an editable field. `editable` is the separate switch that
        // actually sets `contenteditable` (`EditorView.editable`); tying it to
        // `readOnly` here makes the prop mean what its name says.
        editable={!props.readOnly}
        theme={theme}
        height={props.height}
        minHeight={props.minHeight ?? "240px"}
        maxHeight={props.maxHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !props.readOnly,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
        }}
      />
      {props.copyable && (
        <>
          <button
            type="button"
            className={`w6w-icon-btn w6w-copyable-btn${copied ? " is-copied" : ""}`}
            aria-label="Copy"
            onClick={() => void copy()}
          >
            {copied ? <CheckGlyph /> : <CopyGlyph />}
          </button>
          {/* Same live-region convention as `Copyable.tsx:141-147`: the
              button's accessible name stays constant, so this announces the
              result. */}
          <span className="w6w-copyable-status" aria-live="polite">
            {copied ? "Copied" : ""}
          </span>
        </>
      )}
    </div>
  );
}
