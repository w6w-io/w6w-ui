import { type ReactNode, forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { AddConnectionModal } from "./AddConnectionModal.tsx";
import { AppPicker } from "./AppPicker.tsx";
import { JsonEditor } from "./JsonEditor.tsx";
import { type NodeConfig, NodeConfigForm } from "./NodeConfigForm.tsx";
import { ParamsForm, flattenParams, isParamVisible } from "./ParamsForm.tsx";
import { TriggerFillForm } from "./TriggerFillForm.tsx";
import { AppIcon } from "./components/AppIcon.tsx";
import type { ExpressionStepSource } from "./components/ExpressionOptions.tsx";
import { InternalIcon } from "./components/InternalIcon.tsx";
import { Modal } from "./components/Modal.tsx";
import {
  CALL_APP,
  DATA_APP,
  INTERNAL_NODES,
  type InternalNodeDef,
  internalNodeDefaults,
  isControlApp,
  isInternalApp,
  isTriggerApp,
} from "./flow-types.ts";
import { paramsToJson, stepToJson } from "./flow-utils.ts";
import { type StepStartState, useW6WApi, useWorkflowProject } from "./provider.tsx";
import { startStateFromSeeds } from "./step-preview-state.ts";
import type {
  ActionDef,
  ActionParam,
  AppSummary,
  AuthDef,
  ConnectionSummary,
  FunctionSummary,
  ThemeMode,
  TriggerSummary,
  WorkflowDetail,
  WorkflowSummary,
} from "./types.ts";
import { useSeedSources } from "./use-seed-sources.ts";

/** The step the builder emits — the editor assigns the final `id`. `NodeConfig`
 * carries the base settings (retry / onError / notes) set on the Config view. */
export interface BuiltStep extends NodeConfig {
  uses: { app: string; action: string; connection?: string | null };
  with?: Record<string, unknown>;
}

export interface StepBuilderModalProps {
  onClose: () => void;
  /**
   * Fired once per session, the moment the step first has identity — for an
   * app step, when Setup completes (action + connection, if needed); for a
   * control node, on mount. Returns the minted step id so subsequent edits can
   * target it via {@link StepBuilderModalProps.onDraftChange}.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: widened so studio's void-returning callers stay assignable.
  onAdd: (step: BuiltStep) => string | undefined | void;
  /**
   * Fired for every field change **after** the step has been committed via
   * `onAdd` — keeps the already-added node current without minting a second
   * one. `id` is the id `onAdd` returned. Progressive commit (mint-then-update)
   * only engages when this is supplied; omitted callers (the Functions/
   * Endpoints pickers) keep the original one-shot "Add step" behavior.
   */
  onDraftChange?: (id: string, step: BuiltStep) => void;
  theme?: ThemeMode;
  /**
   * Hide the GRAPH-ONLY tabs — Triggers / Controls / Utilities / Data, the
   * flow-control and internal `@w6w/*` node kinds that only mean something
   * inside a workflow canvas. Used by every picker that binds a *target*
   * rather than adding a node to a graph.
   *
   * ⚠️ It does NOT hide Functions and Workflows, and did not always behave
   * that way: it used to, which is why the Implementation card's picker
   * showed only `Connected apps / Apps / AI` and F-2.0's tabs were
   * unreachable outside the canvas. A Function and a Workflow are *callable
   * targets*, not graph-only node kinds — they belong in every picker.
   * {@link StepBuilderModalProps.callables} is the knob for those two.
   */
  appsOnly?: boolean;
  /**
   * Which callable families the Functions/Workflows tabs offer. Defaults to
   * BOTH, so a caller that says nothing keeps the full F-2.0 homepage
   * (`Connected apps | Functions | Workflows`). Pass a narrower array — or
   * `[]` — where the surrounding contract cannot accept one of them.
   */
  callables?: readonly ("function" | "workflow")[];
  /**
   * Which homepage tab opens first. Defaults to `"connected"` — F-2.0's
   * homepage. A caller re-opening the picker for an already-bound target
   * passes that target's own family, so "Change" lands where the current
   * value lives instead of making the author re-find the tab.
   */
  initialTab?: "connected" | "functions" | "workflows";

  /** Modal heading. Defaults to "Add a step". */
  title?: string;
  /**
   * Workflow-step context, when the builder is opened for a step that already
   * lives in a workflow. When present the `testRequired` save-gate can discover a
   * previously-saved **passing** test for the step via {@link W6WApi.listStepTests}.
   * Absent in the plain add-step flow (the step has no id yet) — there the gate is
   * satisfied by running a passing test in-session.
   */
  workflowId?: string;
  /** Step id paired with {@link StepBuilderModalProps.workflowId}. */
  stepId?: string;
  /**
   * The new step's known graph ancestors, when the builder is opened from the
   * workflow canvas (`stepBuilderUpstreamSteps`, derived from the connection
   * drag that opened it). Threaded into the Test tab's `<StepTestRun>` the same
   * way `StepEditModal` seeds an existing step's Test tab, so a `with` block
   * written as `{{ steps.<id>.output.<field> }}` resolves instead of coming
   * back empty. Absent (defaults to `[]`) for the Functions/Endpoints pickers,
   * which have no graph to draw ancestors from.
   */
  upstreamSteps?: ExpressionStepSource[];
  /**
   * Pre-select an app when the modal opens. When provided along with
   * initialAction/initialConnection/initialWith, the modal opens directly
   * to the action configuration view instead of the app picker.
   * Used when editing an existing action (e.g., clicking "Change" on an
   * Endpoint's already-configured target).
   */
  initialApp?: AppSummary;
  /**
   * Pre-select an action key. Requires initialApp to be set.
   */
  initialAction?: string;
  /**
   * Pre-select a connection. Requires initialApp and initialAction.
   */
  initialConnection?: string;
  /**
   * Pre-fill the action's parameter values. Requires initialApp and initialAction.
   */
  initialWith?: Record<string, unknown>;
}

/** {@link StepBuilderModalProps.callables}'s default — both families. Module
 *  scope so the default is one shared frozen array, never a fresh literal per
 *  render (it lands in a `useEffect`-free read path, but a stable identity
 *  keeps it honest for any future memo). */
const CALLABLE_FAMILIES = ["function", "workflow"] as const;

/** Row glyphs for the home tab's non-app entries, in `InternalIcon`'s
 *  stroked-24-viewBox idiom so a Function/Workflow row sits on the same tile
 *  an app row's icon does. Feather `git-branch` for a Workflow (it is a graph)
 *  and `zap` for a Function (one operation, immediate). */
const CALLABLE_GLYPH: Record<"function" | "workflow", string> = {
  workflow:
    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  function: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};

type Tab =
  | "connected"
  | "functions"
  | "workflows"
  | "apps"
  | "ai"
  | "triggers"
  | "controls"
  | "utilities"
  | "data";

/** Config sub-tabs shared by the add-step config and the node editor. */
type StepConfigTab = "setup" | "configure" | "test";

/** The four representations of the Configure tab: form, full-step JSON,
 * params-only JSON, node settings. */
export type ConfigView = "props" | "code" | "params-code" | "config";

/** A 15×15 stroked glyph on a 24×24 viewBox (matches the editor's toolbar icons). */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The glyph + accessible label each view is drawn with. */
const CONFIG_VIEW_GLYPHS: Record<ConfigView, { label: string; glyph: ReactNode }> = {
  props: {
    label: "Form",
    glyph: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="7" y1="8" x2="17" y2="8" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="7" y1="16" x2="13" y2="16" />
      </>
    ),
  },
  code: {
    label: "JSON",
    glyph: (
      <>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </>
    ),
  },
  // Hand-drawn — no icon library in `packages/ui`, no new npm dependency. Braces,
  // not chevrons: `code` reads as "the step, as code"; this reads as "the
  // params, as a value" — distinct at a glance from the `<>` pair above it.
  "params-code": {
    label: "Params JSON",
    glyph: (
      <>
        <polyline points="9 4 7 4 7 10 5 12 7 14 7 20 9 20" />
        <polyline points="15 4 17 4 17 10 19 12 17 14 17 20 15 20" />
      </>
    ),
  },
  config: {
    label: "Node settings",
    glyph: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
};

/** Every view, in the order the editor's tabs bar has always shown them. */
const ALL_CONFIG_VIEWS: ConfigView[] = ["props", "code", "params-code", "config"];

/**
 * The props / code / params-code / config view toggle, right-aligned in the
 * tabs bar. Disabled off the Configure tab (all four views represent the
 * action's config).
 *
 * `views` narrows it to a subset, in the order given — a fields ⇄ raw-JSON
 * property form (see `PropertyEntryForm`) passes `["props", "code"]`. There is
 * deliberately no second toggle component: one glyph set, one styling, one
 * pressed-state behaviour, however many views a host offers.
 */
export function ConfigViewToggle({
  view,
  onChange,
  disabled,
  views = ALL_CONFIG_VIEWS,
}: {
  view: ConfigView;
  onChange: (v: ConfigView) => void;
  disabled?: boolean;
  /** Which views to offer, in order. Defaults to all four. */
  views?: ConfigView[];
}) {
  const btn = (v: ConfigView) => (
    <button
      key={v}
      type="button"
      title={CONFIG_VIEW_GLYPHS[v].label}
      aria-label={CONFIG_VIEW_GLYPHS[v].label}
      aria-pressed={view === v}
      disabled={disabled}
      className={`w6w-icon-btn${view === v && !disabled ? " active" : ""}`}
      onClick={() => onChange(v)}
    >
      <Glyph>{CONFIG_VIEW_GLYPHS[v].glyph}</Glyph>
    </button>
  );
  return <div className="w6w-view-toggle">{views.map(btn)}</div>;
}

/**
 * Guided "add a step" flow. A sidebar toggles between **Apps** (pick app →
 * ensure a connection → pick action → fill params) and **Controls** — the
 * internal nodes: triggers, flow control (if/foreach/parallel/wait), and compute
 * (script/data). Emits a `BuiltStep` via `onAdd`.
 *
 * Data + IO come from `useW6WApi()`, so mount it under `<W6WUIProvider>`.
 */
export function StepBuilderModal({
  onClose,
  onAdd,
  onDraftChange,
  theme,
  appsOnly,
  callables = CALLABLE_FAMILIES,
  initialTab,
  title,
  workflowId,
  stepId,
  upstreamSteps = [],
  initialApp,
  initialAction,
  initialConnection,
  initialWith,
}: StepBuilderModalProps) {
  // Default to the apps the user already connected — no searching for the one
  // integration they use every day.
  const [tab, setTab] = useState<Tab>(initialTab ?? "connected");
  // When an app is selected the modal collapses to a single-app detail view:
  // the sidebar is hidden and the header switches to the app's name + icon.
  // Initialize with initialApp if provided to skip the app picker.
  const [selectedApp, setSelectedApp] = useState<AppSummary | null>(initialApp ?? null);
  // Same collapse for a chosen internal node (trigger / control / compute) — its
  // config form (dynamic ParamsForm over the node's schema) shows before adding.
  const [selectedNode, setSelectedNode] = useState<InternalNodeDef | null>(null);
  // Same collapse for a picked Function/Workflow target (D-12/D-15): both tabs
  // mint the SAME `@w6w/call` step shape, so one piece of state (family + id +
  // label) is enough — `CallableStepConfig` decides what to call from `family`.
  const [selectedCallable, setSelectedCallable] = useState<{
    family: "function" | "workflow";
    id: string;
    label: string;
  } | null>(null);

  // The home tab's contents, fetched here rather than inside the tab, because
  // whether the TAB EXISTS depends on them: nothing connected and nothing
  // built ⇒ no "Ready to use" tab at all. Still `"loading"` counts as present,
  // so the sidebar does not shuffle a beat after it renders.
  const readyToUse = useReadyToUse(callables);
  const homeAvailable = readyToUse.state !== "empty";
  // If the home tab vanishes while it is the open one, fall to the catalogue
  // rather than rendering a tab body with no tab.
  useEffect(() => {
    if (!homeAvailable && tab === "connected") setTab("apps");
  }, [homeAvailable, tab]);

  if (selectedCallable) {
    return (
      <Modal
        title={selectedCallable.label}
        subtitle={<code>{selectedCallable.id}</code>}
        onClose={onClose}
        size="xl"
        headerRight={
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost"
            onClick={() => setSelectedCallable(null)}
          >
            ← Back
          </button>
        }
      >
        <div className="w6w-stepbuilder-config">
          <CallableStepConfig
            family={selectedCallable.family}
            targetId={selectedCallable.id}
            targetLabel={selectedCallable.label}
            onAdd={onAdd}
            onClose={onClose}
            onDraftChange={onDraftChange}
          />
        </div>
      </Modal>
    );
  }

  if (selectedNode) {
    return (
      <Modal
        title={selectedNode.label}
        titleIcon={<InternalIcon icon={selectedNode.icon} size={22} />}
        subtitle={
          <code>
            {selectedNode.app} · {selectedNode.action}
          </code>
        }
        onClose={onClose}
        size="xl"
        headerRight={
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost"
            onClick={() => setSelectedNode(null)}
          >
            ← Back
          </button>
        }
      >
        <div className="w6w-stepbuilder-config">
          <ControlStepConfig
            node={selectedNode}
            onAdd={onAdd}
            onClose={onClose}
            onDraftChange={onDraftChange}
            workflowId={workflowId}
            upstreamSteps={upstreamSteps}
          />
        </div>
      </Modal>
    );
  }

  if (selectedApp) {
    return (
      <Modal
        title={selectedApp.displayName}
        subtitle={
          <>
            <code>{selectedApp.id}</code>
            {selectedApp.version && ` · v${selectedApp.version}`}
          </>
        }
        onClose={onClose}
        size="xl"
        titleIcon={
          <AppIcon
            src={selectedApp.iconSvg}
            srcDark={selectedApp.iconSvgDark}
            brandColor={selectedApp.brandColor}
            name={selectedApp.displayName}
            theme={theme}
            size={22}
          />
        }
      >
        <div className="w6w-stepbuilder-config">
          {/* App-switching lives in the Setup tab's "Change" (à la Zapier), not a
              top-right back button. */}
          <AppStepConfig
            appId={selectedApp.id}
            app={selectedApp}
            onAdd={onAdd}
            onClose={onClose}
            onDraftChange={onDraftChange}
            onChangeApp={() => setSelectedApp(null)}
            theme={theme}
            workflowId={workflowId}
            stepId={stepId}
            upstreamSteps={upstreamSteps}
            initialAction={initialAction}
            initialConnection={initialConnection}
            initialWith={initialWith}
          />
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title ?? "Add a step"} onClose={onClose} size="xl">
      <div className="w6w-stepbuilder">
        <nav className="w6w-stepbuilder-sidebar">
          {/* F-2.0's homepage, and the order it asks for:
                Ready to use · Apps · AI · Workflows · Functions
              The home tab is ONE list holding connected apps + Workflows +
              Functions (see `ReadyToUseFlow`); the four after it are the
              browse-everything tabs. `callables` still narrows the two
              callable tabs — and the home list with them — for a call site
              whose contract cannot accept one of the families. */}
          {homeAvailable && (
            <button
              type="button"
              className={`w6w-stepbuilder-tab${tab === "connected" ? " active" : ""}`}
              onClick={() => setTab("connected")}
            >
              Ready to use
            </button>
          )}
          <button
            type="button"
            className={`w6w-stepbuilder-tab${tab === "apps" ? " active" : ""}`}
            onClick={() => setTab("apps")}
          >
            Apps
          </button>
          <button
            type="button"
            className={`w6w-stepbuilder-tab${tab === "ai" ? " active" : ""}`}
            onClick={() => setTab("ai")}
          >
            AI
          </button>
          {callables.includes("workflow") && (
            <button
              type="button"
              className={`w6w-stepbuilder-tab${tab === "workflows" ? " active" : ""}`}
              onClick={() => setTab("workflows")}
            >
              Workflows
            </button>
          )}
          {callables.includes("function") && (
            <button
              type="button"
              className={`w6w-stepbuilder-tab${tab === "functions" ? " active" : ""}`}
              onClick={() => setTab("functions")}
            >
              Functions
            </button>
          )}
          {!appsOnly && (
            <>
              <button
                type="button"
                className={`w6w-stepbuilder-tab${tab === "triggers" ? " active" : ""}`}
                onClick={() => setTab("triggers")}
              >
                Triggers
              </button>
              <button
                type="button"
                className={`w6w-stepbuilder-tab${tab === "controls" ? " active" : ""}`}
                onClick={() => setTab("controls")}
              >
                Controls
              </button>
              <button
                type="button"
                className={`w6w-stepbuilder-tab${tab === "utilities" ? " active" : ""}`}
                onClick={() => setTab("utilities")}
              >
                Utilities
              </button>
              <button
                type="button"
                className={`w6w-stepbuilder-tab${tab === "data" ? " active" : ""}`}
                onClick={() => setTab("data")}
              >
                Data
              </button>
            </>
          )}
        </nav>
        <div className="w6w-stepbuilder-content">
          {tab === "connected" ? (
            <ReadyToUseFlow
              data={readyToUse}
              onSelectApp={setSelectedApp}
              onSelectCallable={setSelectedCallable}
              theme={theme}
            />
          ) : tab === "functions" ? (
            <CallableList
              family="function"
              onSelect={(t) => setSelectedCallable({ family: "function", ...t })}
            />
          ) : tab === "workflows" ? (
            <CallableList
              family="workflow"
              onSelect={(t) => setSelectedCallable({ family: "workflow", ...t })}
            />
          ) : tab === "apps" ? (
            <AppPicker onSelectApp={setSelectedApp} theme={theme} />
          ) : tab === "ai" ? (
            <AppPicker
              onSelectApp={setSelectedApp}
              theme={theme}
              filter={(a) => a.categories?.includes("ai") ?? false}
              searchPlaceholder="Search AI apps…"
              emptyMessage="No AI apps registered yet."
            />
          ) : tab === "triggers" ? (
            <TriggersFlow onSelect={setSelectedNode} workflowId={workflowId} onClose={onClose} />
          ) : tab === "controls" ? (
            <ControlsFlow onSelect={setSelectedNode} />
          ) : tab === "data" ? (
            <DataFlow onSelect={setSelectedNode} />
          ) : (
            <UtilitiesFlow onSelect={setSelectedNode} />
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Internal nodes tab (triggers, flow control, compute) ───────────────────

/** A flat, clickable list of internal nodes. Shared by Controls + Utilities. */
function NodeList({
  nodes,
  onSelect,
}: {
  nodes: InternalNodeDef[];
  onSelect: (node: InternalNodeDef) => void;
}) {
  return (
    <div className="w6w-stepbuilder-list">
      {nodes.map((n) => (
        <button
          key={`${n.app}:${n.action}`}
          type="button"
          className="w6w-stepbuilder-item"
          onClick={() => onSelect(n)}
        >
          <InternalIcon icon={n.icon} size={24} />
          <span className="w6w-stepbuilder-item-main">
            <strong>{n.label}</strong>
            <code className="w6w-muted w6w-small">
              {n.app} · {n.action}
            </code>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Triggers tab — entry nodes that start a workflow (manual, webhook, …), plus
 * (T-0) an "App triggers" section listing apps that declare their own
 * triggers (RFC `trigger.md`). The internal 3 keep their existing `onSelect`
 * → `onAdd` graph-node behaviour, untouched; the app section is a SEPARATE,
 * non-graph mechanism (DECISIONS.md HITL-1, plan.md D-3) — selecting an app
 * trigger never calls `onAdd`.
 */
function TriggersFlow({
  onSelect,
  workflowId,
  onClose,
}: {
  onSelect: (node: InternalNodeDef) => void;
  workflowId?: string;
  onClose: () => void;
}) {
  const nodes = INTERNAL_NODES.filter((n) => n.group === "trigger");
  const api = useW6WApi();
  return (
    <div className="w6w-stack">
      <p className="w6w-muted w6w-small">
        Triggers start a workflow — run it manually or on an inbound webhook.
      </p>
      <NodeList nodes={nodes} onSelect={onSelect} />
      {/* Gated on BOTH workflowId (this builder is opened for a real workflow —
       *  a Subscription needs a workflow to bind to) and the optional member
       *  itself. `test/picker-layout`'s I5/I6 mount with no `workflowId` even
       *  though its stub `api` answers every key truthy — this second gate is
       *  exactly why that suite stays unaffected (see the contract's test plan). */}
      {workflowId && api.listTriggerApps && (
        <AppTriggersSection workflowId={workflowId} onClose={onClose} />
      )}
    </div>
  );
}

/**
 * "App triggers" section (T-0): lists apps that declare triggers
 * (`api.listTriggerApps`), then — once one is picked — that app's declared
 * triggers (`api.getAppTriggers`). Choosing a trigger calls
 * `api.createSubscription` on an explicit click only; no graph step is added
 * (plan.md D-3 — `onAdd` is never reached from this section).
 */
function AppTriggersSection({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const api = useW6WApi();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppSummary | null>(null);

  useEffect(() => {
    const load = api.listTriggerApps;
    if (!load) return;
    let canceled = false;
    load()
      .then((r) => !canceled && setApps(r))
      .catch((e) => !canceled && setAppsError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api]);

  if (!api.listTriggerApps) return null;

  return (
    <div className="w6w-stack">
      <p className="w6w-muted w6w-small">
        <strong>App triggers</strong> — bind one of these apps' declared triggers to this workflow.
      </p>
      {appsError ? (
        <div className="w6w-result w6w-error">{appsError}</div>
      ) : selectedApp ? (
        <AppTriggerPicker
          app={selectedApp}
          workflowId={workflowId}
          onBack={() => setSelectedApp(null)}
          onClose={onClose}
        />
      ) : (
        <AppPicker
          apps={apps}
          onSelectApp={setSelectedApp}
          search={false}
          emptyMessage="No apps declare triggers yet."
        />
      )}
    </div>
  );
}

/**
 * One app's declared triggers, once picked in {@link AppTriggersSection} — a
 * chooser when the app declares triggers, an explicit "declares no triggers"
 * message when it doesn't (mirrors `SubscriptionsPage.tsx`'s
 * `TriggerKeyField`, minus its free-text fallback: a trigger key the app
 * doesn't declare is a `404 unknown_trigger` here, so there is nothing useful
 * a free-text arm could submit).
 */
function AppTriggerPicker({
  app,
  workflowId,
  onBack,
  onClose,
}: {
  app: AppSummary;
  workflowId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const api = useW6WApi();
  const [triggers, setTriggers] = useState<TriggerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const load = api.getAppTriggers;
    if (!load) return;
    let canceled = false;
    load(app.id)
      .then((r) => !canceled && setTriggers(r))
      .catch((e) => !canceled && setError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api, app.id]);

  const create = (triggerKey: string) => {
    const createSubscription = api.createSubscription;
    if (!createSubscription) return;
    setError(null);
    setCreating(true);
    createSubscription(app.id, triggerKey, { workflowId, connectionId: null, params: {} })
      .then(() => onClose())
      .catch((e) => {
        setCreating(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="w6w-stack">
      <button type="button" className="w6w-btn w6w-btn-ghost w6w-btn-sm" onClick={onBack}>
        ← Back
      </button>
      <strong>{app.displayName}</strong>
      {error && <div className="w6w-result w6w-error">{error}</div>}
      {triggers === null ? (
        <p className="w6w-muted w6w-small">Loading triggers…</p>
      ) : triggers.length === 0 ? (
        <p className="w6w-muted w6w-small">This app declares no triggers.</p>
      ) : (
        <div className="w6w-stepbuilder-list">
          {triggers.map((t) => (
            <button
              key={t.key}
              type="button"
              className="w6w-stepbuilder-item"
              disabled={creating}
              onClick={() => create(t.key)}
            >
              <span className="w6w-stepbuilder-item-main">
                <strong>{t.title}</strong>
                <code className="w6w-muted w6w-small">{t.key}</code>
                {t.description && <span className="w6w-muted w6w-small">{t.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Controls tab — engine-native flow control only (branch, loop, parallelize, wait). */
function ControlsFlow({ onSelect }: { onSelect: (node: InternalNodeDef) => void }) {
  const nodes = INTERNAL_NODES.filter((n) => n.group === "control");
  return (
    <div className="w6w-stack">
      <p className="w6w-muted w6w-small">
        Flow-control nodes branch, loop, parallelize, or pause the run.
      </p>
      <NodeList nodes={nodes} onSelect={onSelect} />
    </div>
  );
}

/** Utilities tab — compute + request nodes (script, HTTP, respond). The `@w6w/data`
 * node lives in its own **Data** tab, so exclude it here. */
function UtilitiesFlow({ onSelect }: { onSelect: (node: InternalNodeDef) => void }) {
  const nodes = INTERNAL_NODES.filter(
    (n) => n.group !== "control" && n.group !== "trigger" && n.app !== DATA_APP,
  );
  return (
    <div className="w6w-stack">
      <p className="w6w-muted w6w-small">
        Utilities run a script, call an HTTP(S) endpoint, or respond to a webhook.
      </p>
      <NodeList nodes={nodes} onSelect={onSelect} />
    </div>
  );
}

/** Data tab — the `@w6w/data` node: declare typed key/value variables for
 * downstream steps to reference. */
function DataFlow({ onSelect }: { onSelect: (node: InternalNodeDef) => void }) {
  const nodes = INTERNAL_NODES.filter((n) => n.app === DATA_APP);
  return (
    <div className="w6w-stack">
      <p className="w6w-muted w6w-small">
        Declare typed key/value variables for downstream steps to reference.
      </p>
      <NodeList nodes={nodes} onSelect={onSelect} />
    </div>
  );
}

/**
 * Config form for a chosen internal node — its schema rendered through the same
 * `ParamsForm` as app actions, seeded with the node's defaults. Emits the built
 * step on Add.
 */
export function ControlStepConfig({
  node,
  onAdd,
  onClose,
  onDraftChange,
  workflowId,
  upstreamSteps = [],
}: {
  node: InternalNodeDef;
  // biome-ignore lint/suspicious/noConfusingVoidType: see StepBuilderModalProps.onAdd, forwarded as-is.
  onAdd: (s: BuiltStep) => string | undefined | void;
  onClose: () => void;
  /** See {@link StepBuilderModalProps.onDraftChange}. */
  onDraftChange?: (id: string, step: BuiltStep) => void;
  workflowId?: string;
  /** The new step's known graph ancestors — see {@link StepBuilderModalProps.upstreamSteps}. */
  upstreamSteps?: ExpressionStepSource[];
}) {
  const [withValues, setWithValues] = useState<Record<string, unknown>>(() =>
    internalNodeDefaults(node.app, node.action),
  );
  // Internal nodes have no connection/action to pick, so there's no Setup tab —
  // just Configure + Test (flow-control nodes aren't testable standalone).
  const testable = !isControlApp(node.app);
  // The step-being-added's graph ancestors that carry a saved step-test, offered
  // as one-click seeds for the incoming state — the SAME pipeline `StepEditModal`
  // uses, so the Test tab here resolves `{{ steps.<id>.output.<field> }}` the
  // same way an existing step's Test tab does (T1.1.1). Only meaningful when the
  // builder was opened from a workflow canvas (`workflowId` present); the
  // Functions/Endpoints pickers pass no `workflowId` and no `upstreamSteps`.
  const seedSources = useSeedSources(workflowId ?? "", upstreamSteps, testable && !!workflowId);
  const testStartState = startStateFromSeeds(seedSources);
  const [tab, setTab] = useState<"configure" | "test">("configure");
  const [configView, setConfigView] = useState<ConfigView>("props");
  // Draft text backing the "code" (full-step, read-only) view.
  const [codeText, setCodeText] = useState("{}");
  // Draft text backing the "params-code" (params-only, writable) view.
  const [paramsCodeText, setParamsCodeText] = useState("{}");
  const [draftConfig, setDraftConfig] = useState<NodeConfig>({});
  const configComplete = requiredParamsFilled(node.params, withValues);

  // The id `onAdd` minted at commit time, once a control node's identity has
  // been committed to the graph this session. `null` until then (and forever,
  // for a caller that doesn't supply `onDraftChange` — the original one-shot
  // "Add step" behavior).
  const [committedId, setCommittedId] = useState<string | null>(null);
  const buildStep = (): BuiltStep => ({
    uses: { app: node.app, action: node.action },
    with: withValues,
    ...draftConfig,
  });

  // Mint — a control node has identity the instant it's picked (no Setup tab),
  // so commit it to the graph on mount, exactly once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mint fires once on mount only; buildStep/onAdd intentionally read fresh closure state without retriggering this effect.
  useEffect(() => {
    if (!onDraftChange) return;
    const id = onAdd(buildStep());
    if (id) setCommittedId(id);
  }, []);

  // Update — keep the already-committed node current on every subsequent field
  // change, instead of minting a duplicate via a second `onAdd` call.
  // biome-ignore lint/correctness/useExhaustiveDependencies: buildStep reads fresh closure state; only these fields should retrigger the update.
  useEffect(() => {
    if (!onDraftChange || committedId === null) return;
    onDraftChange(committedId, buildStep());
  }, [committedId, withValues, draftConfig]);

  const changeConfigView = (v: ConfigView) => {
    if (v === "code") setCodeText(stepToJson(buildStep()));
    else if (v === "params-code") setParamsCodeText(paramsToJson(buildStep()));
    setConfigView(v);
  };
  const add = () => onAdd(buildStep());

  return (
    <div className="w6w-stepconfig">
      <div className="w6w-tabsbar">
        <div className="w6w-subtabs">
          <button
            type="button"
            className={`w6w-subtab${tab === "configure" ? " active" : ""}`}
            onClick={() => setTab("configure")}
          >
            Configure
          </button>
          {testable && (
            <button
              type="button"
              disabled={!configComplete}
              title={configComplete ? undefined : "Fill the required fields first"}
              className={`w6w-subtab${tab === "test" ? " active" : ""}`}
              onClick={() => configComplete && setTab("test")}
            >
              Test
            </button>
          )}
        </div>
        <ConfigViewToggle
          view={configView}
          onChange={changeConfigView}
          disabled={tab !== "configure"}
        />
      </div>

      <div className="w6w-stepconfig-body">
        {tab === "configure" &&
          (configView === "props" ? (
            <ParamsForm params={node.params} values={withValues} onChange={setWithValues} />
          ) : configView === "code" ? (
            // Full step, read-only (D-3) — `stepToJson` is the ONE serializer,
            // shared with the two other code-view hosts.
            <JsonEditor
              value={codeText}
              onChange={() => {}}
              readOnly
              minHeight="240px"
              height="100%"
              aria-label="Step JSON"
            />
          ) : configView === "params-code" ? (
            <JsonEditor
              value={paramsCodeText}
              onChange={setParamsCodeText}
              minHeight="240px"
              height="100%"
              aria-label="Parameters JSON"
              onValidChange={(p) =>
                p &&
                typeof p === "object" &&
                !Array.isArray(p) &&
                setWithValues(p as Record<string, unknown>)
              }
            />
          ) : (
            <NodeConfigForm config={draftConfig} onChange={setDraftConfig} />
          ))}
        {tab === "test" &&
          testable &&
          (isTriggerApp(node.app) ? (
            <TriggerFillForm app={node.app} action={node.action} fields={withValues.fields} />
          ) : (
            <StepTestRun
              app={node.app}
              action={node.action}
              values={withValues}
              canRun={configComplete}
              state={testStartState}
            />
          ))}
      </div>

      {/* Footer — pinned to the modal bottom, outside the scroll area. */}
      <div className="w6w-modal-actions w6w-stepconfig-footer">
        <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        {tab === "configure" && testable ? (
          <button
            type="button"
            className="w6w-btn"
            disabled={!configComplete}
            onClick={() => setTab("test")}
          >
            Next →
          </button>
        ) : (
          <button type="button" className="w6w-btn" onClick={committedId !== null ? onClose : add}>
            {committedId !== null ? "Done" : "Add step"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Functions / Workflows tabs (F-2.0, D-12/D-15) ───────────────────────────
//
// Both tabs mint ONE step shape — an `@w6w/call` step — so there is no
// per-family component pair: `CallableList` (the browse-and-pick stage,
// styled after `AppPicker.tsx`) and `CallableStepConfig` (Configure/Test/Add,
// mirroring `ControlStepConfig`'s progressive-commit shape) both take a single
// `family: "function" | "workflow"` prop that only decides which endpoints to
// call and what `with.targetKind` gets stamped.

/**
 * Searchable list of a family's summaries — the picker's browse-and-pick
 * stage. Mirrors `AppPicker.tsx`'s shape (search box, sorted/filtered list,
 * loading/error/empty states); a Function/Workflow summary has no
 * icon/brandColor, so each row is text-only. `onSelect` hands the picked
 * target's id + display label up to `StepBuilderModal`, which collapses into
 * `CallableStepConfig` exactly as picking an app or an internal node does.
 */
function CallableList({
  family,
  onSelect,
}: {
  family: "function" | "workflow";
  onSelect: (target: { id: string; label: string }) => void;
}) {
  const api = useW6WApi();
  const [items, setItems] = useState<Array<FunctionSummary | WorkflowSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const noun = family === "function" ? "Functions" : "Workflows";

  useEffect(() => {
    let canceled = false;
    const p = family === "function" ? api.listFunctions() : api.listWorkflows();
    p.then((r) => !canceled && setItems(r)).catch(
      (e) => !canceled && setError((e as Error).message),
    );
    return () => {
      canceled = true;
    };
  }, [api, family]);

  // Single layout owner, mirroring `.w6w-apppicker-host`'s role for AppPicker
  // (I4: every render path — error/loading/empty/loaded — reports the same
  // host height, so the modal never resizes switching between them).
  const host = (body: ReactNode) => <div className="w6w-apppicker-host">{body}</div>;

  if (error) return host(<div className="w6w-result w6w-error">{error}</div>);
  if (items === null) {
    return host(<p className="w6w-muted w6w-small">Loading {noun.toLowerCase()}…</p>);
  }
  if (items.length === 0) {
    return host(<p className="w6w-muted w6w-small">No {noun.toLowerCase()} registered yet.</p>);
  }

  // The same label rule the home tab uses — one definition, so a Function is
  // named identically wherever it is listed.
  const label = callableLabel;
  const q = query.trim().toLowerCase();
  const sorted = [...items].sort(byLabel(label));
  const visible = q
    ? sorted.filter((it) => label(it).toLowerCase().includes(q) || it.id.toLowerCase().includes(q))
    : sorted;

  return host(
    <div className="w6w-stepbuilder-apps">
      <input
        type="text"
        className="w6w-stepbuilder-search"
        placeholder={`Search ${noun.toLowerCase()}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={`Search ${noun.toLowerCase()}`}
      />
      {visible.length === 0 ? (
        <p className="w6w-muted w6w-small">
          No {noun.toLowerCase()} match “{query}”.
        </p>
      ) : (
        <div className="w6w-stepbuilder-list w6w-stepbuilder-scroll">
          {/* The SAME row component the home tab renders — same glyph, same
              tinted background. This list used to draw its own bare row, so a
              Function looked like one thing here and another there. */}
          {visible.map((it) => (
            <CallableRow key={it.id} family={family} item={it} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>,
  );
}

/**
 * A Workflow target's declared inputs, for the picker's Configure stage — the
 * entry/trigger step's own `with.fields` (core rfcs/node-types.md, the manual
 * trigger's `fields` param — see `INTERNAL_NODES`). A webhook/schedule trigger
 * declares no such fields, so this returns `[]` and the Configure stage's
 * `ParamsForm` renders empty, which is a legitimate call (no inputs to send).
 */
const TRIGGER_FIELD_TYPES: readonly string[] = ["string", "number", "boolean", "json"];

function triggerFieldsOf(wf: WorkflowDetail): ActionParam[] {
  const step = wf.steps.find((s) => isTriggerApp(s.uses.app));
  const raw = step?.with?.fields;
  if (!Array.isArray(raw)) return [];
  const out: ActionParam[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key : "";
    if (!key) continue;
    const type = typeof rec.type === "string" ? rec.type : "string";
    out.push({
      key,
      label: key,
      type: (TRIGGER_FIELD_TYPES.includes(type) ? type : "string") as ActionParam["type"],
      default: rec.default,
      required: Boolean(rec.required),
    });
  }
  return out;
}

/**
 * Config → test → add flow for a picked Function/Workflow target (D-12,
 * D-15). Mints a single `@w6w/call` step — `family` only decides which
 * summary/detail/invoke endpoints are called and what `with.targetKind` is
 * stamped; it is never two near-copies. Mirrors `ControlStepConfig`'s
 * progressive-commit shape (mint via `onAdd` the instant the target is
 * picked, then `onDraftChange` on every later change) — unlike `AppStepConfig`
 * there is no Setup tab (the target picked in `CallableList` IS the identity)
 * and no `NodeConfigForm` here: a second onError/retry form is out of scope —
 * `NodeConfigForm` is reached once the `@w6w/call` step already lives on a
 * canvas, not at add-time.
 */
export function CallableStepConfig({
  family,
  targetId,
  targetLabel,
  onAdd,
  onClose,
  onDraftChange,
}: {
  family: "function" | "workflow";
  targetId: string;
  targetLabel: string;
  // biome-ignore lint/suspicious/noConfusingVoidType: see StepBuilderModalProps.onAdd, forwarded as-is.
  onAdd: (s: BuiltStep) => string | undefined | void;
  onClose: () => void;
  /** See {@link StepBuilderModalProps.onDraftChange}. */
  onDraftChange?: (id: string, step: BuiltStep) => void;
}) {
  const api = useW6WApi();
  const [fields, setFields] = useState<ActionParam[] | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [wait, setWait] = useState(true);
  const [tab, setTab] = useState<"configure" | "test">("configure");
  // The id `onAdd` minted at commit time — see `ControlStepConfig`'s identical
  // field for the progressive-commit rationale.
  const [committedId, setCommittedId] = useState<string | null>(null);

  // Load the target's own declared inputs (acceptance 2b's seam pin: they
  // populate the `inputs` object below, never `input` singular).
  useEffect(() => {
    let canceled = false;
    setFields(null);
    setFieldsError(null);
    const p =
      family === "function"
        ? api.getFunction(targetId).then((d) => d.inputs)
        : api.getWorkflow(targetId).then(triggerFieldsOf);
    p.then((f) => !canceled && setFields(f)).catch(
      (e) => !canceled && setFieldsError((e as Error).message),
    );
    return () => {
      canceled = true;
    };
  }, [api, family, targetId]);

  const configComplete = fields !== null && requiredParamsFilled(fields, inputs);

  const buildStep = (): BuiltStep => ({
    uses: { app: CALL_APP, action: "call" },
    with: { targetKind: family, targetId, inputs, wait },
  });

  // Mint — a Function/Workflow target has identity the instant it's picked,
  // exactly like ControlStepConfig's mount-time mint. `CallableStepConfig` is
  // only ever mounted for one target: `StepBuilderModal` collapses into it via
  // `selectedCallable`, and "← Back" unmounts this subtree entirely rather
  // than re-parenting it onto a new `targetId`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mint fires once on mount only; buildStep/onAdd intentionally read fresh closure state without retriggering this effect.
  useEffect(() => {
    if (!onDraftChange) return;
    const id = onAdd(buildStep());
    if (id) setCommittedId(id);
  }, []);

  // Update — keep the already-committed node current on every later change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: buildStep reads fresh closure state; only these fields should retrigger the update.
  useEffect(() => {
    if (!onDraftChange || committedId === null) return;
    onDraftChange(committedId, buildStep());
  }, [committedId, inputs, wait]);

  const add = () => onAdd(buildStep());

  return (
    <div className="w6w-stepconfig">
      <div className="w6w-tabsbar">
        <div className="w6w-subtabs">
          <button
            type="button"
            className={`w6w-subtab${tab === "configure" ? " active" : ""}`}
            onClick={() => setTab("configure")}
          >
            Configure
          </button>
          <button
            type="button"
            disabled={!configComplete}
            title={configComplete ? undefined : "Fill the required fields first"}
            className={`w6w-subtab${tab === "test" ? " active" : ""}`}
            onClick={() => configComplete && setTab("test")}
          >
            Test
          </button>
        </div>
      </div>

      <div className="w6w-stepconfig-body">
        {tab === "configure" ? (
          <div className="w6w-stack">
            {fieldsError ? (
              <div className="w6w-result w6w-error">{fieldsError}</div>
            ) : fields === null ? (
              <p className="w6w-muted w6w-small">Loading {targetLabel}’s inputs…</p>
            ) : fields.length === 0 ? (
              <p className="w6w-muted w6w-small">
                {targetLabel} declares no inputs — it can be called as-is.
              </p>
            ) : (
              <ParamsForm params={fields} values={inputs} onChange={setInputs} />
            )}
            <label className="w6w-field">
              <span>
                <input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} />{" "}
                Wait for completion
              </span>
              <span className="w6w-hint">
                On: block until the sub-run finishes and expose its output. Off: return a run handle
                and continue.
              </span>
            </label>
          </div>
        ) : (
          <CallableTestRun
            family={family}
            targetId={targetId}
            inputs={inputs}
            canRun={configComplete}
          />
        )}
      </div>

      {/* Footer — pinned to the modal bottom, outside the scroll area. */}
      <div className="w6w-modal-actions w6w-stepconfig-footer">
        <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        {tab === "configure" ? (
          <button
            type="button"
            className="w6w-btn"
            disabled={!configComplete}
            onClick={() => setTab("test")}
          >
            Next →
          </button>
        ) : (
          <button type="button" className="w6w-btn" onClick={committedId !== null ? onClose : add}>
            {committedId !== null ? "Done" : "Add step"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline test run for a picked Function/Workflow — the picker's own Test stage
 * (D-11/D-15(c)): invokes the SAME `wait: true` path the saved step will take
 * at run time (`api.invokeFunction` / `api.runWorkflow`), never a client-side
 * poll. A Workflow's non-`terminal` result (the server's own `?wait=true`
 * timeout, a `202`) renders as "still running" with its `runId` — never a
 * silent no-op.
 */
function CallableTestRun({
  family,
  targetId,
  inputs,
  canRun,
}: {
  family: "function" | "workflow";
  targetId: string;
  inputs: Record<string, unknown>;
  canRun: boolean;
}) {
  const api = useW6WApi();
  const [state, setState] = useState<
    | { status: "running" }
    | { status: "done"; output: unknown; runId?: string; terminal: boolean; error?: unknown }
    | { status: "error"; error: string }
    | null
  >(null);

  const run = async () => {
    if (!canRun || state?.status === "running") return;
    setState({ status: "running" });
    try {
      if (family === "function") {
        const output = await api.invokeFunction(targetId, inputs);
        setState({ status: "done", output, terminal: true });
      } else {
        const r = await api.runWorkflow(targetId, { input: inputs });
        setState({
          status: "done",
          output: r.output,
          runId: r.runId,
          terminal: r.terminal,
          error: r.error,
        });
      }
    } catch (e) {
      setState({ status: "error", error: (e as { message?: string }).message ?? String(e) });
    }
  };

  return (
    <div className="w6w-steptest">
      <div className="w6w-steptest-bar">
        <button
          type="button"
          className="w6w-btn w6w-btn-ghost"
          disabled={!canRun || state?.status === "running"}
          onClick={run}
        >
          {state?.status === "running" ? "Running…" : "▶ Test run"}
        </button>
        {!canRun && <span className="w6w-muted w6w-small">Fill the required fields to test.</span>}
      </div>
      {state?.status === "error" && <div className="w6w-result w6w-error">{state.error}</div>}
      {state?.status === "done" && !state.terminal && (
        <div className="w6w-testout">
          <div className="w6w-testout-label">Still running</div>
          <div className="w6w-result">
            Run <code>{state.runId}</code> has not finished yet — check its status from the
            workflow's run history.
          </div>
        </div>
      )}
      {state?.status === "done" && state.terminal && state.error !== undefined && (
        <div className="w6w-testout">
          <div className="w6w-testout-label">Run failed</div>
          <pre
            className="w6w-result w6w-error"
            style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", margin: 0 }}
          >
            {JSON.stringify(state.error, null, 2)}
          </pre>
        </div>
      )}
      {state?.status === "done" && state.terminal && state.error === undefined && (
        <div className="w6w-testout">
          <div className="w6w-testout-label">Result</div>
          <pre
            className="w6w-result"
            style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", margin: 0 }}
          >
            {JSON.stringify(state.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Whether every required param has a usable value — gates the inline "Test run".
 * A required array (e.g. a `vars` table) may be empty (see the Data node); other
 * required fields must be non-empty.
 *
 * A param hidden by its own `showIf` is skipped, matching `ParamsForm`'s render
 * visibility — this is what lets `required` and `showIf` combine at all (e.g.
 * SendGrid's `contentValue`, required only when NOT using a dynamic template):
 * without it, a conditionally-required field would either block the gate in the
 * branch where it's moot, or (if left non-required to dodge that) never be
 * caught here and only surface as a raw runtime error from the app's own
 * `execute()` — the app was previously written the second way for exactly this
 * reason; that workaround was fixed alongside this once the gate learned `showIf`.
 */
export function requiredParamsFilled(
  params: ActionParam[],
  values: Record<string, unknown>,
): boolean {
  // Built once from the FULL top-level tree (not per-section) so a section
  // child's `showIf` can reference a sibling outside its own section — same
  // reasoning as `ParamsForm`'s `effective`.
  const flat = flattenParams(params);
  const effective = (key: string) =>
    values[key] !== undefined ? values[key] : flat.find((p) => p.key === key)?.default;

  const check = (list: ActionParam[]): boolean =>
    list.every((p) => {
      // A `section` is a layout-only container whose children write flat at this
      // level — recurse so a required child (e.g. a grouped Sender Email) still
      // gates. The section param itself carries no value.
      if (p.type === "section") return check(p.children ?? []);
      if (!p.required) return true;
      if (!isParamVisible(p, effective)) return true;
      const v = values[p.key] ?? p.default;
      if (v === undefined || v === null) return false;
      if (typeof v === "string") return v.trim() !== "";
      return true;
    });
  return check(params);
}

/**
 * Whether adding this step is gated on a **passing** saved test — the per-app
 * `testRequired` save-gate. Defaults to **required**; an app/node surface may
 * opt out by carrying `testRequired: false`.
 *
 * The flag is read defensively off the app/node surface because the core app
 * manifest does not carry a `testRequired` field yet (a recorded follow-up); an
 * absent flag therefore means **required**, so today every app step must pass a
 * test before it can be added.
 */
export function isTestRequired(surface: unknown): boolean {
  const flag = (surface as { testRequired?: unknown } | null | undefined)?.testRequired;
  return typeof flag === "boolean" ? flag : true;
}

type TestState =
  | { status: "running" }
  | { status: "done"; value: unknown; logs?: string[] }
  | { status: "error"; error: string; errorCode?: string; logs?: string[] };

/**
 * Where a test run should be persisted. When present, `StepTestRun` saves the
 * fixture (`saveStepTest`) and records the run's outcome (`recordStepTestRun`)
 * against the given workflow step after each invoke. `input` is the resolved
 * incoming state captured alongside the params (`values` → `with`). Absent in
 * the add-step builder (the step isn't in a workflow yet).
 */
export interface StepTestPersist {
  workflowId: string;
  stepId: string;
  input: Record<string, unknown>;
}

/** Imperative handle so a host (e.g. the step modal footer) can trigger the run. */
export interface StepTestRunHandle {
  run: () => void;
}

/**
 * Inline "Test run" — invokes the action/node with the current params (and, for
 * app actions, the chosen connection) so the user can try a step from inside the
 * builder before adding it. Pressable only once required fields are filled.
 *
 * When `persist` is supplied (the node editor's Test tab), each run also saves
 * the fixture and records the outcome server-side, so a step test becomes saved
 * and re-runnable. `hideRunButton` suppresses the inline button when the host
 * drives the run from elsewhere (the modal footer) via the imperative handle.
 */
export const StepTestRun = forwardRef<
  StepTestRunHandle,
  {
    app: string;
    action: string;
    connectionId?: string;
    values: Record<string, unknown>;
    canRun: boolean;
    hideRunButton?: boolean;
    persist?: StepTestPersist;
    /**
     * The run's start state — what the upstream steps last produced — so a
     * `values` entry written as `{{ steps.<id>.output.<field> }}` resolves
     * server-side instead of coming back empty. The host builds it (both the
     * node editor's Test tab and, since T1.1.1, the add-step builder's Test
     * tab seed it from the upstream fixtures, via `useSeedSources` +
     * `startStateFromSeeds`); absent only when the host itself has no upstream
     * steps to offer — the Functions/Endpoints pickers, which have no graph.
     */
    state?: StepStartState;
    /** Notified when the run starts/finishes so a host button can reflect it. */
    onBusyChange?: (busy: boolean) => void;
    /**
     * Notified with the outcome of each finished run (`true` = passed). Lets a
     * host satisfy the `testRequired` save-gate from an in-session test run.
     */
    onResult?: (passed: boolean) => void;
  }
>(function StepTestRun(
  {
    app,
    action,
    connectionId,
    values,
    canRun,
    hideRunButton,
    persist,
    state: startState,
    onBusyChange,
    onResult,
  },
  ref,
) {
  const api = useW6WApi();
  // Resolve document expressions against the workflow's selected project (the
  // editor provides it; undefined outside the editor → server default project).
  const project = useWorkflowProject();
  const [state, setState] = useState<TestState | null>(null);

  const run = async () => {
    if (!canRun || state?.status === "running") return;
    setState({ status: "running" });
    onBusyChange?.(true);
    let outcome: Exclude<TestState, { status: "running" }>;
    try {
      const result = await api.invokeAction(app, action, values, {
        ...(connectionId ? { connectionId } : {}),
        project,
        // Omitted when the host has no upstream state to offer, so the request
        // is unchanged for every caller that never had one.
        ...(startState ? { state: startState } : {}),
      });
      outcome = {
        status: "done",
        value: result.value,
        logs: (result as { logs?: string[] }).logs,
      };
    } catch (e) {
      const err = e as { message?: string; code?: string; logs?: string[] };
      outcome = {
        status: "error",
        error: err.message ?? String(e),
        errorCode: err.code,
        logs: err.logs,
      };
    }
    setState(outcome);
    onResult?.(outcome.status === "done");
    // Persist the fixture + record the outcome when the host targets a workflow
    // step. Best-effort: a failed save must never mask the run's own result.
    if (persist) {
      try {
        const saved = await api.saveStepTest(persist.workflowId, persist.stepId, {
          input: persist.input,
          with: values,
        });
        await api.recordStepTestRun(persist.workflowId, persist.stepId, {
          stepTestId: saved.id,
          status: outcome.status === "done" ? "succeeded" : "failed",
          input: persist.input,
          output: outcome.status === "done" ? outcome.value : undefined,
          error: outcome.status === "error" ? outcome.error : undefined,
        });
      } catch (err) {
        console.error("step test persist failed", err);
      }
    }
    onBusyChange?.(false);
  };

  useImperativeHandle(ref, () => ({ run }));

  const logs = state && state.status !== "running" ? state.logs : undefined;

  return (
    <div className="w6w-steptest">
      {!hideRunButton && (
        <div className="w6w-steptest-bar">
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost"
            disabled={!canRun || state?.status === "running"}
            onClick={run}
          >
            {state?.status === "running" ? "Running…" : "▶ Test run"}
          </button>
          {!canRun && (
            <span className="w6w-muted w6w-small">Fill the required fields to test.</span>
          )}
        </div>
      )}
      {state?.status === "error" && (
        <div className="w6w-result w6w-error">
          {state.errorCode && (
            <div className="w6w-small" style={{ opacity: 0.75, marginBottom: 4 }}>
              <code>{state.errorCode}</code>
            </div>
          )}
          {state.error}
        </div>
      )}
      {state?.status === "done" && (
        <div className="w6w-testout">
          <div className="w6w-testout-label">Result (return value)</div>
          <pre
            className="w6w-result"
            style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", margin: 0 }}
          >
            {JSON.stringify(state.value, null, 2)}
          </pre>
        </div>
      )}
      {logs && logs.length > 0 && (
        <div className="w6w-testout">
          <div className="w6w-testout-label">Console output</div>
          <pre
            className="w6w-result w6w-testout-console"
            style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", margin: 0 }}
          >
            {logs.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
});

// ── Connected apps tab (default) ─────────────────────────────────────────────

/**
 * What the home tab has to show. Lifted out of the tab's own component because
 * the MODAL needs the answer too: a home tab with nothing in it is not
 * rendered at all (no connected apps, no Functions, no Workflows ⇒ no tab),
 * and that decision belongs to whoever draws the sidebar.
 *
 * `state` is deliberately four-valued. "Empty" and "not loaded yet" must not
 * collapse into one: hiding the tab while its fetches are in flight would make
 * it appear a beat later, moving the sidebar under the cursor.
 */
interface ReadyToUse {
  state: "loading" | "error" | "empty" | "ready";
  error?: string;
  apps: AppSummary[];
  fns: FunctionSummary[];
  wfs: WorkflowSummary[];
}

function useReadyToUse(callables: readonly ("function" | "workflow")[]): ReadyToUse {
  const api = useW6WApi();
  const [connectedIds, setConnectedIds] = useState<Set<string> | null>(null);
  const [allApps, setAllApps] = useState<AppSummary[] | null>(null);
  const [fns, setFns] = useState<FunctionSummary[] | null>(null);
  const [wfs, setWfs] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wantFns = callables.includes("function");
  const wantWfs = callables.includes("workflow");

  useEffect(() => {
    let canceled = false;
    const fail = (e: unknown) => !canceled && setError((e as Error).message);
    api
      .listConnections()
      .then((conns) => !canceled && setConnectedIds(new Set(conns.map((c) => c.appId))))
      .catch(fail);
    api
      .listApps()
      .then((r) => !canceled && setAllApps(r))
      .catch(fail);
    // A family this picker does not offer is never fetched, and resolves to an
    // empty list so the readiness check below still completes.
    if (wantFns) {
      api
        .listFunctions()
        .then((r) => !canceled && setFns(r))
        .catch(fail);
    } else setFns([]);
    if (wantWfs) {
      api
        .listWorkflows()
        .then((r) => !canceled && setWfs(r))
        .catch(fail);
    } else setWfs([]);
    return () => {
      canceled = true;
    };
  }, [api, wantFns, wantWfs]);

  if (error) return { state: "error", error, apps: [], fns: [], wfs: [] };
  if (connectedIds === null || allApps === null || fns === null || wfs === null) {
    return { state: "loading", apps: [], fns: [], wfs: [] };
  }
  // Reserved `@w6w/*` pseudo-apps are never connectable — they are added from
  // the Controls/Utilities tabs, exactly as `AppPicker` excludes them.
  const apps = allApps.filter((a) => !isInternalApp(a.id) && connectedIds.has(a.id));
  const empty = apps.length === 0 && fns.length === 0 && wfs.length === 0;
  return { state: empty ? "empty" : "ready", apps, fns, wfs };
}

/** Sort helper — by display label, case-insensitively. */
function byLabel<T>(label: (t: T) => string) {
  return (a: T, b: T) => label(a).localeCompare(label(b), undefined, { sensitivity: "base" });
}

/** A Function/Workflow summary's display name, falling back to name then id. */
function callableLabel(it: FunctionSummary | WorkflowSummary): string {
  const dn = it.displayName;
  if (dn?.trim()) return dn;
  return "name" in it ? it.name : it.id;
}

/**
 * One Function/Workflow row. Shared by the home tab and by the Workflows and
 * Functions tabs, so a Function looks like a Function wherever it is offered —
 * same glyph, same tinted background. Two surfaces drawing the same thing
 * differently is how a list stops being learnable.
 */
function CallableRow({
  family,
  item,
  onSelect,
}: {
  family: "function" | "workflow";
  item: FunctionSummary | WorkflowSummary;
  onSelect: (t: { id: string; label: string }) => void;
}) {
  const label = callableLabel(item);
  return (
    <button
      type="button"
      className="w6w-stepbuilder-item w6w-stepbuilder-item--callable"
      data-kind={family}
      onClick={() => onSelect({ id: item.id, label })}
    >
      <InternalIcon icon={CALLABLE_GLYPH[family]} size={24} />
      <span className="w6w-stepbuilder-item-main">
        <strong>{label}</strong>
        <code className="w6w-muted w6w-small">{item.id}</code>
      </span>
    </button>
  );
}

/**
 * The picker's home tab — **everything already usable**, in the two-column
 * layout the intake draws:
 *
 *     Connnected apps | functions
 *                     | workflows
 *
 * Connected apps down the left; Functions above Workflows down the right, with
 * a rule between the halves. That sketch is a LAYOUT, not a tab list — it was
 * built as three sidebar tabs first, and that was wrong twice over: the three
 * kinds belong on one screen, side by side, so the author sees everything they
 * can reach without navigating. The browse-everything tabs (Apps, AI,
 * Workflows, Functions) still sit below this one for the full catalogues.
 *
 * "Ready to use" rather than "Connected apps": what unites the columns is that
 * none of them needs setting up before it can be picked. The Apps tab, by
 * contrast, is the catalogue, where picking may mean connecting first.
 *
 * **Every empty column disappears** — heading and all. A "Workflows" heading
 * over nothing claims you have workflows ready to use, which is exactly what
 * an empty list is telling you is false. No connected apps ⇒ no left column,
 * and the grid collapses to one. Nothing at all ⇒ the modal does not render
 * the tab (see {@link useReadyToUse}), so this component never sees that case.
 *
 * No search box: the original Connected-apps tab ran `AppPicker` with
 * `search={false}`, and short scoped lists are not the surface a search box
 * earns. The Apps/Workflows/Functions tabs each keep their own.
 */
function ReadyToUseFlow({
  data,
  onSelectApp,
  onSelectCallable,
  theme,
}: {
  data: ReadyToUse;
  onSelectApp: (app: AppSummary) => void;
  onSelectCallable: (t: { family: "function" | "workflow"; id: string; label: string }) => void;
  theme?: ThemeMode;
}) {
  // Single layout owner for every exit, so the panel never resizes between
  // error/loading and the loaded columns — mirrors `.w6w-apppicker-host`'s role
  // in `AppPicker` and `CallableList`.
  const host = (body: ReactNode) => <div className="w6w-apppicker-host">{body}</div>;

  if (data.state === "error") {
    return host(<div className="w6w-result w6w-error">{data.error}</div>);
  }
  if (data.state === "loading") return host(<p className="w6w-muted w6w-small">Loading…</p>);

  const apps = [...data.apps].sort(byLabel((a: AppSummary) => a.displayName));
  const fns = [...data.fns].sort(byLabel(callableLabel));
  const wfs = [...data.wfs].sort(byLabel(callableLabel));

  /** One column: a heading and its rows. Rendered only when it HAS rows. */
  const column = (title: string, rows: ReactNode[]) =>
    rows.length === 0 ? null : (
      <section className="w6w-readytouse-col">
        <h4 className="w6w-readytouse-heading">{title}</h4>
        <div className="w6w-stepbuilder-list w6w-stepbuilder-scroll">{rows}</div>
      </section>
    );

  const left = column(
    "Connected apps",
    apps.map((a) => (
      <button
        key={a.id}
        type="button"
        className="w6w-stepbuilder-item"
        data-kind="app"
        onClick={() => onSelectApp(a)}
      >
        <AppIcon
          src={a.iconSvg}
          srcDark={a.iconSvgDark}
          brandColor={a.brandColor}
          name={a.displayName}
          theme={theme}
          size={24}
        />
        <span className="w6w-stepbuilder-item-main">
          <strong>{a.displayName}</strong>
          <code className="w6w-muted w6w-small">{a.id}</code>
        </span>
      </button>
    )),
  );

  // Functions above Workflows — the order the intake draws them in.
  const right = [
    column(
      "Functions",
      fns.map((f) => (
        <CallableRow
          key={f.id}
          family="function"
          item={f}
          onSelect={(t) => onSelectCallable({ family: "function", ...t })}
        />
      )),
    ),
    column(
      "Workflows",
      wfs.map((w) => (
        <CallableRow
          key={w.id}
          family="workflow"
          item={w}
          onSelect={(t) => onSelectCallable({ family: "workflow", ...t })}
        />
      )),
    ),
  ].filter(Boolean);

  // `data-cols` drives the grid template, so a missing half collapses rather
  // than leaving an empty tract — and the divider only exists when there are
  // in fact two halves to divide.
  const cols = (left ? 1 : 0) + (right.length > 0 ? 1 : 0);
  return host(
    <div className="w6w-readytouse" data-cols={cols}>
      {left}
      {right.length > 0 && <div className="w6w-readytouse-stack">{right}</div>}
    </div>,
  );
}

export function AppStepConfig({
  appId,
  app,
  onAdd,
  onClose,
  onDraftChange,
  onChangeApp,
  theme,
  workflowId,
  stepId,
  upstreamSteps = [],
  initialAction,
  initialConnection,
  initialWith,
}: {
  appId: string;
  app?: AppSummary;
  // biome-ignore lint/suspicious/noConfusingVoidType: see StepBuilderModalProps.onAdd, forwarded as-is.
  onAdd: (s: BuiltStep) => string | undefined | void;
  onClose: () => void;
  /** See {@link StepBuilderModalProps.onDraftChange}. */
  onDraftChange?: (id: string, step: BuiltStep) => void;
  onChangeApp?: () => void;
  theme?: ThemeMode;
  workflowId?: string;
  stepId?: string;
  /** The new step's known graph ancestors — see {@link StepBuilderModalProps.upstreamSteps}. */
  upstreamSteps?: ExpressionStepSource[];
  /** Pre-selected action key, opens directly to Configure tab when provided with initialWith */
  initialAction?: string;
  /** Pre-selected connection id */
  initialConnection?: string;
  /** Pre-filled parameter values */
  initialWith?: Record<string, unknown>;
}) {
  const api = useW6WApi();
  const [auths, setAuths] = useState<AuthDef[] | null>(null);
  const [conns, setConns] = useState<ConnectionSummary[] | null>(null);
  const [actions, setActions] = useState<ActionDef[] | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [connectionId, setConnectionId] = useState<string>(initialConnection ?? "");
  const [actionKey, setActionKey] = useState<string>(initialAction ?? "");
  const [withValues, setWithValues] = useState<Record<string, unknown>>(initialWith ?? {});
  const [showConnModal, setShowConnModal] = useState(false);
  // Once a connection is chosen it renders as a static label; "Change" flips
  // back to the dropdown. No connection selected yet also forces the dropdown.
  const [changingConn, setChangingConn] = useState(false);
  // Setup (app + connection + action) / Configure (params) / Test — same tabs as
  // the node editor, so add + edit are consistent.
  // When initial values are provided, skip Setup and open directly to Configure.
  const [tab, setTab] = useState<StepConfigTab>(
    initialAction && initialWith ? "configure" : "setup",
  );
  // The Configure tab's four representations (form / full-step JSON /
  // params-only JSON / node settings).
  const [configView, setConfigView] = useState<ConfigView>("props");
  // Draft text backing the "code" (full-step, read-only) view.
  const [codeText, setCodeText] = useState("{}");
  // Draft text backing the "params-code" (params-only, writable) view.
  const [paramsCodeText, setParamsCodeText] = useState("{}");
  // Base node settings (retry / onError / notes) set on the Config view.
  const [draftConfig, setDraftConfig] = useState<NodeConfig>({});

  // Load auth methods, existing connections, and actions for the app in parallel.
  useEffect(() => {
    let canceled = false;
    setMetaError(null);
    Promise.all([api.getAppAuth(appId), api.listConnectionsForApp(appId), api.getAppActions(appId)])
      .then(([au, co, ac]) => {
        if (canceled) return;
        setAuths(au);
        setConns(co);
        setActions(ac);
        if (co.length > 0) setConnectionId(co[0].id);
      })
      .catch((e) => !canceled && setMetaError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api, appId]);

  const refetchConns = async () => {
    const co = await api.listConnectionsForApp(appId);
    setConns(co);
    if (co.length > 0) setConnectionId((prev) => prev || co[0].id);
  };

  const availableAuths = (auths ?? []).filter((a) => a.available !== false);
  const needsConnection = availableAuths.length > 0;
  const hasConnection = (conns ?? []).length > 0;
  const selectedAction = (actions ?? []).find((a) => a.key === actionKey);
  // Alphabetical by display title (falling back to key) so the dropdown is
  // scannable regardless of the manifest's declaration order.
  const sortedActions = [...(actions ?? [])].sort((a, b) =>
    (a.title ?? a.key).localeCompare(b.title ?? b.key, undefined, { sensitivity: "base" }),
  );

  // Per-app `testRequired` save-gate — defaults to required, read off the app
  // surface. `testPassed` is satisfied either by an in-session passing test run
  // (below) or by a previously-saved passing test discovered via `listStepTests`
  // when the builder carries a workflow-step context.
  const testRequired = isTestRequired(app);
  const [testPassed, setTestPassed] = useState(false);
  useEffect(() => {
    if (!testRequired || !workflowId || !stepId) return;
    let canceled = false;
    api
      .listStepTests(workflowId, stepId)
      .then((tests) => {
        if (!canceled && tests.some((t) => t.lastRunStatus === "succeeded")) setTestPassed(true);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [api, testRequired, workflowId, stepId]);

  // The step-being-added's graph ancestors that carry a saved step-test,
  // offered as one-click seeds for the incoming state — the SAME pipeline
  // `StepEditModal` uses, so the Test tab here resolves
  // `{{ steps.<id>.output.<field> }}` the same way an existing step's Test
  // tab does (T1.1.1). Only meaningful when the builder was opened from a
  // workflow canvas (`workflowId` present); the Functions/Endpoints pickers
  // pass no `workflowId` and no `upstreamSteps`.
  const seedSources = useSeedSources(workflowId ?? "", upstreamSteps, !!workflowId);
  const testStartState = startStateFromSeeds(seedSources);

  const connectionSatisfied = !needsConnection || (hasConnection && !!connectionId);
  // Setup is done when an action is picked and its connection (if any) is set;
  // Configure is done when the action's required params are filled.
  const setupComplete = !!actionKey && connectionSatisfied;
  const configComplete =
    setupComplete &&
    !!selectedAction &&
    requiredParamsFilled(selectedAction.params ?? [], withValues);
  // HITL-1 amendment: a passing test is required to *publish* (T4.2.1), not to
  // add the step to the graph — `testRequired`/`testPassed` still drive the
  // Test tab's own "test passed" messaging below.
  const canAdd = setupComplete;

  const selectedConn = (conns ?? []).find((c) => c.id === connectionId);
  // Show the dropdown only before a connection is picked or while changing it;
  // otherwise the selected connection reads as a compact label.
  const showConnPicker = changingConn || !connectionId;

  function buildStep(): BuiltStep {
    return {
      uses: {
        app: appId,
        action: selectedAction?.key ?? actionKey,
        ...(needsConnection && connectionId ? { connection: connectionId } : {}),
      },
      with: withValues,
      ...draftConfig,
    };
  }
  function add() {
    if (!selectedAction) return;
    onAdd(buildStep());
  }

  // The id `onAdd` minted at commit time, once Setup has completed this
  // session. `null` until then (and forever, for a caller that doesn't supply
  // `onDraftChange` — the original one-shot "Add step" behavior).
  const [committedId, setCommittedId] = useState<string | null>(null);

  // Mint — the moment Setup first completes (action + connection, if needed),
  // commit the WIP step to the graph, exactly once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: buildStep/onAdd intentionally read fresh closure state; only the mint gate should retrigger this effect.
  useEffect(() => {
    if (!onDraftChange || committedId !== null || !setupComplete) return;
    const id = onAdd(buildStep());
    if (id) setCommittedId(id);
  }, [onDraftChange, committedId, setupComplete]);

  // Update — keep the already-committed node current on every subsequent field
  // change, instead of minting a duplicate via a second `onAdd` call.
  // biome-ignore lint/correctness/useExhaustiveDependencies: buildStep reads fresh closure state; only these fields should retrigger the update.
  useEffect(() => {
    if (!onDraftChange || committedId === null) return;
    onDraftChange(committedId, buildStep());
  }, [committedId, withValues, draftConfig, connectionId]);

  const changeConfigView = (v: ConfigView) => {
    if (v === "code") setCodeText(stepToJson(buildStep()));
    else if (v === "params-code") setParamsCodeText(paramsToJson(buildStep()));
    setConfigView(v);
  };

  return (
    <div className="w6w-stepconfig">
      {/* Tabs bar — full width: Setup/Configure/Test on the left, the props/code/
          config view icons on the right (enabled only on the Configure tab). */}
      <div className="w6w-tabsbar">
        <div className="w6w-subtabs">
          <button
            type="button"
            className={`w6w-subtab${tab === "setup" ? " active" : ""}`}
            onClick={() => setTab("setup")}
          >
            Setup
          </button>
          <button
            type="button"
            disabled={!setupComplete}
            title={setupComplete ? undefined : "Complete Setup first"}
            className={`w6w-subtab${tab === "configure" ? " active" : ""}`}
            onClick={() => setupComplete && setTab("configure")}
          >
            Configure
          </button>
          <button
            type="button"
            disabled={!configComplete}
            title={configComplete ? undefined : "Fill the required fields first"}
            className={`w6w-subtab${tab === "test" ? " active" : ""}`}
            onClick={() => configComplete && setTab("test")}
          >
            Test
          </button>
        </div>
        <ConfigViewToggle
          view={configView}
          onChange={changeConfigView}
          disabled={tab !== "configure"}
        />
      </div>

      <div className="w6w-stepconfig-body">
        {/* Setup — app, connection, action. */}
        {tab === "setup" && (
          <div className="w6w-stack">
            {metaError && <div className="w6w-result w6w-error">{metaError}</div>}
            {auths === null && !metaError && <p className="w6w-muted w6w-small">Loading…</p>}

            {/* App — click Change to go back to the app picker. */}
            <div className="w6w-field">
              <span>App</span>
              <div className="w6w-conn-label">
                {app && (
                  <AppIcon
                    src={app.iconSvg}
                    srcDark={app.iconSvgDark}
                    brandColor={app.brandColor}
                    name={app.displayName}
                    theme={theme}
                    size={20}
                  />
                )}
                <span className="w6w-conn-label-name">{app?.displayName ?? appId}</span>
                {onChangeApp && (
                  <button
                    type="button"
                    className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                    onClick={onChangeApp}
                  >
                    Change
                  </button>
                )}
              </div>
            </div>

            {/* Connection */}
            {auths !== null &&
              needsConnection &&
              (!hasConnection ? (
                <div className="w6w-result w6w-stepconfig-conn-empty">
                  <div style={{ marginBottom: 8 }}>
                    This app needs a connection before its actions can run.
                  </div>
                  <button type="button" className="w6w-btn" onClick={() => setShowConnModal(true)}>
                    Create connection
                  </button>
                </div>
              ) : showConnPicker ? (
                <label className="w6w-field">
                  <span>Connection</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={connectionId}
                      onChange={(e) => {
                        setConnectionId(e.target.value);
                        setChangingConn(false);
                      }}
                      style={{ flex: 1 }}
                    >
                      {(conns ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName || c.id} {c.state ? `(${c.state})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="w6w-btn w6w-btn-ghost"
                      onClick={() => setShowConnModal(true)}
                    >
                      + New
                    </button>
                  </div>
                </label>
              ) : (
                <div className="w6w-field">
                  <span>Connection</span>
                  <div className="w6w-conn-label">
                    <span className="w6w-conn-label-name">
                      {selectedConn?.displayName || selectedConn?.id || connectionId}
                      {selectedConn?.state ? ` (${selectedConn.state})` : ""}
                    </span>
                    <button
                      type="button"
                      className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                      onClick={() => setChangingConn(true)}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="w6w-btn w6w-btn-ghost w6w-btn-sm"
                      onClick={() => setShowConnModal(true)}
                    >
                      + New
                    </button>
                  </div>
                </div>
              ))}

            {/* Action */}
            {actions !== null &&
              (actions.length === 0 ? (
                <p className="w6w-muted w6w-small">This app exposes no actions.</p>
              ) : (
                <label className="w6w-field">
                  <span>Action{actionKey ? "" : " *"}</span>
                  <select
                    value={actionKey}
                    onChange={(e) => {
                      setActionKey(e.target.value);
                      setWithValues({});
                      // A new action hasn't been tested — re-arm the save-gate.
                      setTestPassed(false);
                    }}
                  >
                    <option value="">— pick an action —</option>
                    {sortedActions.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.title ?? a.key} ({a.key})
                      </option>
                    ))}
                  </select>
                  {selectedAction?.description && (
                    <span className="w6w-hint">{selectedAction.description}</span>
                  )}
                </label>
              ))}
          </div>
        )}

        {/* Configure — the action's config, as a form (props), the full step
            (code), the params alone (params-code), or the base node settings
            (config). */}
        {tab === "configure" &&
          (!selectedAction ? (
            <p className="w6w-muted w6w-small">Pick an action in Setup first.</p>
          ) : configView === "props" ? (
            <ParamsForm
              params={selectedAction.params ?? []}
              values={withValues}
              onChange={setWithValues}
            />
          ) : configView === "code" ? (
            // Full step, read-only (D-3) — `stepToJson` is the ONE serializer,
            // shared with the two other code-view hosts.
            <JsonEditor
              value={codeText}
              onChange={() => {}}
              readOnly
              minHeight="240px"
              height="100%"
              aria-label="Step JSON"
            />
          ) : configView === "params-code" ? (
            <JsonEditor
              value={paramsCodeText}
              onChange={setParamsCodeText}
              minHeight="240px"
              height="100%"
              aria-label="Parameters JSON"
              onValidChange={(p) =>
                p &&
                typeof p === "object" &&
                !Array.isArray(p) &&
                setWithValues(p as Record<string, unknown>)
              }
            />
          ) : (
            <NodeConfigForm config={draftConfig} onChange={setDraftConfig} />
          ))}

        {/* Test — try the action with the current params. */}
        {tab === "test" &&
          (selectedAction ? (
            <StepTestRun
              app={appId}
              action={selectedAction.key}
              connectionId={needsConnection && connectionId ? connectionId : undefined}
              values={withValues}
              canRun={
                setupComplete && requiredParamsFilled(selectedAction.params ?? [], withValues)
              }
              state={testStartState}
              onResult={setTestPassed}
            />
          ) : (
            <p className="w6w-muted w6w-small">Pick an action in Setup first.</p>
          ))}
      </div>

      {/* Test-required note — always rendered while on the Test tab, as a
          sibling ABOVE the footer, so the footer's two buttons never move
          whether the note has text or not (the row's reserved min-height
          keeps both states geometrically identical). */}
      {tab === "test" && (
        <div className="w6w-stepconfig-testnote">
          {testRequired && !testPassed && (
            <span className="w6w-muted w6w-small">
              Not yet tested — a passing test is required before this step can be published.
            </span>
          )}
        </div>
      )}

      {/* Footer — pinned to the modal bottom. Each tab has a Next button; the
          last (Test) commits the step. */}
      <div className="w6w-modal-actions w6w-stepconfig-footer">
        <button type="button" className="w6w-btn w6w-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        {tab === "test" ? (
          <button
            type="button"
            className="w6w-btn"
            disabled={committedId === null && !canAdd}
            onClick={committedId !== null ? onClose : add}
          >
            {committedId !== null ? "Done" : "Add step"}
          </button>
        ) : (
          <button
            type="button"
            className="w6w-btn"
            disabled={tab === "setup" ? !setupComplete : !configComplete}
            onClick={() => setTab(tab === "setup" ? "configure" : "test")}
          >
            Next →
          </button>
        )}
      </div>

      {showConnModal && (
        <AddConnectionModal
          theme={theme}
          initialAppId={appId}
          onClose={() => setShowConnModal(false)}
          onCreated={async ({ connectionId: id }) => {
            setShowConnModal(false);
            setConnectionId(id);
            setChangingConn(false);
            await refetchConns();
          }}
        />
      )}
    </div>
  );
}
