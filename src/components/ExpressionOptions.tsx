/**
 * Context that supplies the var/secret PICKER data to every `ExpressionInput`
 * under it (task 3.2). The editor tree is deep — a step's params render several
 * layers below the editor root (`WorkflowFlowEditor → StepEditModal/StepBuilder
 * → ParamsForm → ParamField → ExpressionInput`), so threading names as props
 * through each layer would be noisy. A context keeps the wiring at the two ends:
 * the editor provides the names once, the input consumes them where it renders.
 *
 * The data pattern stays intact — ui components remain pure (they never fetch);
 * the host (studio) fetches `/vars` + `/vault` and hands the NAMES in via the
 * editor's `exprOptions` prop, which feeds this provider. Only names/refs ever
 * cross this boundary — secret plaintext never reaches the client.
 *
 * ## The scope is PROGRESSIVE, and that is the point
 *
 * `ExpressionOptionsProvider` **layers over** whatever it inherits rather than
 * replacing it, so scope is assembled by the tree instead of by one exhaustive
 * object at each call site:
 *
 * ```
 *   app shell   ── vars · secrets · documents · sampleValues · sealSecret · create*
 *     └ page    ── + inputs        (a Function's / Endpoint's declared input keys)
 *         └ region ── + steps      (the workflow state leading to one step)
 * ```
 *
 * Two properties fall out of that, and both are requirements rather than
 * conveniences:
 *
 *   1. **Position, not plumbing, decides scope.** An `ExpressionInput` rendered
 *      anywhere under the page — a modal, a mapping row, a nested card — sees
 *      the same rail, because it inherits it. Before this, scope travelled as an
 *      `exprOptions` prop and a field the prop had not been threaded to opened
 *      the editor with an empty rail: the `ƒx` toggles on an Implementation
 *      card's mapping rows offered nothing, while the very same editor reached
 *      through the card's "Change" button offered everything.
 *   2. **Narrower scope cannot leak outward.** `inputs` added by a Function page
 *      is invisible to a sibling route and to anything above the provider,
 *      because React context only flows down. Navigating away drops it with the
 *      subtree — no teardown to remember and no chance of one page's `inputs.*`
 *      appearing in another's picker.
 *
 * Merging is **shallow, per key**: a key present in `value` wins outright (a
 * provider narrowing `vars` replaces the inherited list, it does not union with
 * it), and a key absent from `value` is inherited. To *remove* an inherited key
 * for a subtree, pass it explicitly as `undefined` — `{ inputs: undefined }` —
 * which is a present key and therefore wins.
 */
import { type ReactNode, createContext, useContext, useMemo } from "react";
import type { SecretValue } from "../types.ts";

/** An upstream step whose output this field can reference (`steps.<id>.output`). */
export interface ExpressionStepSource {
  /** Step id — the key under `steps` in the run scope. */
  id: string;
  /** Human label (defaults to the id). */
  label?: string;
  /**
   * The step's **declared** output field keys, when it declares any (today: a
   * trigger's configured `fields`). Each entry feeds exactly one ref —
   * `steps.<id>.output.<key>` — which is the canonical form the engine resolves
   * (`RunScope.steps`; `core/rfcs/workflow.md` §"Expressions", `core/rfcs/node-types.md`
   * "Executing a trigger node yields the run's start payload … which downstream
   * nodes read as `steps.<triggerId>.output`").
   *
   * `key` is carried **verbatim**: a display-shortened key would build a ref
   * that renders fine in the editor and evaluates to empty at run time, with no
   * error. `label` is for display only and must never be substituted into a ref.
   *
   * **Omitted** (not `[]`) when the step declares no outputs, so a consumer can
   * tell "nothing declared" from "declared none" without a special case.
   */
  outputs?: { key: string; label?: string }[];
}

/**
 * A document contributing pickable refs (`documents.<key>`, and one
 * `documents.<key>.<field>` per top-level field when it qualifies).
 *
 * A document contributes field sub-entries **iff**: `doc.format === "json"`
 * AND `JSON.parse(doc.content)` succeeds into a plain object, OR
 * `doc.format === "yaml"` AND npm `yaml`'s `parse(doc.content)` succeeds into
 * a plain object — where *plain object* means
 * `typeof v === "object" && v !== null && !Array.isArray(v)`. This mirrors
 * the engine's own gate: `documentsSeed`
 * (`packages/server/packages/api/run-seed.ts`, read-only, out of scope) is the
 * authority for each format — `format === "json"` or `format === "yaml"`,
 * then a `try/catch` parse, falling back to the raw content string on either
 * a non-matching format or a throw. `text`/`markdown`/`html` documents, and a
 * `json`/`yaml` document whose parse throws or yields a non-plain-object
 * (array/scalar), are excluded — offering a field ref outside this gate would
 * fail at run time with `render_ref_unresolved`, because the run scope itself
 * never parsed that document into an object.
 *
 * The two parsers (`@std/yaml` server-side, npm `yaml` here) are not
 * identical for every input — they diverge on tab-indented content and on an
 * unresolvable custom tag, both accepted, tested debt (D-3) — but agree on
 * everything else, including a plain JSON object (JSON is a subset of YAML).
 */
export interface ExpressionDocumentSource {
  /** Document key — the key under `documents` in the run scope. */
  key: string;
  /**
   * The document's top-level field keys, when the gate above holds. Each
   * entry feeds exactly one ref — `documents.<key>.<field>` — with `key`
   * carried **verbatim**: a display-shortened key would build a ref that
   * renders fine in the editor and evaluates to empty at run time, with no
   * error.
   *
   * **Omitted** (not `[]`) when the document contributes no fields, so a
   * consumer can tell "nothing declared" from "declared none" without a
   * special case — mirrors {@link ExpressionStepSource.outputs}'s own rule.
   */
  fields?: { key: string }[];
}

/** Known variable/secret names offered in an ExpressionInput's insert menu. */
export interface ExpressionOptions {
  vars?: string[];
  secrets?: string[];
  /**
   * Function/run input keys in scope (`inputs.<name>`). Present when the field
   * is edited inside a Function (the engine resolves these from `RunScope.inputs`);
   * omitted for a standalone field.
   */
  inputs?: string[];
  /**
   * Documents in scope (`documents.<key>`, plus `documents.<key>.<field>` for
   * each document that qualifies — see {@link ExpressionDocumentSource}). A
   * store-independent affordance: whatever the host passes is offered as
   * insertable chips. Omitted when no documents are available.
   */
  documents?: ExpressionDocumentSource[];
  /**
   * The workflow state leading to this step: upstream steps whose output is in
   * scope (`steps.<id>.output`). Present only in a workflow context; omitted for
   * a standalone field.
   */
  steps?: ExpressionStepSource[];
  /** Whether a trigger event is in scope (`trigger.event`). */
  hasTrigger?: boolean;
  /**
   * Design-time sample values the Result preview substitutes for known refs,
   * keyed by FULL ref (`"vars.from_email"`, `"documents.test"`). Seeded by the
   * host from the project's real vars/documents so the preview shows actual
   * values instead of the raw `{{ ref }}` template. Optional — a user-typed
   * Sample value still overrides, and unknown refs keep the raw fallback.
   */
  sampleValues?: Record<string, unknown>;
  /**
   * Seal a typed secret value into an at-rest `SecretValue` envelope via the
   * host (the client has no key). Provided by studio (`POST /vault/seal`); when
   * present, a secret-typed field encrypts on blur so its clear text never
   * lands in the workflow/config JSON. Absent → the value stays a plain string
   * and the server encrypts it on receive instead.
   */
  sealSecret?: (value: string) => Promise<SecretValue>;
  /**
   * Create a new named variable via the host (`POST /vars`-shaped: the host
   * persists it, `ui` never fetches). Powers the rail's "+ Add" control next
   * to the Variables group label. Absent ⇒ the control is not rendered.
   */
  createVar?: (input: { name: string; value: string; description?: string }) => Promise<void>;
  /**
   * Create a new named secret via the host (`POST /vault`-shaped, plaintext
   * value — the server encrypts it, `ui` never sees a key). Powers the rail's
   * "+ Add" control next to the Secrets group label. Absent ⇒ the control is
   * not rendered.
   */
  createSecret?: (input: { name: string; value: string; description?: string }) => Promise<void>;
}

const ExpressionOptionsCtx = createContext<ExpressionOptions>({});

export interface ExpressionOptionsProviderProps {
  /**
   * The scope this level CONTRIBUTES — not the whole scope. Shallow-merged over
   * whatever is inherited (see the module doc): keys here win, keys absent are
   * inherited, and an explicit `undefined` removes an inherited key for this
   * subtree.
   */
  value: ExpressionOptions;
  children: ReactNode;
}

/**
 * Contribute expression scope to every `ExpressionInput` below.
 *
 * Layers over the inherited scope rather than replacing it, so an app shell can
 * provide vars/secrets/documents once and a page can add its `inputs` without
 * restating them — and without a field somewhere in the page missing the rail
 * because a prop was not threaded to it. See the module doc for the model.
 */
export function ExpressionOptionsProvider({ value, children }: ExpressionOptionsProviderProps) {
  const inherited = useContext(ExpressionOptionsCtx);
  // Memoised on the two inputs: a fresh object every render would re-render
  // every consumer below on every parent render, which on the workflow editor
  // is a repaint of each chip rail.
  const merged = useMemo(() => ({ ...inherited, ...value }), [inherited, value]);
  return <ExpressionOptionsCtx.Provider value={merged}>{children}</ExpressionOptionsCtx.Provider>;
}

/**
 * The scope in effect here — every contributing provider above, merged.
 *
 * Empty by default so a standalone `ExpressionInput` (no provider) still works
 * — authors just type names by hand.
 */
export function useExpressionOptions(): ExpressionOptions {
  return useContext(ExpressionOptionsCtx);
}
