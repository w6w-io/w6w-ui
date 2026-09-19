import { type ReactNode, useEffect, useId, useState } from "react";
import { CodeEditor, type ScriptLanguage } from "./CodeEditor.tsx";
import { JsonEditor } from "./JsonEditor.tsx";
import { ExpressionEditorModal } from "./components/ExpressionEditorModal.tsx";
import { ExpressionInput } from "./components/ExpressionInput.tsx";
import { useExpressionOptions } from "./components/ExpressionOptions.tsx";
import { Modal } from "./components/Modal.tsx";
import { type ActionParam, type ExprValue, type SecretValue, isExprValue } from "./types.ts";

/**
 * Evaluate a param's `showIf` predicate. `getValue` resolves a sibling field's
 * current value (falling back to its default). Params with no `showIf` always show.
 *
 * Exported so callers outside this form (e.g. `requiredParamsFilled`'s Test-gate)
 * can skip a `required` field that's currently hidden — otherwise `required` and
 * `showIf` can't safely combine: a field required only in one branch (e.g.
 * SendGrid's `contentValue`, moot once a dynamic template supplies the body)
 * would block the gate even while hidden.
 */
export function isParamVisible(param: ActionParam, getValue: (key: string) => unknown): boolean {
  const c = param.showIf;
  if (!c) return true;
  const v = getValue(c.field);
  if (c.equals !== undefined) return v === c.equals;
  if (c.in) return c.in.some((x) => x === v);
  if (c.notIn) return !c.notIn.some((x) => x === v);
  if (c.truthy !== undefined) return c.truthy ? !!v : !v;
  return true;
}

/**
 * Render a param list, laying adjacent params that share a `row` id side by side
 * in a flex row; everything else stacks normally.
 */
/**
 * Flatten a param list, descending into `section` children (which write their
 * values flat at the enclosing form level). Used to resolve declared defaults
 * for `showIf` across sections. Non-section `children` (e.g. a nested `group`
 * object) are left alone — those values live nested under the parent key.
 */
export function flattenParams(list: ActionParam[]): ActionParam[] {
  const out: ActionParam[] = [];
  for (const p of list) {
    out.push(p);
    if (p.type === "section" && p.children) out.push(...flattenParams(p.children));
  }
  return out;
}

function renderFieldRows(
  list: ActionParam[],
  renderOne: (p: ActionParam) => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < list.length; ) {
    const rowId = list[i].row;
    if (rowId) {
      const group: ActionParam[] = [];
      while (i < list.length && list[i].row === rowId) group.push(list[i++]);
      out.push(
        <div className="w6w-field-row" key={`row:${rowId}`}>
          {group.map(renderOne)}
        </div>,
      );
    } else {
      out.push(renderOne(list[i]));
      i++;
    }
  }
  return out;
}

/**
 * Builds the `renderOne` dispatch a param list is rendered through: `section`
 * (layout-only, shares the caller's `values`/`set`/`effective`), `repeat: true`
 * (→ {@link RepeatField}, the existing `ArrayField` with a synthesized `item`),
 * `type: "group"` with a non-empty `children` (→ {@link GroupField}, a nested
 * form), else the plain {@link ParamField}. Factored out so {@link GroupField}
 * can build its OWN dispatch bound to its nested `values`/`set`/`effective` —
 * the one place a group's value-plumbing must differ from `SectionField`'s (see
 * `GroupField`'s own doc comment).
 */
function makeRenderOne(
  values: Record<string, unknown>,
  set: (key: string, value: unknown) => void,
  effective: (key: string) => unknown,
  readOnly: boolean | undefined,
): (p: ActionParam) => ReactNode {
  const renderOne = (p: ActionParam): ReactNode => {
    if (p.type === "section") {
      return <SectionField key={p.key} param={p} effective={effective} renderOne={renderOne} />;
    }
    // `repeat` is sugar for `type: "array"` (rfcs/param.md's amendment) — an
    // explicit `type: "array"` param already routes through `ParamField`'s own
    // `array` arm, so it's excluded here to avoid double-synthesizing `item`.
    if (p.repeat && p.type !== "array") {
      return (
        <RepeatField
          key={p.key}
          param={p}
          value={values[p.key]}
          onChange={set}
          readOnly={readOnly}
        />
      );
    }
    if (p.type === "group" && p.children && p.children.length > 0) {
      return (
        <GroupField
          key={p.key}
          param={p}
          value={values[p.key]}
          onChange={set}
          effective={effective}
          readOnly={readOnly}
        />
      );
    }
    return (
      <ParamField
        key={p.key}
        param={p}
        value={values[p.key]}
        onChange={set}
        effective={effective}
        readOnly={readOnly}
      />
    );
  };
  return renderOne;
}

export interface ParamsFormProps {
  /** Declared params of the selected action. */
  params: ActionParam[];
  /** Current values, keyed by param `key`. Becomes the step's `with`. */
  values: Record<string, unknown>;
  /** Fired with the next values object on every edit. */
  onChange: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
}

/**
 * Renders an action's declared params as a form. Required params are always
 * shown; optional ones collapse under a disclosure so the common path stays
 * tidy. Widget is chosen by `param.type` — same field-driven approach as
 * `AuthFieldsForm`, extended with `text` (textarea) and `json` (JsonEditor).
 *
 * Values are collected into a plain object suitable for a step's `with`. For
 * expression bindings (`{ $: "steps.x.output.y" }`) authors drop to the JSON
 * view; this form deals in literals.
 */
export function ParamsForm({ params, values, onChange, readOnly }: ParamsFormProps) {
  // Effective value of a field for `showIf` checks: the entered value, else the
  // field's declared default (so conditions hold before the user touches it).
  // Section/group children write flat at the enclosing level, so flatten them
  // too — otherwise a `showIf` referencing a section child sees `undefined` for
  // its declared default until the user edits it.
  const flat = flattenParams(params);
  const effective = (key: string) =>
    values[key] !== undefined ? values[key] : flat.find((p) => p.key === key)?.default;
  const visible = params.filter((p) => isParamVisible(p, effective));
  // Split by `advanced` (not by required): required + non-advanced show up front;
  // only fields flagged `advanced` collapse under "Additional parameters".
  const main = visible.filter((p) => p.required || !p.advanced);
  const additional = visible.filter((p) => !p.required && p.advanced);
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  if (params.length === 0) {
    return <p className="w6w-muted w6w-small">This action takes no parameters.</p>;
  }

  // A `section` is a layout-only container: it renders its children through this
  // SAME pipeline (so child `row`/`showIf`/nested sections still work) and —
  // crucially — passes the TOP-LEVEL `set`/`values` down, so section children
  // write to the enclosing form values, not nested under the section key. Note a
  // section IS the disclosure, so a child's `advanced` flag is not re-split here.
  const renderOne = makeRenderOne(values, set, effective, readOnly);

  return (
    <div className="w6w-stack">
      {renderFieldRows(main, renderOne)}
      {additional.length > 0 && (
        <details className="w6w-params-optional">
          <summary className="w6w-muted w6w-small">
            Additional parameters ({additional.length})
          </summary>
          <div className="w6w-stack" style={{ marginTop: 8 }}>
            {renderFieldRows(additional, renderOne)}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * A `section`-typed param — a layout-only container of `children`. Two shapes:
 * `section: "collapsible"` renders a titled, collapsed-by-default `<details>`
 * disclosure (the app-authored per-cluster disclosure, distinct from the single
 * global "Additional parameters" one); `section: "group"` lays the children out
 * per `layout` — `"row"` side by side (reusing `.w6w-field-row`), else stacked.
 *
 * Children render through the SAME `renderOne` pipeline the enclosing form uses,
 * so their values are written flat at the enclosing form level (a section does
 * NOT nest its value object), and child `row`/`showIf`/nested sections keep
 * working. A child's `advanced` flag is ignored inside a section — the section
 * itself is the disclosure, so children are shown inline within it.
 */
function SectionField({
  param,
  effective,
  renderOne,
}: {
  param: ActionParam;
  effective: (key: string) => unknown;
  renderOne: (p: ActionParam) => ReactNode;
}) {
  const visibleChildren = (param.children ?? []).filter((c) => isParamVisible(c, effective));

  if (param.section === "collapsible") {
    return (
      <details className="w6w-section" open={param.collapsed === false}>
        <summary className="w6w-section-summary">
          <span className="w6w-section-title">{param.title ?? param.label ?? param.key}</span>
          {param.subtitle && <span className="w6w-section-subtitle">{param.subtitle}</span>}
        </summary>
        <div className="w6w-stack w6w-section-body">
          {renderFieldRows(visibleChildren, renderOne)}
        </div>
      </details>
    );
  }

  // group: side by side (`layout: "row"`) or stacked (default). The row wrapper
  // reuses the existing `.w6w-field-row` rule so each child `.w6w-field` sits
  // side by side; stack still honors child `row` grouping via renderFieldRows.
  if (param.layout === "row") {
    return <div className="w6w-field-row">{visibleChildren.map(renderOne)}</div>;
  }
  return <div className="w6w-stack">{renderFieldRows(visibleChildren, renderOne)}</div>;
}

/** Scalar-only types `ArrayItemInput` (`:795-850` below) actually renders — a
 *  select, checkbox, number or text input. Anything else (a `secret`, or a
 *  child carrying its own `children`) falls back to the JSON editor for the
 *  whole group rather than half-rendering it (D-2, rfcs/param.md's amendment). */
const ARRAY_ITEM_SCALAR_TYPES = new Set(["string", "text", "number", "boolean", "select"]);

function fitsArrayItemFields(fields: ActionParam[]): boolean {
  return (
    fields.length > 0 && fields.every((f) => ARRAY_ITEM_SCALAR_TYPES.has(f.type) && !f.children)
  );
}

/**
 * A `type: "group"` param with a non-empty `children` — a **nested** form.
 * Mirrors `SectionField`'s shape (a heading + `renderFieldRows` over the
 * visible children) with the ONE inversion a group requires: values write
 * NESTED under this param's own key (`onChange(param.key, {...current,
 * [childKey]: v})`), matching `resolveParams`' own nesting and
 * rfcs/param.md:190 — a section's children stay flat, a group's do not, so
 * this is deliberately a separate component rather than `SectionField`
 * parameterized to do both (that would conflate two value contracts in one
 * component's props).
 *
 * Bare container (D-1): `param.label`/`param.key` as a plain heading (reusing
 * the existing `.w6w-section-title`/`.w6w-section-body` type styles — no new
 * class, no border, no `<details>`), children stacked below.
 *
 * Group-local `showIf` (D-3): a child's `showIf` resolves against the group's
 * OWN children first, falling back to the enclosing form's `effective` for any
 * key the group doesn't declare — the same rule rfcs/param.md:256 already
 * states for `dependsOn`, extended here to `showIf`.
 */
function GroupField({
  param,
  value,
  onChange,
  effective,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  /** The ENCLOSING form's `effective` — the fallback for a key this group
   *  doesn't declare among its own (flattened) children. */
  effective: (key: string) => unknown;
  readOnly?: boolean;
}) {
  const children = param.children ?? [];
  const groupValue = (value ?? {}) as Record<string, unknown>;
  const groupSet = (key: string, v: unknown) => onChange(param.key, { ...groupValue, [key]: v });
  // Flattened so a `section` nested inside this group (which writes flat at
  // the group's own level) still counts as "the group's own" for showIf
  // resolution — mirrors flattenParams' existing section-descent, reused as-is.
  const flatChildren = flattenParams(children);
  const groupEffective = (key: string): unknown => {
    const local = flatChildren.find((c) => c.key === key);
    if (!local) return effective(key);
    return groupValue[key] !== undefined ? groupValue[key] : local.default;
  };
  const visibleChildren = children.filter((c) => isParamVisible(c, groupEffective));
  const groupRenderOne = makeRenderOne(groupValue, groupSet, groupEffective, readOnly);

  return (
    <div className="w6w-stack">
      <span className="w6w-section-title">{param.label ?? param.key}</span>
      <div className="w6w-stack w6w-section-body">
        {renderFieldRows(visibleChildren, groupRenderOne)}
      </div>
    </div>
  );
}

/**
 * A `repeat: true` param — sugar for `type: "array"` with a synthesized `item`
 * (rfcs/param.md's amendment); routes to the SAME `ArrayField` an explicit
 * `type: "array"` param uses, never a second list component:
 *   - scalar (`param.type` is not `group`/`section`/`array`): `item = { type:
 *     param.type, options: param.options }`, passed explicitly because
 *     `ArrayField`'s own fallback (`param.item ?? { type: "string" }`) is the
 *     literal `"string"`, not `param.type`.
 *   - `type: "group"` with scalar-only `children` (the D-2 ceiling above):
 *     `item = { type: "object", fields: param.children }`.
 *   - `type: "group"` with no `children`, or any child the ceiling excludes:
 *     falls back to the JSON editor for the whole group.
 */
function RepeatField({
  param,
  value,
  onChange,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}) {
  if (param.type === "group") {
    const children = param.children ?? [];
    if (!fitsArrayItemFields(children)) {
      return <JsonParamField param={param} value={value} onChange={onChange} readOnly={readOnly} />;
    }
    const synthesized: ActionParam = { ...param, item: { type: "object", fields: children } };
    return <ArrayField param={synthesized} value={value} onChange={onChange} readOnly={readOnly} />;
  }
  const synthesized: ActionParam = {
    ...param,
    item: { type: param.type, options: param.options },
  };
  return <ArrayField param={synthesized} value={value} onChange={onChange} readOnly={readOnly} />;
}

/** The Python default snippet for a `code` param when its sibling `language`
 *  resolves to `"python"` (D-3) — a working `return input`-equivalent, same
 *  shape/intent as `SCRIPT_APP`'s JS default in `flow-types.ts`. */
const PYTHON_CODE_DEFAULT = "# Runs as a function body. Return the step's output.\nreturn input";

function ParamField({
  param,
  value,
  onChange,
  effective,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  /** Sibling-value getter (D-1/D-3) — only the `code` branch reads it, to pick
   *  the editor's language mode and default snippet from a sibling `language`
   *  param, when one exists. */
  effective?: (key: string) => unknown;
  readOnly?: boolean;
}) {
  const label = param.label ?? param.key;
  // A checkbox always carries a value (true/false), so "required" has no meaning
  // for it — don't decorate booleans with the required asterisk.
  const req = param.required && param.type !== "boolean" ? " *" : "";
  // Stable id so the INLINE variant's label can point at the control it names
  // (the label no longer wraps it — the ƒx sits between them).
  const controlId = useId();

  if (param.type === "boolean") {
    const current = Boolean(value ?? param.default ?? false);
    return (
      <FxField
        param={param}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
        req={req}
        // A checkbox does NOT fill the field box a text input fills, so it opts
        // out of that box HERE, at the seam — the wrapper renders a different
        // class rather than having the chrome clawed back off by a more
        // specific rule. Layout becomes the row: <checkbox> <ƒx> <label>.
        variant="inline"
        controlId={controlId}
      >
        <input
          id={controlId}
          type="checkbox"
          checked={current}
          disabled={readOnly}
          onChange={(e) => onChange(param.key, e.target.checked)}
        />
      </FxField>
    );
  }

  // `json` and `group` params hold objects/arrays. Edit them as JSON so the
  // value round-trips faithfully instead of collapsing to "[object Object]".
  if (param.type === "json" || param.type === "group") {
    return <JsonParamField param={param} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  // `code` — an inline script/snippet, edited in a real code editor. A sibling
  // `language` param (if one exists in this form) drives both the editor's
  // CodeMirror mode and — only while the user hasn't entered a value of their
  // own (D-3) — which hardcoded default snippet is shown.
  if (param.type === "code") {
    const siblingLanguage = effective?.("language");
    const language: ScriptLanguage | undefined =
      siblingLanguage === "python"
        ? "python"
        : siblingLanguage === "javascript"
          ? "javascript"
          : undefined;
    const fallbackDefault = language === "python" ? PYTHON_CODE_DEFAULT : param.default;
    // A `language` sibling seeds the form with the *JS* boilerplate on mount
    // (StepBuilderModal.tsx copies every declared `default` into a new
    // step's initial values) — so `value` is never `undefined` in the real
    // composition. Treat that untouched boilerplate (either language's own
    // hardcoded default) as still "replaceable" so a language switch swaps
    // the shown snippet; anything else the user typed survives untouched.
    // Gated on `language !== undefined` so a `code` param with no `language`
    // sibling keeps today's exact `value ?? param.default ?? ""` behaviour.
    const isUntouchedBoilerplate =
      language !== undefined &&
      (value === undefined || value === param.default || value === PYTHON_CODE_DEFAULT);
    const current = (isUntouchedBoilerplate ? fallbackDefault : (value ?? fallbackDefault)) ?? "";
    return (
      <div className="w6w-field">
        <span>
          {label}
          {req}
        </span>
        <CodeEditor
          value={String(current)}
          readOnly={readOnly}
          minHeight="180px"
          language={language}
          aria-label={`${param.key} code`}
          onChange={(next) => onChange(param.key, next)}
        />
        {param.hint && <span className="w6w-hint">{param.hint}</span>}
      </div>
    );
  }

  // `vars` — a dynamic table of typed key/value variables.
  if (param.type === "vars") {
    return <VarsField param={param} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  // Multi-line text: either the dedicated `text` type or any field the app
  // flagged `config.multiline` (e.g. a `string` message body as a textarea).
  if (param.type === "text" || param.config?.multiline) {
    const current = (value ?? param.default ?? "") as string;
    return (
      <FxField
        param={param}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
        req={req}
      >
        <textarea
          rows={3}
          value={String(current)}
          readOnly={readOnly}
          aria-label={label}
          onChange={(e) => onChange(param.key, e.target.value)}
        />
      </FxField>
    );
  }

  // Multi-select: pick several options from a dropdown; each becomes a removable
  // pill. Value is an array of the chosen option values.
  if (param.type === "multiselect") {
    return <MultiSelectField param={param} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  // `array` — a list control: a row per item (a scalar input, or an object's
  // fields side by side), with add/remove buttons.
  if (param.type === "array") {
    return <ArrayField param={param} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  // A constrained set of choices renders as a dropdown — even for a `string`
  // param (e.g. an HTTP method). Driven by `param.options` in the config.
  if (Array.isArray(param.options) && param.options.length > 0) {
    const current = value ?? param.default ?? param.options[0]?.value ?? "";
    const isNumber = param.type === "number";
    return (
      <FxField
        param={param}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        label={label}
        req={req}
      >
        <select
          value={String(current)}
          disabled={readOnly}
          aria-label={label}
          onChange={(e) => onChange(param.key, isNumber ? Number(e.target.value) : e.target.value)}
        >
          {param.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </FxField>
    );
  }

  // `secret` — an encrypted / expression-capable field. Rendered via the
  // segmented ExpressionInput (masked): the value may be a plain string, an
  // `{type:"expr"}` envelope, or an at-rest `{type:"secret"}` (shown as `***`,
  // never the ciphertext). The var/secret picker data source is wired later
  // (task 3.2) via the `options` prop.
  //
  // General (non-secret) scalar fields get their own expression mode via the
  // `fx` toggle on {@link FxField} — the plain widget stays the default there.
  if (param.type === "secret") {
    const current = (value ?? param.default) as ExprValue | string | SecretValue | undefined;
    return (
      <div className="w6w-field">
        <span>
          {label}
          {req}
        </span>
        <ExpressionInput
          value={current}
          masked
          readOnly={readOnly}
          aria-label={label}
          onChange={(next) => onChange(param.key, next)}
        />
        {param.hint && <span className="w6w-hint">{param.hint}</span>}
      </div>
    );
  }

  // Plain text / number input for everything else.
  const inputType = param.type === "number" ? "number" : "text";
  const raw = value ?? param.default ?? "";
  // Guard against object/array values landing in a text field (they'd render as
  // "[object Object]"); show them JSON-stringified instead.
  const display = typeof raw === "object" && raw !== null ? JSON.stringify(raw) : String(raw ?? "");
  return (
    <FxField
      param={param}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      label={label}
      req={req}
    >
      <input
        type={inputType}
        value={display}
        readOnly={readOnly}
        aria-label={label}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        onChange={(e) =>
          onChange(param.key, param.type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
    </FxField>
  );
}

/**
 * Wraps a general scalar field (text/number `input`, `textarea`, or an
 * `options` dropdown) with an `fx` affordance: a small ƒx at the end of the
 * field opens the {@link ExpressionEditorModal}, so an author can bind the field
 * to a variable/expression instead of a literal. Mirrors the `secret`-param
 * path, which already renders {@link ExpressionInput}.
 *
 * The plain widget is the DEFAULT: a number/select round-trips as its original
 * scalar until the author actually SAVES an expression from the modal (gap #6).
 * The engine's `resolveWith` accepts an `ExprValue` or a literal for any `with`
 * value, so a stored expression round-trips without an engine change.
 *
 * ONE ƒx, ONE click. Plain mode renders the plain widget plus the single ƒx
 * button below, which opens the modal WITHOUT writing to the form. Expression
 * mode renders `ExpressionInput`, whose own ƒx reopens the same modal — so the
 * field never shows two ƒx controls at once.
 *
 * TWO CHROME VARIANTS, picked by the CALLER from the control it is passing:
 * `"boxed"` (default) is the text-field box above — right for any widget that
 * FILLS the box (input, textarea, select, the multiselect chip box). `"inline"`
 * is for a widget that does not: a `boolean`'s ~13px checkbox left the rest of a
 * full-width panel empty. The inline variant renders a DIFFERENT wrapper class
 * (`.w6w-fx-inline`, which simply declares no chrome) instead of over-riding
 * `.w6w-fx-wrap` with a more specific rule, and lays the row out as the review
 * asked: `<checkbox> <ƒx> <label>`, with no stacked label above it.
 */
function FxField({
  param,
  value,
  onChange,
  readOnly,
  label,
  req,
  bare,
  variant = "boxed",
  controlId,
  children,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
  label: string;
  req: string;
  /** Render only the toggle + widget (no label/hint chrome) — for compact
   *  cells such as a `vars` row value that already live inside their own grid. */
  bare?: boolean;
  /** Chrome + layout of the wrapper. See the note above: `"inline"` is for a
   *  control that does not fill a text-field box (today: a checkbox). */
  variant?: "boxed" | "inline";
  /** `id` of the control `children` renders, so the inline row's label can name
   *  it (`htmlFor`) — the label is a sibling there, not a wrapper. */
  controlId?: string;
  children: ReactNode;
}) {
  // Expression mode is DERIVED from the stored value — never a local flag.
  // Nothing turns a local boolean back off now that the value-mutating toggle is
  // gone, so it would drift: the field would read as an expression while holding
  // a plain string (or the reverse). Deriving makes control and value unable to
  // disagree BY CONSTRUCTION, and Cancel-leaves-the-field-plain falls out for
  // free — the modal's `onClose` writes nothing, so `value`, and therefore `fx`,
  // is unchanged. A value that arrives after mount (a saved test seeded into a
  // field that mounted empty) is picked up on the next render, no effect needed.
  const fx = isExprValue(value);
  // Multi-line text fields keep their newlines in expression mode too: Enter
  // inserts a literal "\n" instead of being swallowed. Same predicate the
  // textarea branch above renders on, so the two can never disagree.
  const multiline = param.type === "text" || !!param.config?.multiline;
  const [modalOpen, setModalOpen] = useState(false);
  // Picker data (vars/secrets/steps/…) — sourced exactly the way ExpressionInput
  // sources it, from the nearest ExpressionOptionsProvider.
  const exprOptions = useExpressionOptions();

  // The ƒx rides at the end of the input (an in-field decoration) rather than up
  // in the label row — so the affordance sits next to the value it governs. It
  // OPENS THE MODAL and writes nothing; the value only changes if the author
  // saves from there.
  //
  // `.w6w-fx-wrap` IS the field's box: it owns the border/background/radius and
  // the `:focus-within` ring, and the widget it holds is flattened by compound
  // selectors in styles.css — so widget + ƒx read as one box, not as a button
  // beside a field. A widget that owns a box itself (`.w6w-multiselect`, the
  // `.w6w-expr-field` inside ExpressionInput) is flattened there too.
  //
  // The inline variant applies to the PLAIN widget only: once the field holds
  // an expression it renders `ExpressionInput`, which IS a text-like control
  // that fills a box — so it goes back to the standard boxed field with its
  // label above, exactly like every other expression-bound field.
  const inline = variant === "inline" && !fx;
  const body = (
    <>
      <div className={inline ? "w6w-fx-inline" : `w6w-fx-wrap${fx ? " is-fx" : ""}`}>
        {fx ? (
          // Expression mode: ExpressionInput already carries the ONE ƒx here
          // (its own edit button), which reopens this same modal. Rendering a
          // second one would put two ƒx side by side — the bug the intake filed.
          <ExpressionInput
            value={value as ExprValue | string | undefined}
            multiline={multiline}
            readOnly={readOnly}
            aria-label={label}
            onChange={(next) => onChange(param.key, next)}
          />
        ) : (
          <>
            {children}
            {!readOnly && (
              <button
                type="button"
                className="w6w-expr-fx"
                title="Use an expression"
                aria-label={`Use an expression for ${label}`}
                onClick={() => setModalOpen(true)}
              >
                ƒx
              </button>
            )}
            {/* Inline variant: the label rides HERE, after the ƒx — it is the
                field's ONLY label (the stacked one below is not rendered). */}
            {inline && (
              <label className="w6w-fx-inline-label" htmlFor={controlId}>
                {label}
                {req}
              </label>
            )}
          </>
        )}
      </div>
      {modalOpen && (
        // The modal owns the whole round trip — it seeds itself from `value` and
        // commits through the shared template helpers in its own save. Nothing
        // is re-implemented here: this supplies the value and consumes `onSave`.
        <ExpressionEditorModal
          value={value as ExprValue | string | undefined}
          multiline={multiline}
          options={exprOptions}
          fieldLabel={label}
          onSave={(next) => onChange(param.key, next)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );

  // Bare: just the toggle + widget, no label/hint chrome (the host cell owns them).
  if (bare) return body;

  return (
    <div className="w6w-field">
      {/* Inline: the label lives INSIDE the row (above), so the stacked one is
          not rendered at all — one label per field, never two. */}
      {!inline && (
        <span>
          {label}
          {req}
        </span>
      )}
      {body}
      {param.hint && <span className="w6w-hint">{param.hint}</span>}
    </div>
  );
}

/**
 * A `json`-typed param edited through the JsonEditor. Holds its own text state
 * (seeded from the incoming value) and only pushes back to the form when the
 * text parses — an invalid draft doesn't corrupt the collected values.
 */
function JsonParamField({
  param,
  value,
  onChange,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}) {
  const seed = value ?? param.default;
  const [text, setText] = useState(() => (seed === undefined ? "" : JSON.stringify(seed, null, 2)));
  const [invalid, setInvalid] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Re-seed when the field identity changes OR the incoming value changes to
  // something other than what the current draft already represents — i.e. an
  // external load (a saved test opened into an already-mounted JSON field), not
  // the echo of the user's own valid edit. Comparing against the parsed draft
  // avoids clobbering the cursor/formatting on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is read as the draft baseline but must NOT retrigger the effect (that would reseed mid-edit); reseed is keyed on the incoming value + param identity
  useEffect(() => {
    let current: unknown;
    try {
      current = text.trim() === "" ? undefined : JSON.parse(text);
    } catch {
      current = undefined; // invalid draft — let an external value win
    }
    if (JSON.stringify(current) !== JSON.stringify(seed)) {
      setText(seed === undefined ? "" : JSON.stringify(seed, null, 2));
      setInvalid(false);
    }
  }, [seed, param.key]);

  const onEdit = (next: string) => {
    setText(next);
  };
  const onValid = (parsed: unknown) => {
    setInvalid(false);
    onChange(param.key, parsed);
  };
  const label = param.label ?? param.key;

  return (
    <div className="w6w-field">
      <span className="w6w-field-labelrow">
        <span>
          {label}
          {param.required ? " *" : ""}
        </span>
        <button
          type="button"
          className="w6w-icon-btn w6w-btn-sm"
          title="Open in full view"
          aria-label={`Open ${label} in full view`}
          onClick={() => setExpanded(true)}
        >
          {/* diagonal expand arrows on a 24×24 viewBox */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </span>
      {/* Inline: content-sized, grows with content up to maxHeight, then scrolls
          internally (so it never overlaps the next field). Full view via button. */}
      <JsonEditor
        value={text}
        onChange={onEdit}
        readOnly={readOnly}
        minHeight="34px"
        maxHeight="260px"
        aria-label={`${param.key} JSON`}
        onValidChange={onValid}
        onValidityChange={({ valid }) => setInvalid(!valid)}
      />
      {invalid && (
        <span className="w6w-hint" style={{ color: "var(--w6w-danger)" }}>
          Invalid JSON
        </span>
      )}
      {param.hint && <span className="w6w-hint">{param.hint}</span>}

      {expanded && (
        <Modal
          title={label}
          subtitle={<code>JSON</code>}
          size="wide"
          onClose={() => setExpanded(false)}
        >
          <div className="w6w-json-fullview">
            <JsonEditor
              value={text}
              onChange={onEdit}
              readOnly={readOnly}
              height="100%"
              minHeight="360px"
              aria-label={`${param.key} JSON (full view)`}
              onValidChange={onValid}
              onValidityChange={({ valid }) => setInvalid(!valid)}
            />
          </div>
          {invalid && (
            <span className="w6w-hint" style={{ color: "var(--w6w-danger)" }}>
              Invalid JSON
            </span>
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * A `multiselect` param — a Material-style chips input: the chosen options render
 * as removable chips *inside* a single input-like box, followed by a dropdown
 * (reading as placeholder text) that appends more. Value is an array of the
 * chosen option values; the dropdown only lists options not already selected.
 */
function MultiSelectField({
  param,
  value,
  onChange,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}) {
  const options = Array.isArray(param.options) ? param.options : [];
  const selected: Array<string | number> = Array.isArray(value)
    ? (value as Array<string | number>)
    : Array.isArray(param.default)
      ? (param.default as Array<string | number>)
      : [];
  const selectedKeys = new Set(selected.map(String));
  const available = options.filter((o) => !selectedKeys.has(String(o.value)));
  const labelFor = (v: string | number) =>
    options.find((o) => String(o.value) === String(v))?.label ?? String(v);

  const add = (raw: string) => {
    if (!raw || selectedKeys.has(raw)) return;
    const opt = options.find((o) => String(o.value) === raw);
    onChange(param.key, [...selected, opt ? opt.value : raw]);
  };
  const remove = (v: string | number) =>
    onChange(
      param.key,
      selected.filter((x) => String(x) !== String(v)),
    );

  const placeholder =
    typeof param.placeholder === "string" && param.placeholder ? param.placeholder : "Select…";
  const label = param.label ?? param.key;
  const req = param.required ? " *" : "";

  return (
    <FxField
      param={param}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      label={label}
      req={req}
    >
      {/* One input-like box: chips inline, then the dropdown as the trailing
          placeholder — chips appear to live inside the field's boundaries. The
          ƒx toggle (via FxField) swaps the whole box for an expression. */}
      <div className={`w6w-multiselect${readOnly ? " is-readonly" : ""}`}>
        {selected.map((v) => (
          <span className="w6w-chip" key={String(v)}>
            {labelFor(v)}
            {!readOnly && (
              <button
                type="button"
                className="w6w-chip-x"
                aria-label={`Remove ${labelFor(v)}`}
                title="Remove"
                onClick={() => remove(v)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          // Controlled to "" so it always reads as the trailing placeholder;
          // picking an option appends a chip and resets.
          <select
            className="w6w-multiselect-add"
            value=""
            disabled={available.length === 0}
            aria-label={`Add to ${param.label ?? param.key}`}
            onChange={(e) => add(e.target.value)}
          >
            <option value="">
              {available.length > 0
                ? selected.length
                  ? "Add more…"
                  : placeholder
                : "All selected"}
            </option>
            {available.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </FxField>
  );
}

/** A single input inside an `array` object-item row (placeholder = the field label). */
function ArrayItemInput({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: ActionParam;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const ph = field.placeholder ?? field.label ?? field.key;
  if (Array.isArray(field.options) && field.options.length > 0) {
    return (
      <select
        className="w6w-array-input"
        value={String(value ?? field.default ?? field.options[0]?.value ?? "")}
        disabled={readOnly}
        aria-label={field.label ?? field.key}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="w6w-array-check" title={field.label ?? field.key}>
        <input
          type="checkbox"
          checked={Boolean(value ?? field.default ?? false)}
          disabled={readOnly}
          aria-label={field.label ?? field.key}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{field.label ?? field.key}</span>
      </label>
    );
  }
  const isNumber = field.type === "number";
  return (
    <input
      className="w6w-array-input"
      type={isNumber ? "number" : "text"}
      value={String(value ?? field.default ?? "")}
      placeholder={ph}
      aria-label={field.label ?? field.key}
      readOnly={readOnly}
      onChange={(e) => onChange(isNumber ? Number(e.target.value) : e.target.value)}
    />
  );
}

/**
 * An `array`-typed param — a list control. Each row is either a single scalar
 * input (`item.type: "string" | "number"`) or an object's `fields` side by side
 * (`item.type: "object"`). "+ Add" appends a blank item; each row has an `×`.
 */
function ArrayField({
  param,
  value,
  onChange,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}) {
  const item = param.item ?? { type: "string" };
  const isObject = item.type === "object";
  const items: unknown[] = Array.isArray(value)
    ? value
    : Array.isArray(param.default)
      ? (param.default as unknown[])
      : [];
  const commit = (next: unknown[]) => onChange(param.key, next);
  const blank = (): unknown =>
    isObject
      ? Object.fromEntries((item.fields ?? []).map((f) => [f.key, f.default ?? ""]))
      : item.type === "number"
        ? 0
        : "";
  const patchAt = (idx: number, next: unknown) =>
    commit(items.map((it, j) => (j === idx ? next : it)));

  return (
    <div className="w6w-field">
      <span>
        {param.label ?? param.key}
        {param.required ? " *" : ""}
      </span>
      <div className="w6w-array">
        {items.length === 0 && <p className="w6w-muted w6w-small">None yet — add one below.</p>}
        {items.map((it, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; values are user-edited
          <div className="w6w-array-row" key={idx}>
            {isObject ? (
              <div className="w6w-array-cells">
                {(item.fields ?? []).map((f) => (
                  <ArrayItemInput
                    key={f.key}
                    field={f}
                    value={(it as Record<string, unknown>)?.[f.key]}
                    readOnly={readOnly}
                    onChange={(fv) =>
                      patchAt(idx, { ...((it as Record<string, unknown>) ?? {}), [f.key]: fv })
                    }
                  />
                ))}
              </div>
            ) : (
              <input
                className="w6w-array-input"
                type={item.type === "number" ? "number" : "text"}
                value={String(it ?? "")}
                placeholder={item.placeholder}
                readOnly={readOnly}
                onChange={(e) =>
                  patchAt(idx, item.type === "number" ? Number(e.target.value) : e.target.value)
                }
              />
            )}
            {!readOnly && (
              <button
                type="button"
                className="w6w-array-x"
                aria-label="Remove item"
                title="Remove"
                onClick={() => commit(items.filter((_, j) => j !== idx))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost w6w-btn-sm w6w-array-add"
            onClick={() => commit([...items, blank()])}
          >
            + Add
          </button>
        )}
      </div>
      {param.hint && <span className="w6w-hint">{param.hint}</span>}
    </div>
  );
}

/**
 * One typed key/value entry in a `vars` param. `type` is a real value type only:
 * `expression` is a binding *mode* (see {@link FxField}/`ExprValue`), not a value
 * type, so it is no longer offered in the dropdown. Each row value carries its own
 * ƒx toggle (via {@link FxField} in `bare` mode), so any declared type can be bound
 * to an expression; a legacy row persisted with `type:"expression"` (an `ExprValue`)
 * still round-trips — FxField opens it in expression mode from the stored value.
 */
export interface DataVar {
  key: string;
  type: "string" | "number" | "boolean" | "json";
  value: unknown;
}

const DATA_VAR_TYPES: DataVar["type"][] = ["string", "number", "boolean", "json"];

/** Coerce a text input into the variable's declared type (best-effort). */
function coerceVarValue(type: DataVar["type"], raw: string): unknown {
  if (type === "number") {
    if (raw.trim() === "") return "";
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === "boolean") return raw === "true";
  if (type === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Render a stored variable value back into an editable string. */
function varValueToText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * A `vars`-typed param: a dynamic table of typed key/value variables. The value
 * is an array of `{ key, type, value }`, collected into the step's `with`.
 */
function VarsField({
  param,
  value,
  onChange,
  readOnly,
}: {
  param: ActionParam;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}) {
  const vars: DataVar[] = Array.isArray(value)
    ? (value as DataVar[])
    : Array.isArray(param.default)
      ? (param.default as DataVar[])
      : [];
  const commit = (next: DataVar[]) => onChange(param.key, next);
  const patch = (i: number, p: Partial<DataVar>) =>
    commit(vars.map((v, idx) => (idx === i ? { ...v, ...p } : v)));

  return (
    <div className="w6w-field">
      <span>
        {param.label ?? param.key}
        {param.required ? " *" : ""}
      </span>
      <div className="w6w-stack">
        {vars.length === 0 && (
          <p className="w6w-muted w6w-small">No variables yet — add one below.</p>
        )}
        {vars.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; keys/values are user-edited
          <div className="w6w-datavar-row" key={i}>
            <input
              type="text"
              placeholder="key"
              value={v.key}
              readOnly={readOnly}
              onChange={(e) => patch(i, { key: e.target.value })}
            />
            <select
              value={v.type}
              disabled={readOnly}
              onChange={(e) => {
                const type = e.target.value as DataVar["type"];
                patch(i, { type, value: coerceVarValue(type, varValueToText(v.value)) });
              }}
            >
              {DATA_VAR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {/* Per-value ƒx toggle: any declared type can be bound to an
                expression (stored as an `{type:"expr"}` envelope, resolved
                against the run scope before the data node runs). A legacy
                `type:"expression"` row (an ExprValue) reopens in fx mode from
                its stored value. `bare` drops the field chrome so the widget
                fits the row's grid cell. */}
            <FxField
              bare
              param={param}
              value={v.value}
              onChange={(_key, next) => patch(i, { value: next })}
              readOnly={readOnly}
              label={v.key || "value"}
              req=""
            >
              {v.type === "boolean" ? (
                <select
                  value={v.value === true ? "true" : "false"}
                  disabled={readOnly}
                  onChange={(e) => patch(i, { value: e.target.value === "true" })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={v.type === "number" ? "number" : "text"}
                  placeholder="value"
                  value={varValueToText(v.value)}
                  readOnly={readOnly}
                  onChange={(e) => patch(i, { value: coerceVarValue(v.type, e.target.value) })}
                />
              )}
            </FxField>
            {!readOnly && (
              <button
                type="button"
                className="w6w-btn w6w-btn-ghost"
                aria-label={`Remove variable ${v.key || i + 1}`}
                title="Remove"
                onClick={() => commit(vars.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost"
            onClick={() => commit([...vars, { key: "", type: "string", value: "" }])}
          >
            + Add variable
          </button>
        )}
      </div>
      {param.hint && <span className="w6w-hint">{param.hint}</span>}
    </div>
  );
}
