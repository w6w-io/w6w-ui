import type { EditorView } from "@codemirror/view";
import { Fragment, type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { JsonEditor } from "../JsonEditor.tsx";
import { isInternalApp } from "../flow-types.ts";
import { buildResolveScope } from "../resolve-params.ts";
import { resolveParamJson } from "../resolved-json.ts";
import type { ExprPart, ExprValue, SecretValue } from "../types.ts";
import { Copyable } from "./Copyable.tsx";
import type { ExpressionOptions, ExpressionStepSource } from "./ExpressionOptions.tsx";
import { IconButton } from "./IconButton.tsx";
import { Modal } from "./Modal.tsx";
import {
  authoredReferences,
  compileAuthoredParts,
  previewAuthoredParts,
} from "./expression-authoring.ts";
import {
  chipToText,
  ensureFillerBreak,
  insertNodeAtCaret,
  isRefSafeKey,
  isRefSafePath,
  makeChip,
  outputFieldTree,
  paintParts,
  placeCaretAtEnd,
  promoteCompletedMarkerAtCaret,
  readParts,
  varLabel,
} from "./expression-dom.ts";
import {
  parseRootAnchoredTemplate,
  partsToValue,
  serializeTemplate,
  valueToParts,
} from "./expression-template.ts";
import { addRefToDraft, resolveComposed, sampleStepsState, wholeValueRef } from "./json-compose.ts";

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
  /** Expression mode's commit. Not used in `mode="json-binding"` (see `onSaveJson`). */
  onSave?: (next: ExprValue | string) => void;
  onClose: () => void;
  /**
   * `"json-binding"`: the value of a whole `json`/`group` param, composed as JSON. The rail
   * shows Previous steps (each step's "Entire output", its fields and, for an app step, its
   * Metadata), Inputs and Variables — no Secrets or Documents. A click on a source into an empty
   * draft (or one holding only a reference) binds it: `onSaveJson("{{ ref }}")` and close. Into a
   * draft being composed it ADDS the reference (`addRefToDraft`, `json-compose.ts`): at the caret
   * where a value or property fits, else as a new property/element at the end — never replacing
   * the draft. Save calls `onSaveJson` with the parsed JSON.
   * Absent ⇒ expression mode, unchanged.
   */
  mode?: "json-binding";
  /** json-binding mode: the field's current value, seeding the compose pane. */
  jsonValue?: unknown;
  /** json-binding mode: Save from the compose pane, with the parsed JSON. */
  onSaveJson?: (next: unknown) => void;
  /**
   * json-binding mode only: the field takes one whole value (`ActionParam.whole`). A source click
   * into an empty draft, or one parsing to exactly `[]` / `{}`, binds the bare ref. Any other
   * draft composes as usual.
   */
  whole?: boolean;
  /**
   * json-binding mode only: a workflow's starting state (`Workflow.initialState`), evaluated once
   * at run start. The rail has no Previous steps or State section (the state is blank then) and
   * no Secrets (a secret never enters state), but does list Documents. A toggle above it picks
   * what a source click inserts: its reference (default), or its current sample value as a
   * literal. A click always composes into the object, never binds the whole field. An empty
   * draft saves `undefined`; Save is refused while `jsonProblem` names a problem.
   */
  startingState?: boolean;
  /** Starting-state mode: why the draft text cannot be saved (`null` when it can). */
  jsonProblem?: (text: string) => string | null;
  /** The modal's title, in place of "Edit JSON value" / "Edit expression". */
  title?: string;
}

export function ExpressionEditorModal({
  value,
  masked,
  multiline,
  options,
  fieldLabel,
  onSave,
  onClose,
  mode,
  jsonValue,
  onSaveJson,
  whole: wholeField,
  startingState: startingStateProp,
  jsonProblem,
  title,
}: ExpressionEditorModalProps) {
  const jsonBinding = mode === "json-binding";
  const seedMode = jsonBinding && startingStateProp === true;
  // Starting-state mode: what a source click inserts — the reference, or its value now.
  const [insertAs, setInsertAs] = useState<"ref" | "value">("ref");
  // json-binding mode's compose pane: the draft text, whether it parses, and the CodeMirror
  // view (for inserting at the caret).
  const [jsonText, setJsonText] = useState(() =>
    jsonValue === undefined ? "" : JSON.stringify(jsonValue, null, 2),
  );
  const jsonView = useRef<EditorView | null>(null);
  // Whether the author has worked in the JSON pane (focused it, so a caret is theirs). Until
  // then a source click REPLACES the draft — the seeded value's caret is just position 0, and
  // re-picking a bound field's reference is one click; after it, a click inserts at the caret.
  const jsonTouched = useRef(false);
  const jsonParsed = useMemo((): { ok: true; value: unknown } | { ok: false } => {
    if (jsonText.trim() === "") return { ok: false };
    try {
      return { ok: true, value: JSON.parse(jsonText) };
    } catch {
      return { ok: false };
    }
  }, [jsonText]);
  const seedProblem = seedMode ? (jsonProblem?.(jsonText) ?? null) : null;
  const canSaveJson = seedMode
    ? (jsonText.trim() === "" || jsonParsed.ok) && seedProblem === null
    : jsonParsed.ok;
  const sampleScope = () =>
    buildResolveScope(
      options.sampleValues,
      sampleStepsState(options.sampleValues),
      options.nodeConfig,
      options.nodeMeta,
    );
  const insertJsonRef = (ref: string) => {
    const view = jsonView.current;
    const doc = view ? view.state.doc.toString() : jsonText;
    if (seedMode) {
      // The starting state is an object: a click adds a key, never binds the whole field. As a
      // value, the source's current sample is copied in and no longer follows the source.
      const literal =
        insertAs === "value"
          ? { value: resolveParamJson(`{{ ${ref} }}`, sampleScope()) ?? null }
          : undefined;
      const base = doc.trim() === "" ? "{}" : doc;
      const pos = jsonTouched.current && view ? view.state.selection.main.head : base.length;
      const next = addRefToDraft(base, pos, ref, literal);
      if (!view) {
        setJsonText(next.text);
        return;
      }
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: next.text },
        selection: { anchor: next.caret },
      });
      view.focus();
      return;
    }
    // An empty draft — or one that is only a reference (a bound field being re-picked) — is a
    // binding: the click saves that reference and closes, as a click does in expression mode.
    let whole: string | null = null;
    try {
      whole = doc.trim() === "" ? null : wholeValueRef(JSON.parse(doc));
    } catch {
      whole = null;
    }
    let emptyContainer = false;
    if (wholeField) {
      try {
        const parsed: unknown = JSON.parse(doc);
        emptyContainer = Array.isArray(parsed)
          ? parsed.length === 0
          : typeof parsed === "object" && parsed !== null && Object.keys(parsed).length === 0;
      } catch {
        emptyContainer = false;
      }
    }
    if (doc.trim() === "" || whole !== null || emptyContainer) {
      onSaveJson?.(`{{ ${ref} }}`);
      onClose();
      return;
    }
    if (!view) return;
    // Otherwise the author is composing: ADD the reference, never replace their JSON.
    const pos = jsonTouched.current ? view.state.selection.main.head : doc.length;
    const next = addRefToDraft(doc, pos, ref);
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: next.text },
      selection: { anchor: next.caret },
    });
    view.focus();
  };
  const [parts, setParts] = useState<ExprPart[]>(
    () => compileAuthoredParts(valueToParts(value).parts, options).parts,
  );
  const authored = useMemo(() => compileAuthoredParts(parts, options), [parts, options]);
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
  // Rail sources with surviving child rows (a multi-field document, a step
  // with declared outputs) collapse by default — ONE mechanism, composite
  // keys ("doc:<key>" / "step:<id>"), serving both loops below.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // The rail's sections are an accordion: at most one open at a time. "auto" until the author
  // picks one — then the default (Previous steps, else the first section present) applies.
  const [openPick, setOpenPick] = useState<RailSectionKey | null | "auto">("auto");

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

  // A render part can be authored two ways: flipping an EXISTING var chip
  // (below), or inserting one directly via a document field's "insert as
  // render" action (the Documents group's field sub-source loop, below) — so
  // this is derived from `parts` on every render, not computed once at mount:
  // either path must disable the control below immediately, and flipping the
  // toggled chip back must re-enable it.
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
    setParts(compileAuthoredParts(parseRootAnchoredTemplate(text), options).parts);
    if (restoreFocus) focusChipsAfterPaint.current = true;
    setPaintGen((g) => g + 1);
  };

  const save = () => {
    const el = editorRef.current;
    const next = compileAuthoredParts(el ? readParts(el) : parts, options);
    if (next.error) return;
    onSave?.(partsToValue(next.parts));
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
  const constants = options.constants ?? [];
  const secrets = options.secrets ?? [];
  const inputs = options.inputs ?? [];
  const documents = options.documents ?? [];
  const steps = options.steps ?? [];
  const nodeConfigs = options.nodeConfigs ?? [];
  const loop = options.loop;
  // Every node's literal settings, offered inside its Metadata disclosure as
  // `config` (`nodes.<id>.meta.config.<key>`). A node that is not upstream still
  // gets a row, so its settings stay reachable.
  const configKeys = new Map(
    nodeConfigs
      .map((n) => [n.id, n.keys.filter(isRefSafeKey)] as const)
      .filter(([, keys]) => keys.length > 0),
  );
  // A node's Metadata leaves: the four app fields for an external app step (R-7), plus whichever
  // other static meta its node carries (a webhook trigger's subscription id and URL) — never a
  // key the node does not have, so a `@w6w/webhook` node offers no connection id.
  const nodeMeta = options.nodeMeta ?? {};
  const metaLeavesOf = (id: string) =>
    META_LEAVES.filter(([key]) =>
      APP_META_KEYS.has(key) ? isExternalAppNode(id) : Object.hasOwn(nodeMeta[id] ?? {}, key),
    );
  // An external app is an upstream step flagged `hasMeta` (R-7), or a node whose static meta
  // names an app that is not built in (a node that is not upstream has no `hasMeta`).
  const upstreamAppIds = steps.filter((st) => st.hasMeta === true).map((st) => st.id);
  const isExternalAppNode = (id: string) => {
    if (upstreamAppIds.includes(id)) return true;
    const app = nodeMeta[id]?.app;
    return typeof app === "string" && !isInternalApp(app);
  };
  const metaSources = (id: string) =>
    metaLeavesOf(id).map(([key, label]) =>
      source(label, { kind: "var", ref: `nodes.${id}.meta.${key}` }, "w6w-expr-chip-var", "·"),
    );
  // Previous steps is only what this node can read at run time — its upstream `steps`, its
  // trigger's event, its loop's item. Every node's static meta, other paths included, sits in
  // the separate Metadata section, keyed in node order (`nodeMeta`, then upstream app steps the
  // host gave no static meta for, then config-only nodes) — the one place a node's meta is offered.
  const metaIds = [...new Set([...Object.keys(nodeMeta), ...upstreamAppIds, ...configKeys.keys()])];
  const hasWorkflowState = steps.length > 0 || !!options.hasTrigger;
  const hasState = !seedMode && (hasWorkflowState || !!loop);
  // The merged workflow STATE (`state.<path>`, `state-shape.ts`): its own section, present only
  // when something is in it, so every other section keeps its place.
  const stateFields = seedMode
    ? []
    : (options.stateShape?.fields ?? []).filter((f) => isRefSafePath(f.key));
  const sections: RailSectionKey[] = [
    ...(hasState ? (["state"] as const) : []),
    ...(stateFields.length > 0 ? (["runstate"] as const) : []),
    ...(metaIds.length > 0 ? (["meta"] as const) : []),
    ...(options.inputs !== undefined ? (["inputs"] as const) : []),
    "vars",
    ...(constants.length > 0 ? (["consts"] as const) : []),
    ...(!jsonBinding || seedMode ? (["docs"] as const) : []),
    ...(!jsonBinding ? (["secrets"] as const) : []),
  ];
  const openSection =
    openPick === "auto" || (openPick !== null && !sections.includes(openPick))
      ? (sections.find((k) => k !== "meta") ?? null)
      : openPick;
  // Opening a section closes the open one; clicking the open one collapses it.
  const sectionProps = (key: RailSectionKey) => ({
    open: openSection === key,
    onToggle: () => setOpenPick(openSection === key ? null : key),
  });
  const loopFields = (loop?.itemOutputs ?? []).filter((o) =>
    o.path ? isRefSafePath(o.key) : isRefSafeKey(o.key),
  );
  const eventFields = (options.eventOutputs ?? []).filter((o) =>
    o.path ? isRefSafePath(o.key) : isRefSafeKey(o.key),
  );
  const template = serializeTemplate(authored.parts);

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
  const usedRefs = useMemo(() => authoredReferences(authored.parts), [authored.parts]);

  // Comparisons use the same JSONLogic evaluator as execution, with typed samples.
  const result = useMemo(() => {
    if (authored.error) return "";
    try {
      return previewAuthoredParts(authored.parts, options.sampleValues, samples);
    } catch {
      // Last-resort fallback — the pane must never throw.
      return template;
    }
  }, [authored, options.sampleValues, samples, template]);

  // Which non-fresh tiers the Result's substituted values came from (a value the author typed
  // into the Sample values box overrides the tier and is not noted).
  const resultNotes = useMemo(() => {
    const notes = new Set<string>();
    for (const ref of usedRefs) {
      if (samples[ref] !== undefined) continue;
      const tier = options.valueSources?.[ref];
      if (tier === "sample") notes.add("example from the app");
      else if (tier === "persisted") notes.add("from last test");
    }
    return [...notes];
  }, [usedRefs, samples, options.valueSources]);

  // `sigil: null` drops the glyph — a step row with fields renders its own
  // disclosure caret in that spot instead (see the Previous steps loop).
  //
  // Every source inserts and keeps the editor open so authors can append a comparison.
  const source = (
    label: string,
    part: ExprPart,
    cls: string,
    sigil: string | null,
    _composite = false,
    ariaLabel?: string,
    // `name` replaces `label` in the tooltip (a tree row shows a short label but
    // names its full ref on hover); `depth` indents a tree row.
    tree?: { name: string; depth: number; declaredOnly?: boolean; somePaths?: boolean },
  ) => (
    <div
      key={`${part.kind}:${part.ref ?? label}`}
      className="w6w-exprmodal-item"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        ...(tree && tree.depth > 0 ? { paddingLeft: tree.depth * 14 } : {}),
      }}
    >
      <button
        type="button"
        className={`w6w-exprmodal-source ${cls}${tree?.declaredOnly ? " is-declared-only" : ""}`}
        style={{ flex: 1, minWidth: 0, ...(tree?.declaredOnly ? { opacity: 0.6 } : {}) }}
        title={`Insert ${tree?.name ?? label}`}
        aria-label={ariaLabel}
        onClick={() =>
          jsonBinding ? part.kind === "var" && insertJsonRef(part.ref ?? "") : insertPart(part)
        }
      >
        {sigil !== null && <span className="w6w-expr-chip-sigil">{sigil}</span>}
        <span className="w6w-exprmodal-source-label">{label}</span>
        {tree?.declaredOnly && (
          <span
            className="w6w-muted w6w-small"
            data-testid="expr-declared-only"
            style={{ marginLeft: 6 }}
          >
            declared by the app
          </span>
        )}
        {tree?.somePaths && (
          <span
            className="w6w-muted w6w-small"
            data-testid="expr-state-some-paths"
            title="Set on some paths into this step, not all"
            style={{ marginLeft: 6 }}
          >
            some paths
          </span>
        )}
      </button>
      {!jsonBinding && (
        <IconButton
          icon="copy"
          iconSize={14}
          label="Copy to expression editor"
          data-testid="expr-copy-to-editor"
          onClick={() => insertPart(part)}
        />
      )}
    </div>
  );

  const loopOpen = expanded.has("loop:item");
  const currentItemBtn = source(
    "Current item",
    { kind: "var", ref: "foreach.item" },
    "w6w-expr-chip-var",
    "↻",
  );

  // Metadata's `config` entry: the node's static settings, collapsed until its
  // own toggle opens, each saving `nodes.<id>.meta.config.<key>`.
  const configEntry = (id: string, keys: string[]) => {
    if (keys.length === 0) return null;
    const open = expanded.has(`mcfg:${id}`);
    return (
      <>
        <div className="w6w-exprmodal-source-row">
          <button
            type="button"
            className="w6w-exprmodal-toggle-btn"
            data-testid="expr-config-toggle"
            aria-expanded={open}
            title={open ? "Hide config" : "Show config"}
            onClick={() => toggleExpanded(`mcfg:${id}`)}
          >
            config {open ? "⌄" : "›"}
          </button>
        </div>
        {open && (
          <div className="w6w-exprmodal-subsources" data-testid="expr-config-fields">
            {keys.map((k) =>
              source(
                k,
                { kind: "var", ref: `nodes.${id}.meta.config.${k}` },
                "w6w-expr-chip-var",
                "·",
              ),
            )}
          </div>
        )}
      </>
    );
  };

  // A step's output fields as a tree of plain rows, each showing only its own
  // name (`outputFieldTree`). Each SAVES the canonical `nodes.<id>.output.<key>`
  // (the only form the engine resolves) — the key goes into the ref VERBATIM;
  // the short name and `o.label` are display data and never reach a ref.
  const fieldSources = (
    stepId: string,
    fields: { key: string; path?: boolean; declaredOnly?: true }[],
    rootRef = `nodes.${stepId}.output`,
  ) =>
    outputFieldTree(fields).map(({ field, depth, name }) => {
      const ref = `${rootRef}.${field.key}`;
      return source(name, { kind: "var", ref }, "w6w-exprmodal-field", null, false, undefined, {
        name: varLabel(ref),
        depth,
        declaredOnly: field.declaredOnly === true,
      });
    });

  // The step-level note on where a step's (or the trigger event's) fields came from. A test
  // shape (fresh or persisted) keeps the "from the last test" note; an app's own declaration
  // or sample says so.
  const shapeHint = (from: ExpressionStepSource["outputsFrom"]) => {
    if (from === "fresh" || from === "persisted") {
      return (
        <span className="w6w-exprmodal-shape-note" data-testid="expr-fields-from-test">
          {from === "fresh" ? "Fields from the last test run" : "Fields from last test"}
        </span>
      );
    }
    if (from === "declared" || from === "sample") {
      return (
        <span className="w6w-exprmodal-shape-note" data-testid={`expr-fields-from-${from}`}>
          {from === "declared" ? "declared by the app" : "example from the app"}
        </span>
      );
    }
    return null;
  };

  // A Metadata-section node: its id inserts the whole `nodes.<id>.meta`; the caret beside it
  // opens its leaves and its `config`, collapsed by default (`mnode:<id>`).
  const metaNode = (id: string) => {
    const key = `mnode:${id}`;
    const open = expanded.has(key);
    return (
      <Fragment key={key}>
        <div className="w6w-exprmodal-source-row" data-testid="expr-metadata-node">
          <button
            type="button"
            className="w6w-exprmodal-caret-btn"
            data-testid="expr-metadata-node-toggle"
            aria-expanded={open}
            aria-label={open ? `Hide ${id} metadata` : `Show ${id} metadata`}
            title={open ? "Hide metadata" : "Show metadata"}
            onClick={() => toggleExpanded(key)}
          >
            {open ? "▾" : "▸"}
          </button>
          {source(id, { kind: "var", ref: `nodes.${id}.meta` }, "w6w-expr-chip-var", null, true)}
        </div>
        {open && (
          <div className="w6w-exprmodal-subsources" data-testid="expr-metadata-fields">
            {metaSources(id)}
            {configEntry(id, configKeys.get(id) ?? [])}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <Modal
      title={title ?? (jsonBinding ? "Edit JSON value" : "Edit expression")}
      subtitle={fieldLabel ? <code>{fieldLabel}</code> : undefined}
      onClose={onClose}
      size="full"
      headerRight={
        jsonBinding ? (
          <div className="w6w-exprmodal-actions">
            <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="w6w-btn"
              data-testid="expr-json-save"
              disabled={!canSaveJson}
              title={
                canSaveJson
                  ? "Save the composed JSON"
                  : (seedProblem ?? "Compose valid JSON to save")
              }
              onClick={() => {
                if (!canSaveJson) return;
                onSaveJson?.(jsonParsed.ok ? jsonParsed.value : undefined);
                onClose();
              }}
            >
              Save
            </button>
          </div>
        ) : (
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
                  onSave?.(serializeTemplate(parts));
                  onClose();
                }}
              >
                Use a plain value
              </button>
            )}
            <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="w6w-btn"
              onClick={save}
              data-testid="expr-save"
              disabled={authored.error !== null}
            >
              Save
            </button>
          </div>
        )
      }
    >
      <div className="w6w-exprmodal">
        {/* Left: the data sources in scope. */}
        <aside className="w6w-exprmodal-sources">
          {/* First slot — context-specific, mutually exclusive in the real
              wiring (a Function supplies `inputs` and never `steps`; the flow
              editor supplies `steps`/`hasTrigger` and never `inputs`). Render
              Previous steps first should a host ever supply both. */}
          {seedMode && (
            <fieldset
              className="w6w-exprmodal-insert-as"
              aria-label="Insert as"
              style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 8 }}
            >
              <span className="w6w-muted w6w-small">Insert as</span>
              {(
                [
                  ["ref", "Reference", "Insert {{ ref }}: resolved when each run starts"],
                  ["value", "Value", "Insert the current value, copied in as it is now"],
                ] as const
              ).map(([key, label, hint]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={insertAs === key}
                  data-testid={`expr-insert-as-${key}`}
                  title={hint}
                  className={`w6w-btn w6w-btn-sm${insertAs === key ? "" : " w6w-btn-ghost"}`}
                  onClick={() => setInsertAs(key)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          )}
          {jsonBinding && !seedMode && !hasState && (
            <span className="w6w-expr-menu-empty">No upstream steps</span>
          )}
          {hasState && (
            <RailSection label="Previous steps" {...sectionProps("state")}>
              {loop && (
                <div className="w6w-exprmodal-subgroup" data-testid="expr-loop-group">
                  <span className="w6w-exprmodal-shape-note">Loop</span>
                  {/* The item's keys nest under "Current item", collapsed behind the
                      same "N fields ›" toggle a Previous steps step uses. */}
                  {loopFields.length > 0 ? (
                    <div className="w6w-exprmodal-source-row">
                      {currentItemBtn}
                      <FieldsToggle
                        count={loopFields.length}
                        open={loopOpen}
                        onToggle={() => toggleExpanded("loop:item")}
                      />
                    </div>
                  ) : (
                    currentItemBtn
                  )}
                  {loopFields.length > 0 && loopOpen && (
                    <div className="w6w-exprmodal-subsources" data-testid="expr-loop-fields">
                      {loopFields.map((o) => {
                        const ref = `foreach.item.${o.key}`;
                        return source(o.key, { kind: "var", ref }, "w6w-expr-chip-var", "·");
                      })}
                    </div>
                  )}
                  {source("Index", { kind: "var", ref: "foreach.index" }, "w6w-expr-chip-var", "#")}
                </div>
              )}
              {options.hasTrigger &&
                (eventFields.length > 0 ? (
                  <>
                    <div className="w6w-exprmodal-source-row">
                      <button
                        type="button"
                        className="w6w-exprmodal-caret-btn"
                        data-testid="expr-caret-event"
                        aria-expanded={expanded.has("event")}
                        aria-label={expanded.has("event") ? "Hide fields" : "Show fields"}
                        title={expanded.has("event") ? "Hide fields" : "Show fields"}
                        onClick={() => toggleExpanded("event")}
                      >
                        {expanded.has("event") ? "▾" : "▸"}
                      </button>
                      {source(
                        "trigger.event",
                        { kind: "var", ref: "trigger.event" },
                        "w6w-expr-chip-var",
                        "⚡",
                        true,
                      )}
                    </div>
                    {expanded.has("event") && (
                      <div className="w6w-exprmodal-subsources" data-testid="expr-event-fields">
                        {shapeHint(options.eventOutputsFrom)}
                        {fieldSources("", eventFields, "trigger.event")}
                      </div>
                    )}
                  </>
                ) : (
                  source(
                    "trigger.event",
                    { kind: "var", ref: "trigger.event" },
                    "w6w-expr-chip-var",
                    "⚡",
                  )
                ))}
              {steps.map((st) => {
                // A node's meta (app, action, connection, config) is offered only in the
                // Metadata section below, never beside its output here.
                // Only keys that can become a ref the ENGINE resolves are
                // offered. The guard lives here, at the one place a ref is
                // built, so it holds for any host that supplies `steps` —
                // not only for the flow editor's own projection.
                const fields = (st.outputs ?? []).filter((o) =>
                  o.path ? isRefSafePath(o.key) : isRefSafeKey(o.key),
                );
                const stepKey = `step:${st.id}`;
                const isOpen = expanded.has(stepKey);
                // The whole output — still a real, useful ref on its own, and
                // the author's route to a key the guard dropped. Its class,
                // label, sigil and inserted ref are unchanged from before.
                //
                // With fields, the `▸` is pulled OUT of the chip into its own
                // disclosure caret: authors read that arrow as "expand", and
                // inside the chip it inserted the whole output instead.
                const wholeBtn = source(
                  st.label ?? st.id,
                  { kind: "var", ref: `nodes.${st.id}.output` },
                  "w6w-expr-chip-var",
                  fields.length > 0 ? null : "▸",
                  fields.length > 0,
                );
                if (jsonBinding) {
                  return (
                    <Fragment key={st.id}>
                      <span className="w6w-exprmodal-shape-note">{st.label ?? st.id}</span>
                      {source(
                        "Entire output",
                        { kind: "var", ref: `nodes.${st.id}.output` },
                        "w6w-expr-chip-var",
                        "▸",
                        false,
                        `Entire output of ${st.label ?? st.id}`,
                      )}
                      {st.needsTest && (
                        <div className="w6w-exprmodal-subsources">
                          <span className="w6w-exprmodal-shape-note" data-testid="expr-needs-test">
                            Run a test of this step to see its fields
                          </span>
                        </div>
                      )}
                      {fields.length > 0 && (
                        <>
                          <div className="w6w-exprmodal-source-row">
                            <button
                              type="button"
                              className="w6w-exprmodal-caret-btn"
                              data-testid="expr-caret-fields"
                              aria-expanded={isOpen}
                              aria-label={isOpen ? "Hide fields" : "Show fields"}
                              title={isOpen ? "Hide fields" : "Show fields"}
                              onClick={() => toggleExpanded(stepKey)}
                            >
                              {isOpen ? "▾" : "▸"}
                            </button>
                            <FieldsToggle
                              count={fields.length}
                              open={isOpen}
                              onToggle={() => toggleExpanded(stepKey)}
                            />
                          </div>
                          {isOpen && (
                            <div className="w6w-exprmodal-subsources">
                              {shapeHint(st.outputsFrom)}
                              {fieldSources(st.id, fields)}
                            </div>
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                }
                return (
                  <Fragment key={st.id}>
                    {fields.length > 0 ? (
                      <div className="w6w-exprmodal-source-row">
                        <button
                          type="button"
                          className="w6w-exprmodal-caret-btn"
                          data-testid="expr-caret-fields"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Hide fields" : "Show fields"}
                          title={isOpen ? "Hide fields" : "Show fields"}
                          onClick={() => toggleExpanded(stepKey)}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                        {wholeBtn}
                        <FieldsToggle
                          count={fields.length}
                          open={isOpen}
                          onToggle={() => toggleExpanded(stepKey)}
                        />
                      </div>
                    ) : (
                      wholeBtn
                    )}
                    {/* An app action that declares no output shape and has
                        never been tested: nothing to offer but the whole
                        output, so say how to get its fields. */}
                    {st.needsTest && (
                      <div className="w6w-exprmodal-subsources">
                        <span className="w6w-exprmodal-shape-note" data-testid="expr-needs-test">
                          Run a test of this step to see its fields
                        </span>
                      </div>
                    )}
                    {/* …and one source per DECLARED output field, nested under
                        it, collapsed until the toggle above is expanded
                        (`fieldSources`). */}
                    {fields.length > 0 && isOpen && (
                      <div className="w6w-exprmodal-subsources">
                        {shapeHint(st.outputsFrom)}
                        {fieldSources(st.id, fields)}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </RailSection>
          )}
          {stateFields.length > 0 && (
            <RailSection label="State" testId="expr-state-group" {...sectionProps("runstate")}>
              {/* The workflow state this step reads: starting data, variables and what upstream
                  steps write. A field only some entry paths set says so. */}
              {source("state", { kind: "var", ref: "state" }, "w6w-expr-chip-var", "◇", true)}
              <div className="w6w-exprmodal-subsources" data-testid="expr-state-fields">
                {outputFieldTree(stateFields).map(({ field, depth, name }) => {
                  const ref = `state.${field.key}`;
                  return source(
                    name,
                    { kind: "var", ref },
                    "w6w-exprmodal-field",
                    null,
                    false,
                    undefined,
                    { name: varLabel(ref), depth, somePaths: field.paths === "some" },
                  );
                })}
              </div>
            </RailSection>
          )}
          {metaIds.length > 0 && (
            <RailSection label="Metadata" testId="expr-metadata-group" {...sectionProps("meta")}>
              {/* Every node in the workflow, other paths included: its static meta
                  (`nodes.<id>.meta.*`) is readable from anywhere, unlike its data. */}
              {metaIds.map((id) => metaNode(id))}
            </RailSection>
          )}

          {/* Inputs and Variables in both modes; Documents in expression and starting-state mode; Secrets in expression mode only. */}
          <>
            {options.inputs !== undefined && (
              <RailSection label="Inputs" {...sectionProps("inputs")}>
                {inputs.length === 0 && <span className="w6w-expr-menu-empty">No inputs</span>}
                {inputs.map((i) =>
                  source(i, { kind: "var", ref: `inputs.${i}` }, "w6w-expr-chip-var", "⇥"),
                )}
              </RailSection>
            )}

            <RailSection
              label="Variables"
              {...sectionProps("vars")}
              action={
                options.createVar && (
                  <button
                    type="button"
                    className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                    data-testid="expr-add-var"
                    onClick={() => setAdding("var")}
                  >
                    + Add
                  </button>
                )
              }
            >
              {vars.length === 0 && <span className="w6w-expr-menu-empty">No variables</span>}
              {vars.map((v) =>
                source(v, { kind: "var", ref: `var.${v}` }, "w6w-expr-chip-var", "◆"),
              )}
            </RailSection>

            {constants.length > 0 && (
              <RailSection
                label="Constants"
                testId="expr-constants-group"
                {...sectionProps("consts")}
              >
                {constants.map((c) =>
                  source(c, { kind: "var", ref: `const.${c}` }, "w6w-expr-chip-var", "◈"),
                )}
              </RailSection>
            )}
          </>
          {(!jsonBinding || seedMode) && (
            <RailSection label="Documents" {...sectionProps("docs")}>
              {documents.length === 0 && <span className="w6w-expr-menu-empty">No documents</span>}
              {documents.map((d) => {
                // Same guard, same single render site, as the steps block above:
                // enumerated raw at the source (studio's `document-sources.ts`),
                // filtered exactly once, here, where the ref is built (A3, A4a).
                const fields = (d.fields ?? []).filter((f) => isRefSafeKey(f.key));
                const docKey = `doc:${d.key}`;
                const isOpen = expanded.has(docKey);
                // The whole document — unconditional, for every format, exactly
                // as before (A2). Its class, label, sigil and inserted ref are
                // unchanged from before.
                const wholeBtn = source(
                  d.key,
                  { kind: "var", ref: `documents.${d.key}` },
                  "w6w-expr-chip-var",
                  "▦",
                  fields.length > 0,
                );
                return (
                  <Fragment key={d.key}>
                    {fields.length > 0 ? (
                      <div className="w6w-exprmodal-source-row">
                        {wholeBtn}
                        <FieldsToggle
                          count={fields.length}
                          open={isOpen}
                          onToggle={() => toggleExpanded(docKey)}
                        />
                      </div>
                    ) : (
                      wholeBtn
                    )}
                    {/* …and one source per surviving top-level field, nested
                      under it, collapsed until the toggle above is expanded.
                      The label is the field key itself — the parent row above
                      already shows `d.key` — never `varLabel(ref)`, which
                      would spell out the whole dotted ref again. Each row
                      additionally carries a SECOND, visible action (D-P1)
                      that inserts the SAME ref as a `render` part, so the
                      placeholder-substitution behaviour is discoverable at
                      the moment of insertion — not only via the chip's own
                      post-insertion ⇄ toggle. */}
                    {fields.length > 0 && isOpen && (
                      <div className="w6w-exprmodal-subsources">
                        {fields.map((f) => {
                          const ref = `documents.${d.key}.${f.key}`;
                          return (
                            <div key={ref} className="w6w-exprmodal-subsource-row">
                              {source(f.key, { kind: "var", ref }, "w6w-expr-chip-var", "·")}
                              {!jsonBinding && (
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
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </RailSection>
          )}
          {!jsonBinding && (
            <RailSection
              label="Secrets"
              {...sectionProps("secrets")}
              action={
                options.createSecret && (
                  <button
                    type="button"
                    className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                    data-testid="expr-add-secret"
                    onClick={() => setAdding("secret")}
                  >
                    + Add
                  </button>
                )
              }
            >
              {secrets.length === 0 && <span className="w6w-expr-menu-empty">No secrets</span>}
              {secrets.map((s) =>
                source(s, { kind: "secret", ref: s }, "w6w-expr-chip-secret", "🔒"),
              )}
            </RailSection>
          )}
        </aside>

        {/* Right (json-binding mode): the JSON compose pane over its resolved preview. */}
        {jsonBinding && (
          <div className="w6w-exprmodal-main">
            <div className="w6w-exprmodal-editor">
              <span className="w6w-exprmodal-pane-label">
                JSON
                <span className="w6w-muted w6w-small">
                  {" "}
                  — type JSON, or click a source on the left to insert it at the cursor
                </span>
              </span>
              <div
                className="w6w-exprmodal-json"
                onFocus={() => {
                  jsonTouched.current = true;
                }}
              >
                <JsonEditor
                  value={jsonText}
                  onChange={setJsonText}
                  height="100%"
                  minHeight="0px"
                  aria-label="Compose JSON"
                  placeholder={
                    seedMode
                      ? '{ "region": "us", "template": "{{ documents.welcome }}" }'
                      : '{ "key": "{{ nodes.step_1.output }}" }'
                  }
                  onCreateEditor={(view) => {
                    jsonView.current = view;
                  }}
                />
              </div>
            </div>
            <div className="w6w-exprmodal-preview w6w-exprmodal-result-pane">
              <span className="w6w-exprmodal-pane-label">
                Result
                <span className="w6w-muted w6w-small">
                  {" "}
                  {seedMode
                    ? " — the state each run starts with, against the sample values"
                    : " — live preview against the sample values"}
                </span>
              </span>
              {seedProblem && (
                <span className="w6w-muted w6w-small" role="alert" data-testid="expr-json-problem">
                  {seedProblem}
                </span>
              )}
              <pre className="w6w-exprmodal-result" data-testid="expr-json-result">
                {jsonParsed.ok
                  ? JSON.stringify(
                      resolveComposed(jsonParsed.value, (leaf) =>
                        resolveParamJson(leaf, sampleScope()),
                      ),
                      null,
                      2,
                    )
                  : jsonText.trim() === ""
                    ? ""
                    : "Invalid JSON"}
              </pre>
            </div>
          </div>
        )}

        {/* Right: editor over the saved {{ }} template. */}
        {!jsonBinding && (
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
                data-placeholder='Pick a field, then type == "value"'
                aria-invalid={authored.error !== null}
                aria-describedby={authored.error ? "expression-problem" : undefined}
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
                      insertNodeAtCaret(
                        el,
                        makeChip(el.ownerDocument, part, { renderToggle: true }),
                      );
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
                      const nextKind =
                        chip.getAttribute("data-kind") === "render" ? "var" : "render";
                      chip.replaceWith(
                        makeChip(
                          chip.ownerDocument,
                          { kind: nextKind, ref },
                          { renderToggle: true },
                        ),
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
              <span className="w6w-muted w6w-small">
                Pick a field, then type <code>== "value"</code>. Combine conditions with{" "}
                <code>&amp;&amp;</code> or <code>||</code>. Double-click a chip to edit it.
              </span>
              {authored.error && (
                <span id="expression-problem" role="alert" className="w6w-error">
                  {authored.error}
                </span>
              )}
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
                      value={samples[ref] ?? effectiveSamples[ref] ?? ""}
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
                <span className="w6w-muted w6w-small">
                  {" "}
                  — live preview against the sample values
                </span>
              </span>
              <Copyable value={result} readOnly>
                <pre className="w6w-exprmodal-result">{result || " "}</pre>
              </Copyable>
              {resultNotes.length > 0 && (
                <span className="w6w-muted w6w-small" data-testid="expr-result-source">
                  {resultNotes.join(" · ")}
                </span>
              )}
            </div>
          </div>
        )}
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

/**
 * The disclosure beside a rail source that has child field rows (a step's
 * output fields, a document's top-level keys). It names what it reveals —
 * "11 fields" — because the source chip's own `▸`/`▦` sigil reads as an
 * expander but INSERTS the whole value; a bare 20px chevron next to it went
 * unnoticed, leaving authors no visible way to reach `get_event_1.name`.
 */
/** The rail's accordion sections, in render order. */
type RailSectionKey =
  | "state"
  | "runstate"
  | "meta"
  | "inputs"
  | "vars"
  | "consts"
  | "docs"
  | "secrets";

/**
 * One collapsible rail section. The header (and its `action`, e.g. "+ Add") always shows; the
 * body stays mounted and animates its height (`grid-template-rows` 0fr → 1fr), made `inert`
 * while closed so its rows leave the tab order.
 */
function RailSection({
  label,
  open,
  onToggle,
  action,
  testId,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Set as a DOM property: React 18 and 19 disagree on how the `inert` attribute is spelled.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.inert = !open;
  }, [open]);
  return (
    <div
      className={`w6w-exprmodal-group${open ? " is-open" : ""}`}
      data-testid={testId}
      data-section-open={open ? "true" : "false"}
    >
      <div className="w6w-exprmodal-group-head">
        <button
          type="button"
          className="w6w-exprmodal-group-toggle"
          data-testid="expr-section-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="w6w-exprmodal-group-label">{label}</span>
          <span className="w6w-exprmodal-group-caret" aria-hidden="true">
            ›
          </span>
        </button>
        {action}
      </div>
      <div id={bodyId} ref={bodyRef} className="w6w-exprmodal-group-body" aria-hidden={!open}>
        <div className="w6w-exprmodal-group-inner">{children}</div>
      </div>
    </div>
  );
}

function FieldsToggle({
  count,
  open,
  onToggle,
}: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="w6w-exprmodal-toggle-btn"
      data-testid="expr-toggle-fields"
      aria-expanded={open}
      title={open ? "Hide fields" : "Show fields"}
      onClick={onToggle}
    >
      {count} {count === 1 ? "field" : "fields"} {open ? "⌄" : "›"}
    </button>
  );
}

/** The fixed Metadata leaves (R-7): key under `steps.<id>.meta.`, and the label shown. */
const META_LEAVES: [string, string][] = [
  ["app", "App"],
  ["version", "App version"],
  ["action", "Action"],
  ["connectionId", "Connection ID"],
  ["subscriptionId", "Subscription ID"],
  ["url", "Webhook URL"],
];
/** The four leaves an external app step always offers (R-7); the rest only when known. */
const APP_META_KEYS = new Set(["app", "version", "action", "connectionId"]);

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
      {/* Body + pinned footer (D-3): `.w6w-stack` stays intact INSIDE the body so
          the fields keep their own spacing; only the action row moved out. */}
      <div className="w6w-modal-body">
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
              Letters, digits, and underscores. Must start with a letter or underscore.
              Case-sensitive.
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
        </div>
      </div>
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
    </Modal>
  );
}
