import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { useEffectiveTheme } from "./theme.ts";
import type { ThemeMode } from "./types.ts";

/**
 * A CodeMirror *editing* mode for `<CodeEditor>` — a distinct concept from the
 * Prism *display-highlighting* grammar name a sibling module exports for
 * rendered snippets. Deliberately its own type, not shared with that one.
 */
export type ScriptLanguage = "javascript" | "python";

// Exhaustive over every `ScriptLanguage` member, with no fallback arm — a
// third value added to the union fails to compile here instead of silently
// falling through (house idiom, see `StepBuilderModal.tsx`'s glyph maps /
// `doc-format.ts`'s total switch).
function languageExtension(language: ScriptLanguage): Extension {
  switch (language) {
    case "javascript":
      return javascript();
    case "python":
      return python();
  }
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Placeholder text shown when value is empty. */
  placeholder?: string;
  /** Minimum editor height. Defaults to "160px". */
  minHeight?: string;
  /** Maximum editor height before scrolling. Defaults to no cap. */
  maxHeight?: string;
  /** Explicit editor height. Pass `"100%"` to fill a flex parent. */
  height?: string;
  /** Read-only mode. */
  readOnly?: boolean;
  /**
   * Explicit theme. If omitted, auto-detects `data-theme` on `<html>` and falls
   * back to `prefers-color-scheme` — same behavior as `<JsonEditor>`.
   */
  theme?: ThemeMode;
  /**
   * CodeMirror editing mode (syntax highlighting + language-aware editing).
   * Omitted ⇒ today's exact plain-text behavior, unchanged.
   */
  language?: ScriptLanguage;
  /** Accessible label for the editor. */
  "aria-label"?: string;
}

/**
 * Plain-text-by-default code editor built on CodeMirror 6 — the same surface as
 * `<JsonEditor>` minus JSON language/linting, for editing snippets (e.g. an
 * inline script). Line numbers, bracket matching, and `--w6w-*` theming so it
 * inherits the consumer's palette. Pass `language` to opt into a CodeMirror
 * language pack (JavaScript/Python); omit it for the original dependency-free
 * plain-text mode.
 */
export function CodeEditor(props: CodeEditorProps) {
  const theme = useEffectiveTheme(props.theme);
  const extensions = useMemo(
    () => [
      ...(props.language ? [languageExtension(props.language)] : []),
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
    [props.language],
  );

  return (
    <div className="w6w-code-editor" aria-label={props["aria-label"] ?? "Code editor"}>
      <CodeMirror
        value={props.value}
        onChange={props.onChange}
        extensions={extensions}
        placeholder={props.placeholder}
        readOnly={props.readOnly}
        theme={theme}
        height={props.height}
        minHeight={props.minHeight ?? "160px"}
        maxHeight={props.maxHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !props.readOnly,
          bracketMatching: true,
          closeBrackets: true,
        }}
      />
    </div>
  );
}
