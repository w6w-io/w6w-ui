/**
 * Minimal Workflow shape the flow editor operates on. Deliberately a subset of
 * `@w6w/workflow-types` so the ui lib doesn't pin partners to a specific engine
 * package version — consumers who already have `Workflow` from
 * `@w6w/workflow-types` are structurally compatible.
 */

export interface FlowStep {
  id: string;
  uses: { app: string; action: string; connection?: string | null };
  /**
   * Declared connection-port cardinality for this step (see core
   * `rfcs/node-types.md` · Ports & cardinality). Omitted ⇒ `{ in: 1, out: 1 }`.
   * A persisted value wins over the node's default — `in > 1` opts the step into
   * accepting multiple inbound edges (e.g. a flow-control aggregator joining
   * several upstream branches).
   */
  ports?: NodePorts;
  with?: Record<string, unknown>;
  retry?: {
    maxAttempts: number;
    backoff?: "fixed" | "exponential";
    delayMs?: number;
  };
  /**
   * What to do when this step errors:
   * - `fail` — stop the run (default)
   * - `continue` — swallow the error and keep going
   * - `continue-record` — keep going, but record the error into the run's end state
   */
  onError?: "fail" | "continue" | "continue-record";
  /** Free-form author notes for this step. Not executed. */
  notes?: string;
  /**
   * Authoring-time canvas coordinate for this step, in this editor's own
   * coordinate space (core `rfcs/workflow.md` · "Amendment — 2026-07-29:
   * authoring presentation (`Step.position`, `Workflow.settings`)" — the spec
   * pins no unit, origin or grid). Declarative only: the engine ignores it
   * exactly as it ignores `notes`.
   *
   * **Omitted ⇒ the editor computes a layout** from the graph alone, exactly as
   * before this field existed, so it is additive and backward-compatible.
   * Partial coverage is valid: `workflowToFlow` places the steps that declare a
   * `position` and computes a slot for the rest.
   *
   * Rename-safe by construction — the coordinate travels *with* the step, so
   * there is no workflow-level `id → {x,y}` map to fix up on rename (D-I0-2).
   *
   * Mirrors `Step.position` in `@w6w/workflow-types` by hand — see the header
   * note: these types are deliberately a structural subset with no compiler
   * tie, so the spelling here must stay identical to the engine's.
   */
  position?: { x: number; y: number };
}

export interface FlowEdge {
  from: string;
  to: string;
  /**
   * Which outcome of the `from` step this edge carries (core
   * `rfcs/workflow.md` · "Amendment — 2026-07-29: failure-conditioned edges
   * (`Edge.when`)"). **Omitted ⇒ `"success"`**, so every pre-existing edge is a
   * success edge and needs no migration.
   * - `"success"` — activates when `from` succeeds. Per the house
   *   omit-the-default idiom it is written as **absent**, never spelled out:
   *   this editor emits no `when` for a success edge, which is what keeps an
   *   untouched definition byte-identical across a load/save cycle.
   * - `"error"` — activates when `from` fails, and overrides that step's
   *   `onError`.
   *
   * Mirrors `Edge.when` in `@w6w/workflow-types` by hand — see the header note:
   * these types are deliberately a structural subset, with no compiler tie, so
   * the spelling here must stay identical to the engine's.
   */
  when?: "success" | "error";
}

/**
 * The React Flow presentation for an edge lane — **the one place** the error
 * look is spelled out.
 *
 * Two callers need it and they run at different times: `workflowToFlow` stamps a
 * *stored* edge on load, and `setEdgeWhen` (`flow-connect.ts`) stamps an edge the
 * author re-lanes **live**, before any save. Spelled out twice, the two drift and
 * a freshly marked error edge stops looking like a reloaded one. The className is
 * what `styles.css`'s `.w6w-edge-error` block paints from `--w6w-danger`; no
 * custom edge component is involved (D-T1-7).
 *
 * A `"success"`/absent lane returns an **empty object** — not `{ className: "" }` —
 * so a success edge carries neither key and a definition round-trips unchanged.
 * That makes it a trap for a *re-laning* caller: spreading `{}` over an edge that
 * already carries the error class leaves the class in place, so `setEdgeWhen`
 * assigns both keys explicitly rather than spreading.
 */
export function edgeVisuals(when: "success" | "error" | undefined): {
  className?: string;
  label?: string;
} {
  return when === "error" ? { className: "w6w-edge-error", label: "on error" } : {};
}

export interface FlowWorkflow {
  manifestVersion: string;
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  variables?: Array<{ key: string; type?: string; required?: boolean; default?: unknown }>;
  steps: FlowStep[];
  edges?: FlowEdge[];
  /**
   * Authoring-time presentation and preferences for this workflow (core
   * `rfcs/workflow.md` · "Amendment — 2026-07-29: authoring presentation
   * (`Step.position`, `Workflow.settings`)"). Declarative only — the engine
   * ignores it, exactly like `FlowStep.notes` and `FlowStep.position`.
   * `viewport` sits *inside* `settings` deliberately, so exactly one new
   * top-level key enters the portable workflow document. `settings` is itself
   * optional; when the object is absent every member below still takes its own
   * default.
   *
   * ⚠️ **`autoSave` and `savePosition` default to `true` when omitted.** That is
   * *deliberately unlike* the `ports`/`onError` rule ("omitted reproduces the
   * status quo") — here it does not. Read them as `?? true` / `!== false`, never
   * `?? false` and never `=== true`. The consequence, stated plainly: **a
   * workflow that has never been saved by the new editor starts persisting step
   * coordinates the first time it is saved.** That is intended (the product
   * requires both features on by default); only an explicit `false` turns one
   * off.
   *
   * HITL-6 asked whether a workflow's arrangement and its auto-save preference
   * belong to *the workflow* or to *the person looking at it*; the amendment
   * takes the **workflow** answer, so everyone who opens a workflow sees the
   * same arrangement. HITL-6 is still open — a viewer-owned answer would move
   * these fields out of the document and re-contract this shape.
   *
   * Mirrors `Workflow.settings` in `@w6w/workflow-types` by hand (structural
   * subset, no compiler tie — the spelling must stay identical).
   */
  settings?: {
    /**
     * Whether an authoring tool persists edits without an explicit save action.
     * Omitted ⇒ **true** — auto-save is ON. Not read by this module; the editor
     * and its host own it (T3.3.2 / T4.1.x).
     */
    autoSave?: boolean;
    /**
     * Whether an authoring tool persists step coordinates (`FlowStep.position`)
     * and `settings.viewport` when it saves. Omitted ⇒ **true** — positions ARE
     * persisted. When explicitly `false`, `flowToWorkflow` writes no `position`;
     * any value already stored is **left as it is, never erased**.
     */
    savePosition?: boolean;
    /**
     * The camera position the author last left the canvas at, so reopening the
     * workflow restores the view. **No default** — a workflow with no `viewport`
     * opens at whatever view the editor computes, exactly as today. Written by
     * the component (T3.3.2), not by `flowToWorkflow`, whose signature cannot
     * see a viewport.
     */
    viewport?: { x: number; y: number; zoom: number };
  };
}

import type { ActionParam } from "./types.ts";

// ── Internal pseudo-app nodes (see core rfcs/node-types.md) ─────────────────
//
// A node's kind + processor are derived from `uses.app`. The reserved `@w6w/*`
// namespace holds internal pseudo-apps the platform runs itself: `@w6w/control`
// (engine-native flow control), `@w6w/script`/`@w6w/data` (host-run compute),
// and `@w6w/trigger` (the entry node). They render as pill nodes and configure
// through the same dynamic form as apps.

/** Reserved namespace for internal pseudo-apps. */
export const INTERNAL_APP_PREFIX = "@w6w/";
/** Engine-native flow control (if/foreach/parallel/wait). */
export const CONTROL_APP = "@w6w/control";
/** Host-run inline JS. */
export const SCRIPT_APP = "@w6w/script";
/** Host-run typed key/value data. */
export const DATA_APP = "@w6w/data";
/** The workflow's entry/trigger node. */
export const TRIGGER_APP = "@w6w/trigger";
/** Host-run outbound HTTP(S) request. */
export const HTTP_APP = "@w6w/http";
/** Inbound HTTP(S) webhook trigger (entry node; provisions a receive URL). */
export const WEBHOOK_APP = "@w6w/webhook";
/** Time-based scheduler trigger (entry node; fires the workflow on a schedule). */
export const SCHEDULER_APP = "@w6w/scheduler";
/** "Respond to Webhook" — shapes the HTTP response for `responseMode: responseNode`. */
export const RESPOND_APP = "@w6w/respond";
/**
 * Sub-workflow / Function caller (core rfcs/node-types.md · F-3). The host runs
 * this node itself: it resolves `with.target` to a project-scoped `Callable` (a
 * Function or a Workflow) and invokes it through `ctx.invokeCallable`, honoring
 * the per-node `with.wait` flag. The engine never loads the target.
 */
export const CALL_APP = "@w6w/call";
/**
 * Read a stored JSON document by key (core rfcs/node-types.md · F-3 amendment,
 * "Reserved internal pseudo-app"). Host node: `runInternalNode` short-circuits
 * this id before the registry loads a module — the run's own project is bound
 * host-side, so there is no `project` param (C-6).
 */
export const DOCUMENT_APP = "@w6w/document";
/**
 * Compile a Handlebars `template` string against a resolved `values` object
 * (core rfcs/node-types.md · F-3 amendment, "the `@w6w/template` host node").
 * Host node: `runInternalNode` short-circuits this id before the registry
 * loads a module — it needs no privileged host resource (no DB, no
 * tenant/project scope), and runs host-side only because the template
 * compiles to a JS function, the same risk shape `@w6w/script` has.
 */
export const TEMPLATE_APP = "@w6w/template";

/** True when `app` is a reserved internal pseudo-app id (`@w6w/*`). */
export function isInternalApp(app: string): boolean {
  return app.startsWith(INTERNAL_APP_PREFIX);
}

/** True when a node is an engine-native flow-control node (can't run standalone). */
export function isControlApp(app: string): boolean {
  return app === CONTROL_APP;
}

/**
 * Whether a step is an entry/trigger node — the one predicate, shared by the
 * step editor's Test tab and the canvas ▶ collect phase. A trigger's configured
 * `fields` are *definitions*, so both surfaces project them into a fillable form
 * and send the filled values as `{ input }` rather than running the raw config.
 */
export function isTriggerApp(app: string): boolean {
  return app === TRIGGER_APP || app === WEBHOOK_APP || app === SCHEDULER_APP;
}

/** A palette entry for an internal node: its id, label, group, and config schema. */
export interface InternalNodeDef {
  app: string;
  action: string;
  label: string;
  /**
   * Human display name (mirrors an app's `displayName`). Defaults conceptually
   * to `label`; kept explicit so internal pseudo-apps carry the same info an app
   * does. Shown wherever an app's name would be.
   */
  displayName: string;
  group: "trigger" | "control" | "compute" | "request";
  /**
   * Inline SVG *inner* markup (paths / circles / polylines) for this primitive's
   * glyph — internal pseudo-apps have no icon asset dir, so the glyph is bundled
   * here. Drawn on a 24×24 `viewBox`, stroked with `currentColor` (theme-aware),
   * so both app nodes and internal nodes display a consistent icon on the canvas.
   */
  icon: string;
  /**
   * Connection ports: how many inbound (entry) and outbound (exit) connections
   * this node accepts. A port is the ability to receive/emit a connection —
   * rendered as a React Flow Handle. Defaults to one of each (`{ in: 1, out: 1 }`)
   * when omitted; a trigger overrides to `{ in: 0, out: 1 }` (nothing flows into
   * the entry node). Fixed for now — not user-editable.
   */
  ports?: NodePorts;
  /** Config schema (same `ActionParam[]` shape apps declare) rendered by ParamsForm. */
  params: ActionParam[];
}

/** Inbound (entry) and outbound (exit) connection-port counts for a node. */
export interface NodePorts {
  in: number;
  out: number;
}

/** The default a node gets when it declares no explicit `ports`: 1 in, 1 out. */
export const DEFAULT_NODE_PORTS: NodePorts = { in: 1, out: 1 };

/**
 * Resolve a node's connection ports. Internal nodes may declare `ports`
 * (triggers do, to drop the entry port); everything else — including every
 * external app step — gets the `{ in: 1, out: 1 }` default.
 */
export function nodePorts(app: string, action: string): NodePorts {
  return internalNodeDef(app, action)?.ports ?? DEFAULT_NODE_PORTS;
}

/**
 * Resolve a *step's* connection ports. A persisted `step.ports` wins — an author
 * may have opted the step into a non-default cardinality (e.g. a fan-in
 * aggregator that joins several upstream branches). Otherwise fall back to the
 * node's declared default via `nodePorts(app, action)` (internal nodes may drop
 * the entry port), and finally to `{ in: 1, out: 1 }` (`DEFAULT_NODE_PORTS`).
 *
 * This is the step-aware counterpart to `nodePorts`, which keys only off
 * `(app, action)` and so forces every external app step to the default.
 */
export function nodePortsForStep(step: FlowStep): NodePorts {
  return step.ports ?? nodePorts(step.uses.app, step.uses.action);
}

// Feather-style 24×24 stroked glyphs (inner markup only; the card supplies the
// <svg> wrapper). One clean, recognizable glyph per internal primitive.
/** Lightning bolt — a trigger firing. */
const ICON_TRIGGER = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />';
/** Git-branch — a conditional split. */
const ICON_IF =
  '<line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />';
/** Repeat arrows — iterate over items. */
const ICON_FOREACH =
  '<polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />';
/** Concurrent lanes — parallel execution. */
const ICON_PARALLEL =
  '<line x1="6" y1="4" x2="6" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="18" y1="4" x2="18" y2="20" />';
/** Clock — a timed wait. */
const ICON_WAIT = '<circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />';
/** Angle brackets — inline code. */
const ICON_SCHEDULER =
  '<rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />' +
  '<line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />' +
  '<polyline points="12 13 12 16 14 17" />';
const ICON_SCRIPT = '<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />';
/** Database cylinder — typed data. */
const ICON_DATA =
  '<ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />';
/** Globe — an outbound HTTP(S) request. */
const ICON_HTTP =
  '<circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />';
/** Connected nodes — an inbound webhook. */
const ICON_WEBHOOK =
  '<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />';
/** Reply arrow — respond to the caller. */
const ICON_RESPOND = '<polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />';
/** Funnel — many inbound branches joined into one. */
const ICON_AGGREGATE = '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />';
/** External-link box — delegate out to another Workflow / Function. */
const ICON_CALL =
  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />';
/** Dog-eared page with lines — a stored JSON document. */
const ICON_DOCUMENT =
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />';
/** Braces — a compiled placeholder template. */
const ICON_TEMPLATE =
  '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" /><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />';

/** The built-in internal nodes, in palette order. */
export const INTERNAL_NODES: InternalNodeDef[] = [
  {
    app: TRIGGER_APP,
    action: "manual",
    label: "Manual trigger",
    displayName: "Manual trigger",
    group: "trigger",
    icon: ICON_TRIGGER,
    ports: { in: 0, out: 1 },
    params: [
      {
        key: "fields",
        label: "Fields",
        type: "array",
        default: [],
        hint: 'The fields this trigger emits into the run. Reference them downstream as {"$": "steps.<trigger>.output.<key>"}.',
        item: {
          type: "object",
          fields: [
            { key: "key", label: "Key", type: "string", placeholder: "e.g. email" },
            {
              key: "type",
              label: "Type",
              type: "select",
              default: "string",
              options: [
                { value: "string", label: "String" },
                { value: "number", label: "Number" },
                { value: "boolean", label: "Boolean" },
                { value: "json", label: "JSON" },
              ],
            },
            { key: "default", label: "Default", type: "string", placeholder: "optional" },
            { key: "required", label: "Required", type: "boolean", default: false },
          ],
        },
      },
    ],
  },
  {
    app: WEBHOOK_APP,
    action: "webhook",
    label: "Webhook",
    displayName: "Webhook",
    group: "trigger",
    icon: ICON_WEBHOOK,
    ports: { in: 0, out: 1 },
    params: [
      {
        key: "methods",
        label: "HTTP Methods",
        type: "multiselect",
        required: true,
        default: ["POST"],
        hint: "Which HTTP methods this webhook accepts.",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
          { value: "HEAD", label: "HEAD" },
        ],
      },
      {
        key: "auth",
        label: "Authentication",
        type: "select",
        default: "none",
        hint: "How incoming requests are authenticated.",
        options: [
          { value: "none", label: "None" },
          { value: "basic", label: "Basic auth" },
          { value: "header", label: "Header auth" },
          { value: "jwt", label: "JWT (HMAC)" },
        ],
      },
      {
        key: "basicUser",
        label: "Username",
        type: "string",
        row: "basic-auth",
        showIf: { field: "auth", equals: "basic" },
      },
      {
        key: "basicPassword",
        label: "Password",
        type: "secret",
        row: "basic-auth",
        showIf: { field: "auth", equals: "basic" },
      },
      {
        key: "headerName",
        label: "Header name",
        type: "string",
        row: "header-auth",
        placeholder: "e.g. X-Api-Key",
        showIf: { field: "auth", equals: "header" },
      },
      {
        key: "headerValue",
        label: "Header value",
        type: "secret",
        row: "header-auth",
        showIf: { field: "auth", equals: "header" },
      },
      {
        key: "jwtSecret",
        label: "JWT secret",
        type: "secret",
        showIf: { field: "auth", equals: "jwt" },
      },
      {
        key: "responseMode",
        label: "Respond",
        type: "select",
        default: "onReceived",
        hint: "When and how to respond to the caller.",
        options: [
          { value: "onReceived", label: "Immediately (ASAP)" },
          { value: "lastNode", label: "When the run finishes" },
          { value: "responseNode", label: "Using a Response node" },
          { value: "streaming", label: "Streaming" },
        ],
      },
      {
        key: "responseCode",
        label: "Response status code",
        type: "number",
        default: 200,
        showIf: { field: "responseMode", notIn: ["responseNode"] },
      },
      {
        key: "responseData",
        label: "Response body (immediate)",
        type: "text",
        hint: 'Body for "Immediately" responses. Empty = { "message": "Workflow was started" }.',
        showIf: { field: "responseMode", equals: "onReceived" },
      },
      { key: "rawBody", label: "Raw body", type: "boolean", default: false, advanced: true },
      { key: "ignoreBots", label: "Ignore bots", type: "boolean", default: false, advanced: true },
      {
        key: "ipAllowList",
        label: "IP allow list",
        type: "array",
        advanced: true,
        item: { type: "string", placeholder: "e.g. 203.0.113.4" },
        hint: "Client IPs allowed to call this webhook. Empty = allow all.",
      },
      { key: "binaryPropertyName", label: "Binary field name", type: "string", advanced: true },
      { key: "cors", label: "CORS allowed origin", type: "string", advanced: true },
      {
        key: "responseHeaders",
        label: "Response headers",
        type: "array",
        default: [],
        advanced: true,
        item: {
          type: "object",
          fields: [
            { key: "name", label: "Name", type: "string" },
            { key: "value", label: "Value", type: "string" },
          ],
        },
      },
    ],
  },
  {
    app: SCHEDULER_APP,
    action: "schedule",
    label: "Schedule",
    displayName: "Scheduler",
    group: "trigger",
    icon: ICON_SCHEDULER,
    // An entry node: nothing flows in, one branch flows out.
    ports: { in: 0, out: 1 },
    params: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        required: true,
        default: "cron",
        hint: "How the schedule fires.",
        options: [
          { value: "once", label: "Once" },
          { value: "cron", label: "Cron" },
          { value: "interval", label: "Interval" },
        ],
      },
      {
        key: "cron",
        label: "Cron expression",
        type: "string",
        placeholder: "e.g. 0 9 * * 1-5",
        showIf: { field: "mode", equals: "cron" },
      },
      {
        key: "runAt",
        label: "Run at",
        type: "string",
        placeholder: "e.g. 2026-01-01T09:00:00Z",
        showIf: { field: "mode", equals: "once" },
      },
      {
        key: "intervalSeconds",
        label: "Interval (seconds)",
        type: "number",
        showIf: { field: "mode", equals: "interval" },
      },
      {
        key: "timezone",
        label: "Timezone",
        type: "string",
        default: "UTC",
        advanced: true,
      },
    ],
  },
  {
    app: CONTROL_APP,
    action: "if",
    label: "If",
    displayName: "If",
    group: "control",
    icon: ICON_IF,
    params: [
      {
        key: "condition",
        type: "json",
        label: "Condition",
        required: true,
        default: true,
        hint: 'A boolean, or an expression binding like { "$": "steps.x.output.ok" }.',
      },
    ],
  },
  {
    app: CONTROL_APP,
    action: "foreach",
    label: "For each",
    displayName: "For each",
    group: "control",
    icon: ICON_FOREACH,
    params: [
      {
        key: "items",
        type: "json",
        label: "Items",
        required: true,
        default: [],
        hint: "An array to iterate, or an expression binding to one.",
      },
    ],
  },
  {
    app: CONTROL_APP,
    action: "parallel",
    label: "Parallel",
    displayName: "Parallel",
    group: "control",
    icon: ICON_PARALLEL,
    params: [],
  },
  {
    app: CONTROL_APP,
    action: "wait",
    label: "Wait",
    displayName: "Wait",
    group: "control",
    icon: ICON_WAIT,
    params: [
      {
        key: "duration",
        type: "string",
        label: "Duration",
        required: true,
        default: "PT1S",
        hint: "ISO-8601 duration, e.g. PT30S or PT5M. (Or set `until` to an ISO timestamp.)",
      },
    ],
  },
  {
    app: SCRIPT_APP,
    action: "run",
    label: "Run script",
    displayName: "Run script",
    group: "compute",
    icon: ICON_SCRIPT,
    params: [
      {
        key: "code",
        type: "code",
        label: "Script",
        required: true,
        default: "// Runs as a function body. Return the step's output.\nreturn input;",
        hint: "JavaScript function body; return the step's output.",
      },
    ],
  },
  {
    app: TEMPLATE_APP,
    action: "render",
    label: "Render template",
    displayName: "Template",
    group: "compute",
    icon: ICON_TEMPLATE,
    params: [
      {
        key: "template",
        label: "Template",
        type: "text",
        required: true,
        hint:
          "Handlebars template. Placeholder names are workflow-agnostic — bind them below. " +
          "{{name}} is HTML-escaped; use {{{name}}} for raw output.",
      },
      {
        // The manifest declares `values` as `type: "json"` — `"vars"` is a
        // UI-only type, not a member of core's canonical `ParamType`, exactly
        // the same divergence `data/index.ts:10-13` explains for `@w6w/data`'s
        // own `vars` param. `required` surfaces the table in the form directly.
        key: "values",
        label: "Values",
        type: "vars",
        required: true,
        default: [],
        hint:
          'A typed key/value array: [{ "key": "data", "type": "json", "value": ... }]. ' +
          "Each key becomes a top-level placeholder root.",
      },
    ],
  },
  {
    app: DATA_APP,
    action: "set",
    label: "Data",
    displayName: "Data set",
    group: "compute",
    icon: ICON_DATA,
    params: [
      {
        // `required` surfaces the table in the form directly (not hidden under
        // the optional disclosure). The value may be an empty array — a Data
        // node with no vars yet is valid.
        key: "vars",
        type: "vars",
        label: "Variables",
        required: true,
        default: [],
        hint: "Typed key/value variables for downstream steps to reference.",
      },
    ],
  },
  {
    app: HTTP_APP,
    action: "request",
    label: "HTTP request",
    displayName: "HTTP",
    group: "request",
    icon: ICON_HTTP,
    params: [
      {
        key: "method",
        type: "string",
        label: "Method",
        required: true,
        default: "GET",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
        ],
        hint: "HTTP method for the request.",
      },
      {
        key: "url",
        type: "string",
        label: "URL",
        required: true,
        default: "",
        hint: "Full request URL, e.g. https://api.example.com/v1/things.",
      },
      {
        key: "headers",
        type: "json",
        label: "Headers",
        default: {},
        hint: "Object of header name → value.",
      },
      {
        key: "query",
        type: "json",
        label: "Query params",
        default: {},
        hint: "Object of query-string name → value, appended to the URL.",
      },
      {
        key: "body",
        type: "text",
        label: "Body",
        default: "",
        hint: "Request body (raw text or a JSON string). Ignored for GET/HEAD.",
      },
    ],
  },
  {
    app: RESPOND_APP,
    action: "respond",
    label: "Respond to Webhook",
    displayName: "Respond to Webhook",
    group: "request",
    icon: ICON_RESPOND,
    params: [
      {
        key: "respondWith",
        label: "Respond with",
        type: "select",
        default: "json",
        hint: "Shape of the response returned to the webhook caller.",
        options: [
          { value: "json", label: "JSON" },
          { value: "text", label: "Text" },
          { value: "noData", label: "No body" },
        ],
      },
      { key: "responseCode", label: "Response status code", type: "number", default: 200 },
      {
        key: "responseBody",
        label: "Response body",
        type: "json",
        default: {},
        hint: "Body to return (object for JSON, string for Text).",
      },
      {
        key: "responseHeaders",
        label: "Response headers",
        type: "array",
        default: [],
        item: {
          type: "object",
          fields: [
            { key: "name", label: "Name", type: "string" },
            { key: "value", label: "Value", type: "string" },
          ],
        },
      },
    ],
  },
  {
    app: CONTROL_APP,
    action: "aggregate",
    label: "Aggregate",
    displayName: "Aggregate",
    group: "control",
    icon: ICON_AGGREGATE,
    // Fan-in join: accepts several inbound branches and emits one combined
    // output. `in > 1` opts the node into multiple inbound edges (see core
    // rfcs/node-types.md · Ports & cardinality); `out: 1` is a single exit.
    ports: { in: 10, out: 1 },
    params: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        default: "array",
        hint: "How to combine the inbound branch outputs: an array of results, or an object keyed by source step.",
        options: [
          { value: "array", label: "Array" },
          { value: "object", label: "Object" },
        ],
      },
    ],
  },
  {
    app: CALL_APP,
    action: "call",
    label: "Call workflow",
    displayName: "Call",
    group: "compute",
    icon: ICON_CALL,
    // Internal host node: invokes a project-scoped Callable (a Function or a
    // Workflow) via `ctx.invokeCallable` (core rfcs/node-types.md · F-3). One
    // inbound, one outbound — the sub-run is a single downstream continuation.
    ports: { in: 1, out: 1 },
    params: [
      {
        // The target's discriminant (HITL-D: resolved within the same project).
        // A populated target picker is a deferred follow-up (FOLLOWUPS.md); v1
        // pairs this kind with a plain id field below.
        key: "targetKind",
        label: "Target kind",
        type: "select",
        required: true,
        default: "workflow",
        hint: "Whether this node calls another Workflow or a Function.",
        options: [
          { value: "workflow", label: "Workflow" },
          { value: "function", label: "Function" },
        ],
      },
      {
        key: "targetId",
        label: "Target id",
        type: "string",
        required: true,
        default: "",
        placeholder: "e.g. wf_… or fn_…",
        hint: "Id of the Workflow (wf_…) or Function (fn_…) to call, within this project.",
      },
      {
        // SEAM PIN: the key is `inputs` (plural) — it maps to the engine's
        // `InvokeCallableRequest.inputs` (the target's canonical inputs). Do
        // NOT rename to `input`.
        key: "inputs",
        label: "Inputs",
        type: "json",
        default: {},
        hint: "Payload passed to the target — an object keyed by the callee's declared inputs. Values may be expressions.",
      },
      {
        // HITL-5: wait/no-wait is a per-node choice, independent of the target
        // kind. `true` ⇒ block for the sub-run's output; `false` ⇒ return a run
        // handle ({ runId }) and continue the parent graph.
        key: "wait",
        label: "Wait for completion",
        type: "boolean",
        default: true,
        hint: "On: block until the sub-run finishes and expose its output. Off: return a run handle and continue.",
      },
    ],
  },
  {
    app: DOCUMENT_APP,
    action: "get",
    label: "Get document",
    displayName: "Document",
    group: "compute",
    icon: ICON_DOCUMENT,
    // Host node: reads a stored JSON document by key (core rfcs/node-types.md
    // · F-3 amendment, "Reserved internal pseudo-app"). One inbound, one
    // outbound — a single read step. No `project` param: the run's own
    // project is bound host-side (C-6).
    ports: { in: 1, out: 1 },
    params: [
      {
        key: "key",
        label: "Key",
        type: "string",
        required: true,
        default: "",
        hint: "Document key to read — may be an expression, e.g. a step output.",
      },
    ],
  },
];

/** Look up an internal node's definition by its (app, action) pair. */
export function internalNodeDef(app: string, action: string): InternalNodeDef | undefined {
  return INTERNAL_NODES.find((n) => n.app === app && n.action === action);
}

/** The label the editor shows for an internal node (falls back to the action key). */
export function internalNodeLabel(app: string, action: string): string {
  return internalNodeDef(app, action)?.label ?? action;
}

/**
 * The inline SVG glyph markup for an internal node (empty when unknown). Lets a
 * node retrieve its icon from just the (app, action) pair — same lookup path as
 * `internalNodeLabel`.
 */
export function internalNodeIcon(app: string, action: string): string {
  return internalNodeDef(app, action)?.icon ?? "";
}

/** The config schema for an internal node (empty when unknown). */
export function internalNodeParams(app: string, action: string): ActionParam[] {
  return internalNodeDef(app, action)?.params ?? [];
}

/** Build an internal node's default `with` from its param schema defaults. */
export function internalNodeDefaults(app: string, action: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of internalNodeParams(app, action)) {
    if (p.default !== undefined) out[p.key] = p.default;
  }
  return out;
}
