import { type CoalesceChain, formatReadableExpression, parseCoalesceChain } from "@w6w/expr";
import type { ExprPart } from "../types.ts";
import { parseRootAnchoredTemplate, serializeTemplate } from "./expression-template.ts";

/**
 * DOM helpers for the inline / modal expression editors: they render a value's
 * parts as editable text with atomic, non-editable CHIPS (tags) inline in the
 * flow, and read the parts back out of the contentEditable DOM. Shared so the
 * inline field and the full editor modal agree on chip markup and parsing.
 */

/**
 * A step-output ref: `steps.<id>.output` optionally followed by `.<field…>`.
 *
 * The id is one dot-free segment (`[^.]+`): a step id may not contain `.`, so a
 * dotted ref such as `steps.my.step.output.email` is NOT a step ref and falls
 * through to {@link varLabel}'s verbatim branch.
 */
const STEP_OUTPUT_REF = /^(?:nodes|steps)\.([^.]+)\.output(?:\.(.+))?$/;

/** `steps.<id>.meta.<key>` for exactly the four metadata keys; the output form is tried first. */
const STEP_META_REF = /^(?:nodes|steps)\.([^.]+)\.meta\.(app|version|action|connectionId)$/;

/**
 * The name a source or chip DISPLAYS. Never the ref it SAVES.
 *
 * A saved ref is always canonical and engine-resolvable — the run scope offers
 * exactly `var.* · steps.<id>.output.* · steps.<id>.meta.* · trigger.* · secrets.* · documents.* · const.* ·
 * inputs.* · foreach.* · output.*` (`core/rfcs/workflow.md` §Expressions, built
 * in `w6w-workflow/packages/engine/src/run.ts`). Those read long in a field, so
 * the label drops the root the chip's sigil and colour already imply:
 *
 * | ref                         | label          |
 * |-----------------------------|----------------|
 * | `var.from_email`            | `from_email`   |
 * | `steps.gate_1.output`       | `gate_1`       |
 * | `steps.gate_1.output.email` | `gate_1.email` |
 * | `steps.gate_1.meta.version` | `gate_1 meta · version` |
 * | anything else               | verbatim       |
 *
 * **`gate_1.email` is a LABEL ONLY — it is not an expression.** There is no
 * `gate_1` key at the run-scope root, so a chip that STORED the short form would
 * render perfectly in the editor and resolve to empty at run time, silently and
 * untraceably. `makeChip` keeps the two apart deliberately: the chip's stored
 * attribute carries the ref, this function only ever feeds `label.textContent`.
 */
export const varLabel = (ref: string): string => {
  if (ref.startsWith("var.")) return ref.slice("var.".length);
  if (ref.startsWith("vars.")) return ref.slice("vars.".length);
  if (ref.startsWith("const.")) return ref.slice("const.".length);
  const m = STEP_OUTPUT_REF.exec(ref);
  if (m) return m[2] ? `${m[1]}.${m[2]}` : m[1];
  const meta = STEP_META_REF.exec(ref);
  if (meta) return `${meta[1]} meta · ${meta[2]}`;
  return ref;
};

/** `v`'s `var` ref if `v` is a single-key `{ var: <string> }` object, else `undefined`. Mirrors
 * `@w6w/expr`'s own private `asVarOperand` (`core/packages/expr/src/template.ts`) — not exported,
 * so this repeats the shape check `parseCoalesceChain` already validated, purely to tell a `var`
 * operand from a literal one when rendering; it does not re-derive whether `part.expr` IS a chain. */
function chainOperandVarRef(v: unknown): string | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const keys = Object.keys(v as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "var") return undefined;
  const ref = (v as Record<string, unknown>).var;
  return typeof ref === "string" ? ref : undefined;
}

/**
 * A recognised `||`/`??` chain's chip LABEL (D-2) — mirrors {@link varLabel}'s split between what
 * a chip DISPLAYS and what it SAVES: `data-expr` (in {@link makeChip}) is the stored JSONLogic
 * untouched; this is display-only, built from the chain's own operands rather than truncated raw
 * JSON. A `{ var: ref }` operand renders through `varLabel` (the short form); any other operand (a
 * JSON primitive literal) renders through `JSON.stringify`. Do NOT call `varLabel` on the whole
 * chain — only on each `var` operand, same as a standalone `var` chip would.
 */
function chainLabel(chain: CoalesceChain): string {
  const token = chain.op === "or" ? "||" : "??";
  const text = chain.operands
    .map((operand) => {
      const ref = chainOperandVarRef(operand);
      return ref !== undefined ? varLabel(ref) : JSON.stringify(operand);
    })
    .join(` ${token} `);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/**
 * A key that cannot survive the trip from picker to engine, by CHARACTER.
 *
 * - `.` — JSONLogic's `var` splits its path on "." with **no escape and no
 *   bracket form** (`core/packages/expr/src/jsonlogic.ts` `getVar`:
 *   `String(path).split(".")`), so a key `a.b` becomes the lookup
 *   `output → a → b` and yields `null`. There is no spelling that reaches it.
 * - `{` / `}` — they collide with the `{{ … }}` template grammar
 *   (`expression-template.ts`), so the ref does not survive the text round trip.
 *
 * Interior whitespace is deliberately NOT here: `output["first name"]` is a
 * plain property lookup that `getVar` performs correctly, and
 * `{{ steps.g.output.first name }}` round-trips (only the OUTER pad is trimmed).
 * Leading/trailing whitespace IS rejected, below — that pad is what gets eaten.
 */
const UNREACHABLE_KEY_CHARS = /[.{}]/;

/**
 * Whether a declared output key can become a ref the engine actually resolves.
 *
 * A key that fails this would still produce a chip that renders perfectly and
 * evaluates to **empty at run time, silently** — the same failure mode the
 * label/ref split exists to avoid — so the picker must not offer it at all. The
 * step's WHOLE output (`steps.<id>.output`) is still offered, which remains the
 * author's route to such a field via an explicit `=` JSONLogic expression.
 */
export function isRefSafeKey(key: string): boolean {
  if (key === "" || key !== key.trim()) return false;
  return !UNREACHABLE_KEY_CHARS.test(key);
}

/**
 * Whether a declared output PATH (`start.utc` — an app action's `OutputField`
 * key, where `.` means nesting, not a literal character) can become a ref the
 * engine resolves: the same `getVar` split that makes a literal `a.b` key
 * unreachable is what walks a path, so each SEGMENT must pass
 * {@link isRefSafeKey} on its own.
 */
export function isRefSafePath(path: string): boolean {
  return path.split(".").every(isRefSafeKey);
}

/**
 * Lay a step's flat output fields out as a tree for the picker: each row shows only its OWN
 * name, nested under the nearest listed ancestor. `event`, `event.tz`, `event.start.utc` read as
 * `event` › `tz`, `start.utc` — the step id and the shared prefix are what truncated every row to
 * the same `eventbrite_to_cohost_1.event.…`. A literal key (no `path`) is one name at depth 0.
 * Display only: the ref is still built from the verbatim `key`.
 */
export function outputFieldTree<F extends { key: string; path?: boolean }>(
  fields: F[],
): { field: F; depth: number; name: string }[] {
  const paths = new Set(fields.filter((f) => f.path).map((f) => f.key));
  return fields.map((field) => {
    if (!field.path) return { field, depth: 0, name: field.key };
    const segs = field.key.split(".");
    let depth = 0;
    let cut = 0;
    for (let i = 1; i < segs.length; i++) {
      if (paths.has(segs.slice(0, i).join("."))) {
        depth++;
        cut = i;
      }
    }
    return { field, depth, name: segs.slice(cut).join(".") };
  });
}

/**
 * Build the non-editable inline chip (tag) DOM node for a part.
 *
 * `renderToggle` is opt-in and defaults OFF: `makeChip` is shared through
 * {@link paintParts} by every editing surface, including the inline
 * `ExpressionInput` (`ExpressionInput.tsx`), which has no handler for the
 * flip control at all. A painter must not decide who gets an affordance —
 * only `ExpressionEditorModal` (the one surface with a click delegate for
 * `[data-render-toggle]`) passes `true`. Round 2 fix for F-2: before this,
 * every `var`/`render` chip everywhere painted the toggle unconditionally,
 * so it leaked into every inline expression field in studio as a dead,
 * screen-reader-announced control.
 */
export function makeChip(
  doc: Document,
  part: ExprPart,
  { renderToggle }: { renderToggle?: boolean } = {},
): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.className = `w6w-expr-chip w6w-expr-chip-${part.kind}`;
  span.setAttribute("data-kind", part.kind);

  const sigil = doc.createElement("span");
  sigil.className = "w6w-expr-chip-sigil";
  const label = doc.createElement("span");
  label.className = "w6w-expr-chip-label";

  if (part.kind === "var") {
    span.setAttribute("data-ref", part.ref ?? "");
    // A small, quiet marker (accent colour carries the "variable" meaning) —
    // never the literal `{x}`, which read as noise crowding the field.
    sigil.textContent = "◆";
    label.textContent = varLabel(part.ref ?? "");
    span.title = `Variable: ${part.ref ?? ""}`;
  } else if (part.kind === "render") {
    span.setAttribute("data-ref", part.ref ?? "");
    // A visually distinct sigil from a plain `var` chip: this ref's RESOLVED
    // value is itself parsed as a `{{ }}` template and rendered (the amendment
    // in `core/rfcs/workflow.md`). Same label rule — `varLabel` doesn't
    // depend on kind.
    sigil.textContent = "▤";
    label.textContent = varLabel(part.ref ?? "");
    span.title = `Render as template: ${part.ref ?? ""}`;
  } else if (part.kind === "secret") {
    span.setAttribute("data-ref", part.ref ?? "");
    sigil.textContent = "🔒";
    label.textContent = part.ref ?? ""; // the NAME — never the value
    span.title = `Secret: ${part.ref ?? ""}`;
  } else {
    const raw = typeof part.expr === "string" ? part.expr : JSON.stringify(part.expr ?? "");
    span.setAttribute("data-expr", raw); // display-only label below; the stored JSONLogic is unchanged.
    sigil.textContent = "ƒ";
    const chain = parseCoalesceChain(part.expr);
    if (chain) {
      label.textContent = chainLabel(chain);
      span.title = `Expression: ${serializeTemplate([part])}`;
    } else {
      const readable = formatReadableExpression(part.expr, varLabel);
      label.textContent = readable ?? (raw.length > 24 ? `${raw.slice(0, 24)}…` : raw || "expr");
      span.title = `Expression: ${readable ?? raw}`;
    }
  }

  span.append(sigil, label);

  if ((part.kind === "var" || part.kind === "render") && renderToggle) {
    // The render affordance: flip THIS chip between "insert this ref" (var)
    // and "insert this ref, then render its resolved value as a `{{ }}`
    // template" (render) — never a second, free-text ref-construction path.
    // The modal's click delegate handles the flip by rebuilding the chip via
    // `makeChip` from the SAME `data-ref`, never a re-derived string.
    const toggle = doc.createElement("span");
    toggle.className = "w6w-expr-chip-toggle";
    toggle.setAttribute("data-render-toggle", "1");
    toggle.setAttribute("role", "button");
    const toggleLabel =
      part.kind === "render" ? "Stop rendering as a template" : "Render this as a template";
    toggle.setAttribute("aria-label", toggleLabel);
    toggle.title = toggleLabel;
    toggle.textContent = "⇄";
    span.append(toggle);
  }

  const x = doc.createElement("span");
  x.className = "w6w-expr-chip-x";
  x.setAttribute("data-x", "1");
  x.setAttribute("role", "button");
  x.setAttribute("aria-label", "Remove");
  x.textContent = "×";
  span.append(x);
  return span;
}

/**
 * Elements `contentEditable` builds one-per-line. A block child means "the
 * content before me ended a line", so it contributes an implicit newline.
 */
const BLOCK_TAGS = new Set(["div", "p"]);

/**
 * Decode a chip element back into the part it represents — the one and only
 * decode in the file. Hoisted out of {@link readParts}'s inline `var` /
 * `secret` / `render` (`data-ref`) and `expr` (`data-expr` JSON) arms so
 * {@link chipToText} can reuse the exact same logic rather than re-deriving
 * it; `readParts` itself now calls this instead of carrying its own copy.
 * `null` for any element that isn't a chip (`data-kind` absent or not one of
 * the four kinds) — the caller falls through to its other element handling.
 */
export function chipToPart(el: HTMLElement): ExprPart | null {
  const kind = el.getAttribute("data-kind");
  if (kind === "var" || kind === "secret" || kind === "render") {
    return { kind, ref: el.getAttribute("data-ref") ?? "" };
  }
  if (kind === "expr") {
    const raw = el.getAttribute("data-expr") ?? "";
    let expr: unknown = raw;
    try {
      expr = JSON.parse(raw);
    } catch {
      expr = raw;
    }
    return { kind: "expr", expr };
  }
  return null;
}

/**
 * Reconstruct parts from an editor's DOM (the source of truth while editing).
 *
 * The walk is **recursive**: a native Enter wraps the caret's line in a `<div>`
 * (or drops a `<br>`), and anything nested inside it — chips included — must
 * survive. Reading `textContent` at that point would flatten a chip to its
 * label and silently destroy the reference it carries, so every unrecognised
 * element is descended into instead. `<br>` and block children map to a literal
 * `"\n"`; `pushText` coalesces those into the surrounding text part.
 *
 * One `<br>` is deliberately NOT a newline: a FILLER one, closing its block —
 * see `walk` and {@link ensureFillerBreak}.
 */
export function readParts(root: HTMLElement): ExprPart[] {
  const parts: ExprPart[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === "text") last.value = (last.value ?? "") + t;
    else parts.push({ kind: "text", value: t });
  };

  /** `lastInBlock`: this node is the final child of the root, a `div` or a `p`. */
  const walk = (node: Node, lastInBlock: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    const part = chipToPart(el);
    if (part) {
      parts.push(part);
      return;
    }

    // Browsers report `BR` / `DIV` uppercase for HTML documents.
    const tag = (el.tagName ?? "").toLowerCase();
    if (tag === "br") {
      // A <br> CLOSING its block is a FILLER, not a line the author made: it
      // exists so an otherwise-empty last line has a box for the caret to land
      // in. Three things produce one, all measured in Chromium
      // (`artifacts/T3.1.2-browser-check.sh`):
      //   1. {@link ensureFillerBreak}, after we insert our own "\n";
      //   2. a PASTED blank line — `<div><br></div>`, where the block already
      //      carries the break and the <br> only fills it. Counting both
      //      inflates one blank line into two;
      //   3. the browser itself, after a `contentEditable="false"` chip.
      // A <br> the author really made has content (or another line) after it
      // inside its block, so it is never the block's last child.
      if (!lastInBlock) pushText("\n");
      return;
    }
    // A *leading* block is the first line, not a break after something.
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && parts.length > 0) pushText("\n");
    walkChildren(el, isBlock);
  };

  const walkChildren = (parent: Node, isBlockParent: boolean) => {
    const children = Array.from(parent.childNodes);
    children.forEach((child, i) => walk(child, isBlockParent && i === children.length - 1));
  };

  walkChildren(root, true);
  return parts;
}

/**
 * Is this the filler `<br>` closing a block — the caret's landing pad, never
 * part of the value? Callers only ever ask it about a block's LAST child, which
 * is what makes "a `<br>` here" and "a filler" the same question (`readParts`
 * skips exactly this node).
 *
 * The test is deliberately narrower than "is an element": a block ending in a
 * CHIP is also ending in an element, and a chip is `contentEditable="false"`, so
 * it gives the caret nowhere to land and still needs a filler after it.
 */
const isFillerBreak = (node: Node | null): boolean =>
  !!node && ((node as HTMLElement).tagName ?? "").toLowerCase() === "br";

/**
 * Append the filler `<br>` that lets a `"\n"` ENDING this block render.
 *
 * Idempotent — a block already closed by a `<br>` is left alone. That guard is
 * load-bearing, not tidiness: a second filler would no longer be the block's
 * last child, so `readParts` would read it as a real newline and the value would
 * grow a blank line per keystroke-that-triggers-a-fill.
 */
function fillBlock(block: HTMLElement): void {
  if (isFillerBreak(block.lastChild)) return;
  block.appendChild(block.ownerDocument.createElement("br"));
}

/**
 * The block the caret currently sits in, within `editor` — the editor itself
 * when the caret is at its top level, or is not inside it at all.
 *
 * The filler has to go in the SAME block as the newline it exists to render.
 * After a paste, the caret's line is an inner `<div>` (`one<div>three</div>`),
 * so filling the root instead would leave the `"\n"` trailing inside the div
 * with nothing to render it — the very failure the filler exists to prevent.
 */
function caretBlock(editor: HTMLElement): HTMLElement {
  const sel = editor.ownerDocument.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  // `editor.contains(...)`: a selection somewhere ELSE in the document must not
  // make us walk up into a foreign `div`/`p` and append a filler there. Nothing
  // reaches it today — `ensureFillerBreak`'s only callers are the two keydown
  // handlers, where the caret is inside the editor by construction — so no probe
  // can distinguish it from its absence (T3.1.2 eval, R2-5). It is kept because
  // the barrier is the CALL SITES, and the first non-keydown caller arms it.
  if (!range || !editor.contains(range.endContainer)) return editor;
  let node: Node | null = range.endContainer;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (BLOCK_TAGS.has((el.tagName ?? "").toLowerCase())) return el;
    }
    node = node.parentNode;
  }
  return editor;
}

/**
 * Give a line break at the very END of the caret's line somewhere to render.
 *
 * A `"\n"` that is the last thing in a `white-space: pre-wrap` block paints
 * nothing, and the caret cannot land past it — the author presses Enter, sees no
 * break, and their next keystroke lands on the *previous* line (observed in
 * Chromium; see `artifacts/T3.1.2-browser-check.sh`). Browsers solve this for
 * their own line breaks with a FILLER `<br>` as the block's last child, so ours
 * uses the same device. `readParts` skips exactly that node — the two are one
 * fact, kept in one file.
 */
export function ensureFillerBreak(editor: HTMLElement): void {
  fillBlock(caretBlock(editor));
}

/**
 * Does this editing host render more than one line?
 *
 * Read from the host's OWN `aria-multiline`, which both editors set from the
 * same `multiline` prop that decides whether Enter inserts anything
 * (`ExpressionInput.tsx`, `ExpressionEditorModal.tsx`) — so the attribute is not
 * a proxy for the flag, it *is* the flag, already on the node this file is
 * handed. Threading a second copy of it down as an argument would make the two
 * editors' call sites the only source of truth and leave the DOM free to
 * disagree with it.
 *
 * Absent ⇒ multiline: a host that never declared itself single-line keeps the
 * pre-existing behaviour, and the two real editors always declare.
 */
const isMultilineHost = (el: HTMLElement): boolean => el.getAttribute("aria-multiline") !== "false";

/**
 * Paint an editor's DOM from parts (text nodes + chips).
 *
 * `opts` passes straight through to {@link makeChip} — `renderToggle`
 * defaults off, so a caller that never opts in (`ExpressionInput.tsx`) paints
 * no toggle at all, and only `ExpressionEditorModal` turns it on.
 */
export function paintParts(
  el: HTMLElement,
  parts: ExprPart[],
  opts?: { renderToggle?: boolean },
): void {
  const doc = el.ownerDocument;
  el.textContent = "";
  for (const p of parts) {
    if (p.kind === "text") {
      if (p.value) el.appendChild(doc.createTextNode(p.value));
    } else {
      el.appendChild(makeChip(doc, p, opts));
    }
  }
  // A painted value ENDING in a newline needs the filler just as much as a
  // freshly typed one does — this is the same block, rebuilt from parts. Without
  // it the break survives the round trip in the VALUE but not on SCREEN, and the
  // author's next keystroke lands before it: "a\n" + typing "b" saved "ab\n".
  //
  // …but only where a break can be rendered at all. A SINGLE-LINE field can
  // still hold a value ending in "\n" (paste it in — neither editor has an
  // `onPaste` handler), and there the filler gives it a second line box: the
  // field silently doubles in height for a break the author can never reach,
  // since Enter is swallowed on that path. The value is identical either way —
  // `readParts` skips the filler — so this is purely about what is painted.
  const last = parts[parts.length - 1];
  if (last?.kind === "text" && last.value?.endsWith("\n") && isMultilineHost(el)) fillBlock(el);
}

/**
 * Put the caret at the end of the editor.
 *
 * Deliberately NOT special-cased for a trailing filler `<br>`: a caret placed
 * past the filler is a position Chromium normalises straight back into the
 * content, so the next character still lands before the filler. That was
 * measured, not assumed — a version of this function that skipped the filler
 * explicitly could not be distinguished from this one by any probe in
 * `T3.1.2-browser-check.sh`, including §K, which exists to try. What DOES have
 * to respect the filler is the node insertion itself (see `insertNodeAtCaret`).
 */
export function placeCaretAtEnd(el: HTMLElement): void {
  const sel = el.ownerDocument.getSelection();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Insert a node at the caret (or at the end if the caret isn't in the editor). */
export function insertNodeAtCaret(editor: HTMLElement, node: Node): void {
  const doc = editor.ownerDocument;
  const sel = doc.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  if (range && editor.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    range.insertNode(node);
    const after = doc.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
  } else {
    // No caret in the editor (e.g. a source clicked in the modal's left pane
    // before the editor was ever focused). Insert at the end of the CONTENT —
    // which is before a trailing filler, not after it: appending past the filler
    // would stop it being the block's last child and `readParts` would then read
    // it as a real newline ("a\n" + a chip saved "a\n\n{{ … }}").
    if (isFillerBreak(editor.lastChild)) editor.insertBefore(node, editor.lastChild);
    else editor.appendChild(node);
    placeCaretAtEnd(editor);
  }
  editor.focus();
}

/**
 * D-3 (binding): promote a just-closed `{{ … }}` marker to a chip at the
 * keystroke that closes it — the caret-safe surgery an `onInput` handler can
 * call directly, with NO `paintGen` bump (see the warning at the top of
 * `ExpressionEditorModal.tsx` and `G-typing` in `expr-template-guards.test.cjs`:
 * a repaint here resets the caret and reorders every subsequent keystroke).
 *
 * Returns `false`, doing nothing, unless ALL of:
 *   - the selection is collapsed inside a text node `editor` contains;
 *   - the two characters immediately before the caret are `}}`;
 *   - there is a `{{` earlier in THAT SAME text node (a marker interrupted by
 *     a chip — i.e. split across text nodes — is not a marker, deliberately);
 *   - `parseRootAnchoredTemplate` of the text from that `{{` to the caret
 *     parses to exactly ONE part that is not `kind: "text"` (an unrooted
 *     marker, or one that isn't a single complete part, stays literal).
 *
 * On success: deletes exactly that span and inserts the chip in its place —
 * the same `Range` surgery `insertNodeAtCaret` performs, mirrored rather than
 * reused because the span here is a slice of an EXISTING text node, not the
 * live selection — then collapses the caret just after the chip.
 */
export function promoteCompletedMarkerAtCaret(
  editor: HTMLElement,
  opts: { renderToggle?: boolean } = {},
): boolean {
  const doc = editor.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return false;

  const offset = range.startOffset;
  const text = node.textContent ?? "";
  if (offset < 2 || text.slice(offset - 2, offset) !== "}}") return false;
  const openIdx = text.lastIndexOf("{{", offset - 2);
  if (openIdx === -1) return false;

  const marker = text.slice(openIdx, offset);
  const parsed = parseRootAnchoredTemplate(marker);
  if (parsed.length !== 1 || parsed[0].kind === "text") return false;
  // `\{{ … }}` is an escaped, literal marker — it stays text (`\\{{` does not escape).
  let slashes = 0;
  while (openIdx - 1 - slashes >= 0 && text[openIdx - 1 - slashes] === "\\") slashes += 1;
  if (slashes % 2 === 1) return false;

  const markerRange = doc.createRange();
  markerRange.setStart(node, openIdx);
  markerRange.setEnd(node, offset);
  markerRange.deleteContents();
  const chip = makeChip(doc, parsed[0], opts);
  markerRange.insertNode(chip);

  const after = doc.createRange();
  after.setStartAfter(chip);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  return true;
}

/**
 * D-3: the reverse of {@link promoteCompletedMarkerAtCaret} — a chip back to
 * its editable `{{ … }}` text, in place. `chipToPart` is the SAME decode
 * `readParts` uses, so what comes back is exactly what the chip carries, and
 * `serializeTemplate` is the SAME serializer the round trip already goes
 * through everywhere else in this file. `null` for an element that isn't a
 * chip. The caller collapses the caret at the returned node's end — this
 * function only performs the DOM swap, mirroring `chip.replaceWith` being the
 * whole of the "remove" arm (`onClick`'s `[data-x]` handler) in both editors.
 */
export function chipToText(chip: HTMLElement): Text | null {
  const part = chipToPart(chip);
  if (!part) return null;
  const readable =
    part.kind === "expr" && !parseCoalesceChain(part.expr)
      ? formatReadableExpression(part.expr)
      : null;
  const text = chip.ownerDocument.createTextNode(readable ?? serializeTemplate([part]));
  chip.replaceWith(text);
  return text;
}
