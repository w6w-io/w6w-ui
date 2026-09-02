import { useMemo, useState } from "react";
import { JsonEditor } from "../JsonEditor.tsx";
import { type DataVar, flattenParams, isParamVisible } from "../ParamsForm.tsx";
import type { StepStartState } from "../provider.tsx";
import {
  type ResolveScope,
  type ResolvedSegment,
  buildResolveScope,
  deepEqual,
  resolveParamValue,
} from "../resolve-params.ts";
import { resolveParamJson, resolveVarsJson } from "../resolved-json.ts";
import type { ActionParam } from "../types.ts";
import { useExpressionOptions } from "./ExpressionOptions.tsx";
import { varLabel } from "./expression-dom.ts";
import { clipResolvedValue } from "./resolved-clip.ts";

export interface ResolvedParamsProps {
  /** The action's declared params — same list `ParamsForm` renders on Configure. */
  params: ActionParam[];
  /** What will actually be submitted: `{ ...step.with, ...override }` — `testValues`, not `step.with`. */
  values: Record<string, unknown>;
  /** The exact object the test invoke sends as `state` — `steps.*`/`trigger.*` resolve against this. */
  testStartState?: StepStartState;
  /**
   * `"props"` (default) renders the filtered row list; `"code"` renders the
   * COMPLETE resolved-values JSON (A4/A5/D-2) — every visible param, defaults
   * included. Driven by the host's own toggle state; this component never
   * mounts a toggle of its own (D-7 — `PropertyEntryForm` already owns one on
   * the trigger arm, and two side by side is a defect, not a feature).
   */
  view?: "props" | "code";
}

/**
 * Read-only sibling of `ParamsForm`: for every configured param, shows the
 * value it resolves to against the current test scope instead of an editable
 * widget. Mounts no `contentEditable`, no `ƒx` button, no input, and never
 * calls an `onChange` — this is the Test tab's "what will actually be sent"
 * view, not a second place to edit params.
 *
 * Reuses `flattenParams`/`isParamVisible` from `ParamsForm.tsx` (same order +
 * visibility the Configure tab uses) rather than re-flattening sections, and
 * the static chip vocabulary (`varLabel`, `.w6w-expr-chip-*`) rather than
 * `expression-dom.ts`'s DOM-painting, which is for the editable field.
 */
export function ResolvedParams({
  params,
  values,
  testStartState,
  view = "props",
}: ResolvedParamsProps) {
  const { sampleValues } = useExpressionOptions();
  const scope = useMemo(
    () => buildResolveScope(sampleValues, testStartState),
    [sampleValues, testStartState],
  );
  const flat = flattenParams(params);
  const effective = (key: string) =>
    values[key] !== undefined ? values[key] : flat.find((p) => p.key === key)?.default;
  // Sections are layout-only containers with no value of their own (their
  // children, already flattened, carry the values) — skip rendering a row for
  // the section param itself, exactly as `ParamsForm`'s own `renderOne` does.
  // This is the "visible" row set D-2's code view is complete OVER — before
  // A1's unchanged-value filter, so the code view still carries a param the
  // list hides.
  const visibleRows = flat.filter((p) => p.type !== "section" && isParamVisible(p, effective));

  if (view === "code") {
    // Derived fresh on every render from `values` — no draft state — so
    // editing the incoming-state override above updates this text live,
    // exactly as it already updates the row list (A5).
    const json = buildResolvedJson(visibleRows, values, scope);
    return (
      <div className="w6w-resolved-params">
        <JsonEditor
          value={JSON.stringify(json, null, 2)}
          onChange={() => {}}
          readOnly
          minHeight="260px"
          height="100%"
          aria-label="Resolved test values (JSON)"
        />
      </div>
    );
  }

  // A1/D-1: drop a row whose effective value is deep-equal to its declared
  // default — noise the human named explicitly (an unset `Sender Name ""`, an
  // explicitly-false `required` boolean, an empty `{}`/array). Uniform: no
  // `required` exemption, and a key EXPLICITLY present in `with` that happens
  // to equal the default is hidden too (equality, not presence — D-1).
  const rows = visibleRows.filter((p) => !deepEqual(effective(p.key), p.default));

  if (visibleRows.length === 0) {
    return (
      <div className="w6w-resolved-params">
        <p className="w6w-muted w6w-small">This action takes no parameters.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="w6w-resolved-params">
        <p className="w6w-muted w6w-small">
          Every configured value matches its default — nothing to show here. Switch to JSON to see
          the full set.
        </p>
      </div>
    );
  }

  return (
    // `.w6w-resolved-table` is the ONE grid this whole row list shares — each
    // `.w6w-resolved-row` below is `display: contents` and contributes its
    // two children straight into these column tracks, so every row's key
    // column lines up with every other row's.
    <div className="w6w-resolved-params w6w-resolved-table">
      {rows.map((param) =>
        param.type === "vars" ? (
          <ResolvedVarsRow key={param.key} param={param} value={values[param.key]} scope={scope} />
        ) : (
          <ResolvedParamRow
            key={param.key}
            label={param.label ?? param.key}
            segments={resolveParamValue(
              values[param.key] !== undefined ? values[param.key] : param.default,
              scope,
            )}
          />
        ),
      )}
    </div>
  );
}

/**
 * D-2: the code view is COMPLETE over `rows` (every visible param — see the
 * caller — defaults included, the row set BEFORE A1's filter), one key per
 * `param.key`, each folded through {@link resolveParamJson}/{@link
 * resolveVarsJson} (never the schema, never raw `step.with`, never the
 * `{type:"expr",…}` envelope — A6's pinned serialization).
 */
function buildResolvedJson(
  rows: ActionParam[],
  values: Record<string, unknown>,
  scope: ResolveScope,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const param of rows) {
    if (param.type === "vars") {
      const raw = Array.isArray(values[param.key])
        ? (values[param.key] as DataVar[])
        : Array.isArray(param.default)
          ? (param.default as DataVar[])
          : [];
      out[param.key] = resolveVarsJson(raw, scope);
    } else {
      out[param.key] = resolveParamJson(
        values[param.key] !== undefined ? values[param.key] : param.default,
        scope,
      );
    }
  }
  return out;
}

function ResolvedParamRow({ label, segments }: { label: string; segments: ResolvedSegment[] }) {
  return (
    <div className="w6w-resolved-row">
      <span className="w6w-resolved-label">{label}</span>
      <div className="w6w-resolved-value">
        <ResolvedSegments segments={segments} />
      </div>
    </div>
  );
}

/** A `vars`-typed param: one row per configured key, each resolved independently (A5). */
function ResolvedVarsRow({
  param,
  value,
  scope,
}: {
  param: ActionParam;
  value: unknown;
  scope: ResolveScope;
}) {
  const rows: DataVar[] = Array.isArray(value)
    ? (value as DataVar[])
    : Array.isArray(param.default)
      ? (param.default as DataVar[])
      : [];
  return (
    <div className="w6w-resolved-row">
      <span className="w6w-resolved-label">{param.label ?? param.key}</span>
      {rows.length === 0 ? (
        <p className="w6w-muted w6w-small">None configured.</p>
      ) : (
        <div className="w6w-stack">
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id (mirrors ParamsForm's VarsField)
            <div className="w6w-resolved-value" key={i}>
              <code>{row.key || "(no key)"}</code>
              {" → "}
              <ResolvedSegments segments={resolveParamValue(row.value, scope)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResolvedSegments({ segments }: { segments: ResolvedSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are a positional, immutable render of one value's parts
        <ResolvedSegmentView key={i} segment={seg} />
      ))}
    </>
  );
}

/** One part's worth of chrome: a static chip (for anything ref-shaped) plus its outcome. */
function ResolvedSegmentView({ segment }: { segment: ResolvedSegment }) {
  switch (segment.status) {
    case "resolved":
      return segment.ref ? (
        <>
          <ExprChip kind="var" refName={segment.ref} />
          <ResolvedValueText value={segment.value} />
        </>
      ) : (
        <ResolvedValueText value={segment.value} />
      );
    case "unresolved":
      // Never the ref/template text as if it were the value: the chip shows
      // only the short display LABEL (never the full ref string — the same
      // "label ≠ ref" precedent `expression-dom.ts` documents), and the
      // outcome is a dedicated, always-non-blank badge.
      return (
        <>
          <ExprChip kind="var" refName={segment.ref} />
          <span className="w6w-param-unresolved">unresolved</span>
        </>
      );
    case "not-evaluated":
      return (
        <>
          <ExprChip kind="expr" />
          <span className="w6w-param-unevaluated">not evaluated</span>
        </>
      );
    case "masked":
      // The chip's 🔒 sigil already says "masked" — no separate badge needed,
      // and no ciphertext or plaintext is ever available to show here.
      return <ExprChip kind="secret" refName={segment.ref} />;
  }
}

/**
 * One resolved value's text, clipped when it is long enough to take over the
 * row (`resolved-clip.ts`). A document body or a rendered template resolves to
 * tens of kilobytes of HTML, and a row that pastes all of it inline buries the
 * other params and the run's result below it (human report, 2026-09-01).
 *
 * Expanding does NOT restore the unbounded paste: the full text goes into its
 * own scrollable block (`.w6w-resolved-text-full`), so the row can never grow
 * past a few lines of the panel either way. A value inside the budget renders
 * exactly as it always did — one bare `<span>`, no toggle, no wrapper.
 */
function ResolvedValueText({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const full = formatResolvedValue(value);
  const clip = clipResolvedValue(full);
  if (!clip.clipped) return <span>{full}</span>;
  return (
    <>
      <span className={expanded ? "w6w-resolved-text-full" : undefined}>
        {expanded ? full : `${clip.text}…`}
      </span>
      <button
        type="button"
        className="w6w-resolved-more"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? "Show less" : `Show all (${clip.length.toLocaleString()} characters)`}
      </button>
    </>
  );
}

const CHIP_SIGIL: Record<"var" | "secret" | "expr", string> = { var: "◆", secret: "🔒", expr: "ƒ" };

/**
 * A read-only chip, visually consistent with `expression-dom.ts`'s
 * `makeChip` (same classes/sigils, same `varLabel` shortening) but built on a
 * plain `<span>` — no `contentEditable`, no remove button, no DOM painting.
 */
function ExprChip({ kind, refName }: { kind: "var" | "secret" | "expr"; refName?: string }) {
  const label = kind === "expr" ? "expr" : varLabel(refName ?? "");
  return (
    <span className={`w6w-expr-chip w6w-expr-chip-${kind}`}>
      <span className="w6w-expr-chip-sigil">{CHIP_SIGIL[kind]}</span>
      <span className="w6w-expr-chip-label">{label}</span>
    </span>
  );
}

/**
 * A resolved value, formatted for display — never blank, even for the falsy
 * values `resolved` explicitly covers (`null`/`""`/`false`/`0`): each renders
 * visibly distinct text so it never reads as "nothing here" the way an actual
 * blank would.
 */
function formatResolvedValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "(not set)";
  if (value === "") return '""';
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
