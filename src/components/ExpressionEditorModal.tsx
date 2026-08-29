import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExprPart, ExprValue, SecretValue } from "../types.ts";
import type { ExpressionOptions } from "./ExpressionOptions.tsx";
import { Modal } from "./Modal.tsx";
import {
  chipToText,
  ensureFillerBreak,
  insertNodeAtCaret,
  isRefSafeKey,
  makeChip,
  paintParts,
  placeCaretAtEnd,
  promoteCompletedMarkerAtCaret,
  readParts,
  varLabel,
} from "./expression-dom.ts";
import {
  parseRootAnchoredTemplate,
  partsToValue,
  renderResult,
  serializeTemplate,
  valueToParts,
} from "./expression-template.ts";

/**
 * A near-full-screen editor for an expression value. Left: the data sources in
 * scope (variables, secrets, and the workflow state leading to this step) — one
 * click inserts a colored TAG (chip) at the caret. Right: the expression editor
 * (top, where tags read distinctly from plain text) over the `{{ }}` template
 * form that gets saved plus a live Result pane (bottom) that previews the
 * expression against user-supplied sample values for the injected scope.
 *
 * The value it saves is the same `ExprValue | string` the inline field and the
 * engine already use (see `expression-template.ts` / `expression-dom.ts`).
 */
export interface ExpressionEditorModalProps {
  value: ExprValue | string | SecretValue | undefined;
  masked?: boolean;
  /**
   * The field being edited holds multi-line text (a `text`-typed param, or one
   * flagged `config.multiline`). Enter then inserts a literal `"\n"` at the
   * caret instead of being swallowed, and `aria-multiline` follows. Omitted ⇒
   * single-line, as every existing consumer expects.
   */
  multiline?: boolean;
  options: ExpressionOptions;
  /** Field name shown in the modal title. */
  fieldLabel?: string;
  onSave: (next: ExprValue | string) => void;
  onClose: () => void;
}

export function ExpressionEditorModal({
  value,
  masked,
  multiline,
  options,
  fieldLabel,
  onSave,
  onClose,
}: ExpressionEditorModalProps) {
  const [parts, setParts] = useState<ExprPart[]>(() => valueToParts(value).parts);
  // Bumped ONLY for programmatic repaints — mount, and committing template
  // text back into chips. Typing/insert mutate the DOM directly and sync out,
  // so the caret is never clobbered; NEVER bump this from `onInput`,
  // `insertPart`, the Enter handler, or a chip flip.
  const [paintGen, setPaintGen] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  // Set right before a programmatic paint that should also move focus/caret
  // into the chips editor — never on the mount paint.
  const focusChipsAfterPaint = useRef(false);
  // User-supplied sample values (keyed by var ref) that the Result pane previews
  // the expression against. Design-time only — never sent to the engine.
  const [samples, setSamples] = useState<Record<string, string>>({});
  // Which store's "+ Add" nested dialog is open, or none. Gated at render by
  // whether the host supplied the matching callback (`options.createVar` /
  // `.createSecret`) — see the rail below.
  const [adding, setAdding] = useState<"var" | "secret" | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: paint on `paintGen`, not on every `parts` change; edits otherwise flow through the DOM.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    // renderToggle: true — the modal is the one surface with a click delegate
    // for `[data-render-toggle]` (below); `ExpressionInput.tsx` never opts in.
    paintParts(el, parts, { renderToggle: true });
    if (focusChipsAfterPaint.current) {
      focusChipsAfterPaint.current = false;
      placeCaretAtEnd(el);
      el.focus();
    }
  }, [paintGen]);

  const sync = () => {
    const el = editorRef.current;
    if (el) setParts(readParts(el));
  };

  const insertPart = (part: ExprPart) => {
    const el = editorRef.current;
    if (!el) return;
    insertNodeAtCaret(el, makeChip(el.ownerDocument, part, { renderToggle: true }));
    setParts(readParts(el));
  };

  // A render part can only ever be authored by flipping an EXISTING var chip
  // (below) — never inserted directly — so this is derived from `parts` on
  // every render, not computed once at mount: flipping mid-edit must disable
  // the control below immediately, and flipping back must re-enable it.
  const hasRenderPart = parts.some((p) => p.kind === "render");

  // Adopt a text form as the parts and repaint the chips editor — the
  // chip-ify commit mechanism: root-anchor-parse `text` (never the naive
  // `parseTemplate` — a hand-typed vendor placeholder like `{{name}}` must
  // stay literal, see `expression-template.ts`'s `parseRootAnchoredTemplate`),
  // set it as the new `parts`, and bump `paintGen` so the `useLayoutEffect`
  // above repaints. `restoreFocus` is `false` from `onBlur` (the editor has
  // already lost focus; forcing it back would yank focus out of Save/Cancel —
  // caret position is moot there) and `true` for a caller that wants the
  // caret restored into the chips editor after the repaint.
  const adoptText = (text: string, { restoreFocus }: { restoreFocus: boolean }) => {
    setParts(parseRootAnchoredTemplate(text));
    if (restoreFocus) focusChipsAfterPaint.current = true;
    setPaintGen((g) => g + 1);
  };

  const save = () => {
    const el = editorRef.current;
    onSave(partsToValue(el ? readParts(el) : parts));
    onClose();
  };

  // Close the nested "+ Add" dialog and return focus + caret to the chips
  // editor. `Modal.tsx` never calls `el.close()` on unmount, so React would
  // otherwise leave a still-`open` `<dialog>` for the browser to tear down and
  // restore focus to `<body>` — the author loses their insertion point right
  // when they come back to insert the value they just created. Reuse the same
  // programmatic-repaint mechanism `exitTemplate` used for the same problem.
  const closeAdding = () => {
    setAdding(null);
    focusChipsAfterPaint.current = true;
    setPaintGen((g) => g + 1);
  };

  const vars = options.vars ?? [];
  const secrets = options.secrets ?? [];
  const inputs = options.inputs ?? [];
  const documents = options.documents ?? [];
  const steps = options.steps ?? [];
  const hasState = steps.length > 0 || !!options.hasTrigger;
  const template = serializeTemplate(parts);

  // The sample map the Result pane previews against: host-seeded defaults
  // (real project vars/documents, keyed by full ref) overlaid by anything the
  // author typed into the Sample values box, which takes precedence. Non-string
  // seeds are stringified for the text preview.
  const effectiveSamples = useMemo(() => {
    const seeded: Record<string, string> = {};
    for (const [ref, v] of Object.entries(options.sampleValues ?? {})) {
      seeded[ref] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return { ...seeded, ...samples };
  }, [options.sampleValues, samples]);

  // The distinct var/render refs the current expression reads (first-seen
  // order) — the in-scope roots the author can supply sample values for. A
  // `render` part reads through the same sample lookup as `var` (A4c), so its
  // ref belongs here too — otherwise the Sample-values box never offers a row
  // for it and the Result pane's first click on the new insert-render action
  // reads as broken (blank output).
  const usedRefs = useMemo(() => {
    const seen = new Set<string>();
    const refs: string[] = [];
    for (const p of parts) {
      if ((p.kind === "var" || p.kind === "render") && p.ref && !seen.has(p.ref)) {
        seen.add(p.ref);
        refs.push(p.ref);
      }
    }
    return refs;
  }, [parts]);

  // Best-effort client-side preview of the expression against the sample values.
  // TODO(HITL-2): `@w6w/expr` is a Deno/JSR package that isn't resolvable in the
  // ui Node/pnpm toolchain (not a dependency here), so inline JSONLogic (`expr`
  // parts) can't be evaluated client-side — we fall back to rendering the
  // resolved `{{ }}` template: substitute sample values for var refs, mask
  // secrets, and keep the `{{ … }}` form for anything we can't resolve. Never
  // throws on an un-evaluable expression.
  const result = useMemo(() => {
    try {
      return renderResult(parts, effectiveSamples);
    } catch {
      // Last-resort fallback — the pane must never throw.
      return template;
    }
  }, [parts, effectiveSamples, template]);

  const source = (label: string, part: ExprPart, cls: string, sigil: string) => (
    <button
      key={`${part.kind}:${part.ref ?? label}`}
      type="button"
      className={`w6w-exprmodal-source ${cls}`}
      title={`Insert ${label}`}
      onClick={() => insertPart(part)}
    >
      <span className="w6w-expr-chip-sigil">{sigil}</span>
      <span className="w6w-exprmodal-source-label">{label}</span>
    </button>
  );

  return (
    <Modal
      title="Edit expression"
      subtitle={fieldLabel ? <code>{fieldLabel}</code> : undefined}
      onClose={onClose}
      size="full"
      headerRight={
        <div className="w6w-exprmodal-actions">
          {/* Take the field back OUT of expression mode. It saves the `{{ }}`
              TEXT form, so the content survives exactly as the old expr→text
              toggle made it — a lone text part collapses to a plain string in
              `partsToValue`, so the field renders its plain widget again.
              Hidden when `masked`: a sealed secret has no text form. */}
          {!masked && (
            <button
              type="button"
              className="w6w-btn w6w-btn-ghost"
              disabled={hasRenderPart}
              title={
                hasRenderPart
                  ? "Unavailable — a render part has no plain-text form. Flip it back to a variable first."
                  : "Close the expression and keep the text as a literal value"
              }
              onClick={() => {
                onSave(serializeTemplate(parts));
                onClose();
              }}
            >
              Use a plain value
            </button>
          )}
          <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="w6w-btn" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="w6w-exprmodal">
        {/* Left: the data sources in scope. */}
        <aside className="w6w-exprmodal-sources">
          <div className="w6w-exprmodal-group">
            <div className="w6w-field-labelrow">
              <span className="w6w-exprmodal-group-label">Variables</span>
              {options.createVar && (
                <button
                  type="button"
                  className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                  data-testid="expr-add-var"
                  onClick={() => setAdding("var")}
                >
                  + Add
                </button>
              )}
            </div>
            {vars.length === 0 && <span className="w6w-expr-menu-empty">No variables</span>}
            {vars.map((v) =>
              source(v, { kind: "var", ref: `vars.${v}` }, "w6w-expr-chip-var", "◆"),
            )}
          </div>

          <div className="w6w-exprmodal-group">
            <div className="w6w-field-labelrow">
              <span className="w6w-exprmodal-group-label">Secrets</span>
              {options.createSecret && (
                <button
                  type="button"
                  className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                  data-testid="expr-add-secret"
                  onClick={() => setAdding("secret")}
                >
                  + Add
                </button>
              )}
            </div>
            {secrets.length === 0 && <span className="w6w-expr-menu-empty">No secrets</span>}
            {secrets.map((s) =>
              source(s, { kind: "secret", ref: s }, "w6w-expr-chip-secret", "🔒"),
            )}
          </div>

          <div className="w6w-exprmodal-group">
            <span className="w6w-exprmodal-group-label">Inputs</span>
            {inputs.length === 0 && <span className="w6w-expr-menu-empty">No inputs</span>}
            {inputs.map((i) =>
              source(i, { kind: "var", ref: `inputs.${i}` }, "w6w-expr-chip-var", "⇥"),
            )}
          </div>

          <div className="w6w-exprmodal-group">
            <span className="w6w-exprmodal-group-label">Documents</span>
            {documents.length === 0 && <span className="w6w-expr-menu-empty">No documents</span>}
            {documents.map((d) => {
              // Same guard, same single render site, as the steps block above:
              // enumerated raw at the source (studio's `document-sources.ts`),
              // filtered exactly once, here, where the ref is built (A3, A4a).
              const fields = (d.fields ?? []).filter((f) => isRefSafeKey(f.key));
              return (
                <Fragment key={d.key}>
                  {/* The whole document — unconditional, for every format,
                      exactly as before (A2). */}
                  {source(
                    d.key,
                    { kind: "var", ref: `documents.${d.key}` },
                    "w6w-expr-chip-var",
                    "▦",
                  )}
                  {/* …and one source per surviving top-level field, nested
                      under it. The label is the field key itself — the parent
                      row above already shows `d.key` — never `varLabel(ref)`,
                      which would spell out the whole dotted ref again. Each
                      row additionally carries a SECOND, visible action (D-P1)
                      that inserts the SAME ref as a `render` part, so the
                      placeholder-substitution behaviour is discoverable at the
                      moment of insertion — not only via the chip's own
                      post-insertion ⇄ toggle. */}
                  {fields.length > 0 && (
                    <div className="w6w-exprmodal-subsources">
                      {fields.map((f) => {
                        const ref = `documents.${d.key}.${f.key}`;
                        return (
                          <div key={ref} className="w6w-exprmodal-subsource-row">
                            {source(f.key, { kind: "var", ref }, "w6w-expr-chip-var", "·")}
                            <button
                              type="button"
                              className="w6w-exprmodal-render-btn"
                              data-testid="expr-insert-render"
                              title={`Insert ${ref} and render its {{ }} placeholders`}
                              aria-label={`Insert ${ref} and render its {{ }} placeholders`}
                              onClick={() => insertPart({ kind: "render", ref })}
                            >
                              ▤
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

          {hasState && (
            <div className="w6w-exprmodal-group">
              <span className="w6w-exprmodal-group-label">Workflow state</span>
              {options.hasTrigger &&
                source(
                  "trigger.event",
                  { kind: "var", ref: "trigger.event" },
                  "w6w-expr-chip-var",
                  "⚡",
                )}
              {steps.map((st) => {
                // Only keys that can become a ref the ENGINE resolves are
                // offered. The guard lives here, at the one place a ref is
                // built, so it holds for any host that supplies `steps` —
                // not only for the flow editor's own projection.
                const fields = (st.outputs ?? []).filter((o) => isRefSafeKey(o.key));
                return (
                  <Fragment key={st.id}>
                    {/* The whole output — still a real, useful ref on its own,
                        and the author's route to a key the guard dropped. */}
                    {source(
                      st.label ?? st.id,
                      { kind: "var", ref: `steps.${st.id}.output` },
                      "w6w-expr-chip-var",
                      "▸",
                    )}
                    {/* …and one source per DECLARED output field, nested under
                        it. Each SAVES the canonical `steps.<id>.output.<key>`
                        (the only form the engine resolves) and SHOWS
                        `varLabel(ref)`, i.e. the short `<id>.<key>`. The key
                        goes into the ref VERBATIM — `o.label` is display data
                        and must never be substituted into a ref. */}
                    {fields.length > 0 && (
                      <div className="w6w-exprmodal-subsources">
                        {fields.map((o) => {
                          const ref = `steps.${st.id}.output.${o.key}`;
                          return source(
                            varLabel(ref),
                            { kind: "var", ref },
                            "w6w-expr-chip-var",
                            "·",
                          );
                        })}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </aside>

        {/* Right: editor over the saved {{ }} template. */}
        <div className="w6w-exprmodal-main">
          <div className="w6w-exprmodal-editor">
            <span className="w6w-exprmodal-pane-label">
              Expression
              <span className="w6w-muted w6w-small"> — click a source on the left, or type</span>
            </span>
            <div
              ref={editorRef}
              className={`w6w-exprmodal-chips${masked ? " is-masked" : ""}${
                parts.length === 0 ? " is-empty" : ""
              }`}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              aria-multiline={multiline ? "true" : "false"}
              aria-label="Expression"
              data-placeholder="Type text and insert {x} variables, 🔒 secrets, or ▸ step outputs…"
              spellCheck={false}
              onInput={() => {
                // D-3: promote a just-closed `{{ … }}` marker to a chip AT
                // THE KEYSTROKE THAT CLOSES IT — caret-safe surgery on the
                // matched span only (see `promoteCompletedMarkerAtCaret`'s
                // own docstring). `sync()` unconditionally afterwards either
                // way: promoted or not, the DOM is the source of truth.
                // NEVER bump `paintGen` here — see the warning at the top of
                // this file and `G-typing` in `expr-template-guards.test.cjs`.
                const el = editorRef.current;
                if (el) promoteCompletedMarkerAtCaret(el, { renderToggle: true });
                sync();
              }}
              onDoubleClick={(e) => {
                // D-3, the reverse direction: double-click a chip back to its
                // editable `{{ … }}` text, in place. Mirrors the onClick
                // delegate's short-circuit order just below — data-x, then
                // data-render-toggle — so a precise double-click on either
                // still wins (in practice the FIRST of the two clicks that
                // make up a dblclick already removes/flips the chip via
                // onClick, so by the time this fires there is no
                // `.w6w-expr-chip` left to find; these checks are the
                // explicit guard for that intent).
                const target = e.target as HTMLElement;
                if (target.closest("[data-x]")) return;
                if (target.closest("[data-render-toggle]")) return;
                const chip = target.closest(".w6w-expr-chip") as HTMLElement | null;
                if (!chip) return;
                e.preventDefault();
                const node = chipToText(chip);
                if (node) {
                  const doc = node.ownerDocument;
                  const after = doc.createRange();
                  after.setStartAfter(node);
                  after.collapse(true);
                  const sel = doc.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(after);
                }
                sync();
              }}
              onBlur={() => {
                // Discrete-event chip-ify commit #1: the editor just lost
                // focus, so any hand-typed `{{ … }}` left as raw text gets
                // one chance to become a chip. NEVER do this from `onInput`
                // above — see the `paintGen` warning at the top of this file
                // and G-typing in `expr-template-guards.test.cjs`.
                const el = editorRef.current;
                if (!el) return;
                adoptText(serializeTemplate(readParts(el)), { restoreFocus: false });
              }}
              onPaste={(e) => {
                // Discrete-event chip-ify commit #2. `insertNodeAtCaret` is
                // the SAME mechanism a rail click uses, so the caret is
                // preserved by construction — no bespoke caret-offset repaint
                // needed (out of scope by contract). No `setPaintGen`: each
                // part is inserted directly into the live DOM, exactly like a
                // rail insertion, so the existing chips are never re-painted.
                e.preventDefault();
                const el = editorRef.current;
                if (!el) return;
                const text = e.clipboardData?.getData("text/plain") ?? "";
                for (const part of parseRootAnchoredTemplate(text)) {
                  if (part.kind === "text") {
                    insertNodeAtCaret(el, el.ownerDocument.createTextNode(part.value ?? ""));
                  } else {
                    insertNodeAtCaret(el, makeChip(el.ownerDocument, part, { renderToggle: true }));
                  }
                }
                sync();
              }}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                const x = target.closest("[data-x]");
                if (x) {
                  e.preventDefault();
                  x.closest(".w6w-expr-chip")?.remove();
                  sync();
                  return;
                }
                // The render affordance: flip a var⇄render chip IN PLACE. The
                // ref never changes — only `data-kind` (via a rebuilt chip
                // from the same `data-ref`, `makeChip`'s only construction
                // path) — and this does NOT bump `paintGen`, exactly like the
                // remove control above.
                const toggle = target.closest("[data-render-toggle]");
                if (toggle) {
                  e.preventDefault();
                  const chip = toggle.closest(".w6w-expr-chip") as HTMLElement | null;
                  if (chip) {
                    const ref = chip.getAttribute("data-ref") ?? "";
                    const nextKind = chip.getAttribute("data-kind") === "render" ? "var" : "render";
                    chip.replaceWith(
                      makeChip(chip.ownerDocument, { kind: nextKind, ref }, { renderToggle: true }),
                    );
                  }
                  sync();
                }
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // ALWAYS suppressed — with or without Shift, multiline or not.
                // The browser's own line break (a wrapper <div>, or a <br>) is
                // markup we neither paint nor want to depend on.
                e.preventDefault();
                if (!multiline) return;
                const el = editorRef.current;
                if (!el) return;
                // Our own literal "\n" text node, via the same caret helper the
                // source picker inserts chips with. `.w6w-exprmodal-chips` is
                // `pre-wrap`, so it renders as a break. The filler keeps a break
                // at the very END visible (and is skipped by `readParts`, so it
                // never reaches the value).
                insertNodeAtCaret(el, el.ownerDocument.createTextNode("\n"));
                ensureFillerBreak(el);
                sync();
              }}
            />
          </div>
          {usedRefs.length > 0 && (
            <div className="w6w-exprmodal-preview">
              <span className="w6w-exprmodal-pane-label">
                Sample values
                <span className="w6w-muted w6w-small">
                  {" "}
                  — try the expression against example data
                </span>
              </span>
              {usedRefs.map((ref) => (
                <label key={ref} className="w6w-field">
                  <span>{ref}</span>
                  <input
                    type="text"
                    value={samples[ref] ?? ""}
                    placeholder="sample value"
                    onChange={(e) => setSamples((s) => ({ ...s, [ref]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="w6w-exprmodal-preview w6w-exprmodal-result-pane">
            <span className="w6w-exprmodal-pane-label">
              Result
              <span className="w6w-muted w6w-small"> — live preview against the sample values</span>
            </span>
            <pre className="w6w-exprmodal-result">{result || " "}</pre>
          </div>
        </div>
      </div>

      {/* Nested "+ Add" dialog — last child of this Modal, so its own
          <dialog> stacks over this one in the browser's top layer
          (structurally identical to StepBuilderModal's AddConnectionModal
          nesting). Gated the same way the rail button was, so state can
          never point at a store the host didn't wire a callback for. */}
      {adding === "var" && options.createVar && (
        <AddValueModal kind="var" onCreate={options.createVar} onClose={closeAdding} />
      )}
      {adding === "secret" && options.createSecret && (
        <AddValueModal kind="secret" onCreate={options.createSecret} onClose={closeAdding} />
      )}
    </Modal>
  );
}

interface AddValueModalProps {
  kind: "var" | "secret";
  onCreate: (input: { name: string; value: string; description?: string }) => Promise<void>;
  onClose: () => void;
}

/**
 * The nested "+ Add" form. Same shape as `AddConnectionModal`'s
 * `ConnectionConfig` — `w6w-stack` body, one `w6w-field` label per input, an
 * inline `w6w-result w6w-error` block, ghost-Cancel + primary footer — but it
 * never fetches: `onCreate` (the host's `ExpressionOptions.createVar` /
 * `.createSecret`) is the only IO, so this mounts fine with no
 * `<W6WUIProvider>` around it (see `ExpressionEditorModal`'s own module
 * contract). A rejection leaves the dialog open with the message shown, name
 * hint copy matches studio's Vars/Vault pages.
 */
function AddValueModal({ kind, onCreate, onClose }: AddValueModalProps) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const noun = kind === "var" ? "variable" : "secret";

  async function submit() {
    setError(null);
    setPending(true);
    try {
      await onCreate({ name, value, description: description || undefined });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title={`Add ${noun}`} onClose={onClose}>
      <div className="w6w-stack">
        <label className="w6w-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "var" ? "e.g. api_base_url" : "e.g. openai_api_key"}
            autoComplete="off"
            data-testid="expr-add-value-name"
            // biome-ignore lint/a11y/noAutofocus: nested dialog opened on demand — showModal() already moved focus in, this just picks the first field.
            autoFocus
          />
          <span className="w6w-muted w6w-small">
            Lowercase letters, digits, and underscores. Must start with a letter or underscore.
          </span>
        </label>

        <label className="w6w-field">
          <span>Value</span>
          <input
            type={kind === "secret" ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            data-testid="expr-add-value-value"
          />
          {kind === "secret" && (
            <span className="w6w-muted w6w-small">
              Stored encrypted at rest. Once saved, it is not readable through the UI.
            </span>
          )}
        </label>

        <label className="w6w-field">
          <span>Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            autoComplete="off"
          />
        </label>

        {error && <div className="w6w-result w6w-error">{error}</div>}

        <div className="w6w-modal-actions">
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost"
            data-testid="expr-add-value-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="w6w-btn"
            data-testid="expr-add-value-save"
            disabled={!name || !value || pending}
            onClick={submit}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
