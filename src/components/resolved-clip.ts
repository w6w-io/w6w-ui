/**
 * Clipping for ONE resolved value's display text (Test tab, read-only rows).
 *
 * A resolved row is a SUMMARY of what the run will be sent, not a viewer for
 * it. A value that resolves from a document (`documents.*.body`) or a rendered
 * template is routinely tens of kilobytes of HTML, and pasting all of it inline
 * pushed the rest of the params — and the run's own result — off the screen
 * (human report, 2026-09-01). So a long value is clipped here and offered
 * behind a toggle; the complete value is always one click away in the `<>`
 * code view above, which is COMPLETE over every visible param by construction
 * (`resolved-json.ts`, D-2) and so must never be clipped itself.
 *
 * Plain `.ts`, no React — same pure-module-beside-the-component precedent
 * `history-scale.ts` sets for `HistoryTimeline.tsx`, so the rule is testable
 * without a JSX transpile.
 */

/**
 * Characters shown before a value is clipped. Sized to a few lines at the
 * row's font — enough to recognize WHICH value resolved (the opening of an
 * HTML document, a subject line, a URL) without becoming the page.
 */
export const RESOLVED_VALUE_CLIP = 220;

/** A clip decision: the text to render, and whether anything was withheld. */
export interface ClippedValue {
  /** What to show when collapsed — never longer than {@link RESOLVED_VALUE_CLIP}. */
  text: string;
  /** True when `text` is shorter than the input, i.e. a toggle is warranted. */
  clipped: boolean;
  /** The full value's length, for the toggle's own label. */
  length: number;
}

/**
 * Clip `text` for the collapsed row. At or under the budget the input is
 * returned byte-identically and `clipped` is false — a short value must never
 * grow a toggle, an ellipsis, or a trailing-whitespace trim it didn't ask for.
 *
 * Over the budget, the cut is a plain `slice` at the boundary with trailing
 * whitespace trimmed (so an ellipsis never floats a space away from the text).
 * No word-boundary search: these values are markup and JSON as often as prose,
 * where "the last space" is not a meaningful place to stop.
 */
export function clipResolvedValue(text: string): ClippedValue {
  if (text.length <= RESOLVED_VALUE_CLIP) {
    return { text, clipped: false, length: text.length };
  }
  return {
    text: text.slice(0, RESOLVED_VALUE_CLIP).trimEnd(),
    clipped: true,
    length: text.length,
  };
}
