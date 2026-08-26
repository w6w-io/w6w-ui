/**
 * Provider + hook that give every component a single, typed w6w API client.
 *
 * Consumers wrap their app once and every component under it can grab the
 * client via `useW6WApi()` — no more per-component callback prop drilling.
 *
 *   const api = createW6WApi({ baseUrl: "/api", token });
 *   <W6WUIProvider api={api}>...</W6WUIProvider>
 *
 * Embedding inside a host app that has its own theme? Pass `theme` too — see
 * this file's `W6WUIProviderProps.theme` doc and `docs/theming.md`.
 */
import { type ReactNode, createContext, useContext } from "react";
import { ProvidedThemeCtx } from "./theme.ts";
import type {
  ActionDef,
  ApiCallRecord,
  AppSummary,
  AuthDef,
  ConnectionSummary,
  FunctionDetail,
  FunctionSummary,
  SavedTest,
  SubscriptionSummary,
  ThemeMode,
  TriggerSummary,
  WorkflowDetail,
  WorkflowSummary,
} from "./types.ts";

/**
 * A single tester-run summary from the unified `run_log` ledger, keyed to a
 * connection. Thin by design — the full result payload stays server-side in
 * `saved_test_runs`; this is the history row shown in the test screens.
 * `summary` is null when the run recorded no summary; `occurredAt` is ISO.
 */
export interface TestRunSummary {
  id: string;
  actionKey: string;
  ok: boolean;
  summary: string | null;
  occurredAt: string;
}

/**
 * A saved per-step test fixture — a reusable, project-owned named capture of a
 * workflow step's resolved incoming state (`input`) and its params (`with`),
 * keyed by `(workflowId, stepId)`. Mirrors the connection-scoped `SavedTest`,
 * re-keyed to a workflow step. `lastRun*` denormalizes the most recent run.
 */
export interface StepTest {
  id: string;
  workflowId: string;
  stepId: string;
  name: string | null;
  input: Record<string, unknown>;
  with: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** When this fixture was last run (ISO), or null/undefined if never run. */
  lastRunAt?: string | null;
  /** The most recent run's status (e.g. `succeeded`/`failed`), or null. */
  lastRunStatus?: string | null;
  /** The most recent run's error payload, or null when it succeeded/never ran. */
  lastRunError?: unknown;
  /** The most recent run's captured output, or null. */
  lastRunOutput?: unknown;
}

/**
 * The **start state** a single-step invoke may carry — the RFC's third
 * `executeNode(workflow, nodeId, startState)` argument
 * (`core/rfcs/node-types.md`), sent as the invoke body's `state` field.
 *
 * Structurally the server's `StartStateInput`
 * (`server/packages/api/ambient-scope.ts`): `steps` seeds `steps.<id>.output`
 * and `trigger.event` seeds `trigger.event`, so a `with` block written as
 * `{{ steps.<id>.output.<field> }}` resolves instead of concatenating as `""`.
 * Anything else in it is ignored server-side — `vars`, `documents` and
 * `secrets` are host-owned and loaded from the caller's authenticated scope, so
 * a start state can only echo back data the caller already had.
 *
 * ⚠️ It is honoured by the **single-step** invoke route only. A full run
 * (`POST /workflows/:id/run`) builds its own scope and takes nothing from here.
 */
export interface StepStartState {
  /** Outputs of steps that already ran, keyed by step id → `steps.<id>.output`. */
  steps?: Record<string, { output?: unknown }>;
  /** Trigger context; only `event` is honoured → `trigger.event`. */
  trigger?: { event?: unknown };
}

/**
 * The surface every w6w-io component may call. Grows as we add components;
 * new members are added at the end so consumer implementations only need to
 * grow when they want to use the new component.
 */
export interface W6WApi {
  /** List registered apps to pick from in the connection modal. */
  listApps(): Promise<AppSummary[]>;

  /** Load auth methods declared by an app's manifest, with availability flags. */
  getAppAuth(appId: string): Promise<AuthDef[]>;

  /** Create a non-OAuth connection with a user-supplied credential. */
  createConnection(
    appId: string,
    body: {
      authKey: string;
      credential: Record<string, unknown>;
      displayName?: string;
      profile?: Record<string, unknown>;
    },
  ): Promise<ConnectionSummary>;

  /**
   * Start an OAuth 2.0 flow. Server builds the provider's authorize URL and
   * returns it; the caller opens it in a popup and awaits the server's
   * callback message (see `startOAuthPopup`).
   */
  startAppOAuthFlow(
    appId: string,
    authKey: string,
    body: { displayName?: string },
  ): Promise<{ authorizationUrl: string }>;

  /** List the actions an app exposes, to pick from in the step builder. */
  getAppActions(appId: string): Promise<ActionDef[]>;

  /** List the connections that already exist for a given app. */
  listConnectionsForApp(appId: string): Promise<ConnectionSummary[]>;

  /** List every connection across apps — drives the "Connected apps" tab. */
  listConnections(): Promise<ConnectionSummary[]>;

  /**
   * Invoke a single action — used to test-run one step from the visual editor.
   * Pass `connectionId` to run with a stored connection's credential. Pass
   * `project` to resolve document expressions against the workflow's selected
   * project (omitted → the scope's default/starter project). Pass `state` — the
   * {@link StepStartState} — so `{{ steps.<id>.output.<field> }}` in the params
   * resolves against what those upstream steps last produced; omitted, every
   * such reference resolves to the empty string.
   *
   * `apiCalls` carries the outbound HTTP calls the action made (redacted); a
   * failed invoke rejects with an `ApiError` whose `body ?? raw` holds the same
   * field (ui's own class carries it on `body`, `@w6w/sdk`'s on `raw`).
   */
  invokeAction(
    appId: string,
    actionKey: string,
    params: Record<string, unknown>,
    opts?: { connectionId?: string; project?: string; state?: StepStartState },
  ): Promise<{ value: unknown; logs?: string[]; apiCalls?: ApiCallRecord[] }>;

  /** List the saved action-test inputs stored against a connection. */
  listSavedTests(connectionId: string): Promise<SavedTest[]>;

  /** Save a new set of action-test inputs against a connection. */
  createSavedTest(
    connectionId: string,
    body: { actionKey: string; name: string; values: Record<string, unknown> },
  ): Promise<SavedTest>;

  /** Rename a saved test or replace its stored input values. */
  updateSavedTest(
    connectionId: string,
    id: string,
    patch: { name?: string; values?: Record<string, unknown> },
  ): Promise<SavedTest>;

  /** Delete a saved test by id. */
  deleteSavedTest(connectionId: string, id: string): Promise<void>;

  /**
   * Record the outcome of an action-test run against a connection. Appends a
   * run-log row server-side; when `savedTestId` is present the saved test's
   * `lastRun*` fields are updated too. POSTs to `/connections/:connId/test-runs`.
   */
  recordTestRun(
    connId: string,
    body: {
      savedTestId?: string | null;
      actionKey: string;
      ok: boolean;
      summary?: string;
      result?: unknown;
    },
  ): Promise<void>;

  /**
   * List a connection's recent tester-run history from the unified `run_log`
   * ledger (`GET /connections/:connId/test-runs` → the `.runs` array). Powers
   * the run-history list in the test screens, complementing the per-test
   * `lastRun*` badge with the full ledger.
   *
   * OPTIONAL: consumers that don't render history (or haven't wired it up yet)
   * may omit it, so a missing member never poisons their typecheck. Callers
   * MUST guard on its presence before invoking.
   */
  listTestRuns?(connectionId: string): Promise<TestRunSummary[]>;

  /**
   * Save a reusable per-step test fixture against a workflow step. Captures the
   * resolved incoming state (`input`) and the step's params (`with`); the server
   * stores both verbatim, project-owned. Mirrors `createSavedTest`, re-keyed from
   * a connection to a `(workflowId, stepId)`. POSTs to
   * `/workflows/:workflowId/steps/:stepId/tests`.
   */
  saveStepTest(
    workflowId: string,
    stepId: string,
    body: { name?: string; input: Record<string, unknown>; with: Record<string, unknown> },
  ): Promise<StepTest>;

  /**
   * Record the outcome of a step-test run so every run (saved or ad-hoc) is
   * logged authoritatively server-side. The run row mirrors `node_executions`
   * (status/input/output/error). When `stepTestId` is present the fixture's
   * `lastRun*` fields are updated too. Mirrors `recordTestRun`, re-keyed to a
   * workflow step. POSTs to `/workflows/:workflowId/steps/:stepId/test-runs`.
   */
  recordStepTestRun(
    workflowId: string,
    stepId: string,
    body: {
      stepTestId?: string | null;
      status: string;
      input?: unknown;
      output?: unknown;
      error?: unknown;
    },
  ): Promise<void>;

  /**
   * List the saved test fixtures for a workflow step (project-owned, not
   * subject-filtered). Added now so the ui-only incoming-state picker and
   * test-gate tasks need no further studio change. Mirrors `listSavedTests`,
   * re-keyed to a `(workflowId, stepId)`. GETs
   * `/workflows/:workflowId/steps/:stepId/tests`.
   */
  listStepTests(workflowId: string, stepId: string): Promise<StepTest[]>;

  /**
   * List the caller's registered Functions (core rfcs/function.md) — drives
   * the step builder's Functions tab (F-2.0). GETs `/functions`.
   */
  listFunctions(): Promise<FunctionSummary[]>;

  /**
   * Load one Function's canonical interface (`inputs`), so the Functions tab
   * can render its Configure stage's `ParamsForm`. GETs `/functions/:id`.
   */
  getFunction(id: string): Promise<FunctionDetail>;

  /**
   * Invoke a Function directly — the Functions tab's Test stage
   * (`CallableStepConfig`), NOT the `@w6w/call` node's own run-time path (that
   * goes through `ctx.invokeCallable`, host-side). Returns the raw output —
   * `unknown`, not an invocation envelope — matching the committed
   * `studio/src/repos/functions.ts`. POSTs `/functions/:id/invoke`.
   */
  invokeFunction(id: string, inputs: Record<string, unknown>): Promise<unknown>;

  /**
   * List the caller's registered Workflows — drives the step builder's
   * Workflows tab (F-2.0). GETs `/workflows`.
   */
  listWorkflows(): Promise<WorkflowSummary[]>;

  /**
   * Load one Workflow's full definition, so the Workflows tab can derive its
   * entry/trigger step's declared `with.fields` for the Configure stage's
   * `ParamsForm`. GETs `/workflows/:id`.
   */
  getWorkflow(id: string): Promise<WorkflowDetail>;

  /**
   * Run a Workflow synchronously — the Workflows tab's Test stage (D-11/
   * D-15(c)): the SAME `?wait=true` path the saved `@w6w/call` step takes at
   * run time, never a client-side enqueue-and-poll. `terminal` is derived from
   * the response's HTTP status (`200` ⇒ `true`, the server's own `202`
   * synchronous-wait timeout ⇒ `false` — a legitimate "still running" outcome,
   * not an error). POSTs `/workflows/:id/run?wait=true`.
   */
  runWorkflow(
    id: string,
    opts?: { variables?: Record<string, unknown>; input?: Record<string, unknown> },
  ): Promise<{
    runId: string;
    status: string;
    output?: unknown;
    error?: unknown;
    terminal: boolean;
  }>;

  /**
   * List apps that declare at least one trigger — the Triggers tab's
   * "App triggers" section (T-0). GETs whatever the host resolves to (e.g.
   * apps filtered by `triggerCount > 0`).
   *
   * OPTIONAL, like `listTestRuns?` above: a host that hasn't wired this member
   * still typechecks and simply doesn't render the App-triggers section.
   */
  listTriggerApps?(): Promise<AppSummary[]>;

  /**
   * List one app's declared triggers. GETs `/apps/:id/triggers`.
   */
  getAppTriggers?(appId: string): Promise<TriggerSummary[]>;

  /**
   * List the Subscriptions bound to one workflow (rfcs/trigger.md). Powers
   * the webhook-URL panel's get-or-create check (I-2) — GETs
   * `/workflows/:id/subscriptions`.
   */
  listSubscriptionsForWorkflow?(workflowId: string): Promise<SubscriptionSummary[]>;

  /**
   * Create a Subscription binding an app trigger to a workflow — the one
   * explicit user action both the Triggers-tab app section (T-0) and the
   * webhook-URL panel (I-2) call, per DECISIONS.md HITL-1. POSTs
   * `/apps/:id/triggers/:key/subscriptions`.
   */
  createSubscription?(
    appId: string,
    triggerKey: string,
    input: { workflowId: string; connectionId?: string | null; params?: Record<string, unknown> },
  ): Promise<SubscriptionSummary>;
}

const Ctx = createContext<W6WApi | null>(null);

export interface W6WUIProviderProps {
  api: W6WApi;
  /**
   * Force the theme every `@w6w/ui` component resolves to — both the CSS
   * tokens (`styles.css`'s `:where([data-theme=...])` blocks) and the
   * JS-side theme-aware components (`AppIcon`, `CodeEditor`, `JsonEditor`,
   * `WorkflowFlowEditor`, via `useEffectiveTheme`) — instead of each one
   * independently falling back to `data-theme` on `<html>` or the visitor's
   * OS `prefers-color-scheme`.
   *
   * Omit to keep that pre-existing default — the right choice for `@w6w/ui`'s
   * own app (studio), which already manages `data-theme` on `<html>` itself.
   * But it's a silent trap for a HOST embedding these components inside its
   * own page: without this prop, `@w6w/ui` resolves its theme from the
   * visitor's OS setting, independently of whatever theme the host's own
   * page is using — a visitor with a dark-mode OS preference gets `@w6w/ui`
   * components rendered in ITS dark palette sitting inside an otherwise-light
   * host page (or vice versa). Pass your host's own resolved theme here to
   * make `@w6w/ui` follow it instead. See `docs/theming.md`.
   */
  theme?: ThemeMode;
  children: ReactNode;
}

/**
 * Provides the w6w API client to every component under it, and — when
 * `theme` is given — forces `@w6w/ui`'s theme to match it (see
 * `W6WUIProviderProps.theme` above). Setting `theme` wraps `children` in a
 * `data-theme` DOM node: CSS custom properties cascade to every descendant
 * regardless of specificity, so this alone is enough for every `@w6w/ui`
 * stylesheet rule to resolve correctly — no need to also set the attribute
 * on `<html>` yourself. `display: contents` keeps that wrapper invisible to
 * layout (flex/grid gap, `:nth-child`, etc. all behave as if it weren't
 * there).
 */
export function W6WUIProvider({ api, theme, children }: W6WUIProviderProps) {
  const content = (
    <Ctx.Provider value={api}>
      <ProvidedThemeCtx.Provider value={theme}>{children}</ProvidedThemeCtx.Provider>
    </Ctx.Provider>
  );
  if (!theme) return content;
  return (
    <div data-theme={theme} style={{ display: "contents" }}>
      {content}
    </div>
  );
}

/**
 * Access the w6w API client. Throws a helpful error if used outside a
 * `<W6WUIProvider>` — the common mistake is forgetting to wrap the app root.
 */
export function useW6WApi(): W6WApi {
  const api = useContext(Ctx);
  if (!api) {
    throw new Error(
      "useW6WApi must be used inside <W6WUIProvider>. " +
        "Wrap your app root with <W6WUIProvider api={api}>...</W6WUIProvider>.",
    );
  }
  return api;
}

/**
 * The workflow's currently-selected project id, provided by the editor so an
 * ad-hoc test-invoke resolves document expressions against that project (not the
 * scope's default/starter project). `undefined` — no project provided — keeps the
 * server's default-project behavior. Deliberately not throwing when absent: test
 * panels render outside the editor too (e.g. connection screens).
 */
const WorkflowProjectCtx = createContext<string | undefined>(undefined);

/** Scopes test-invokes under it to `project`; the editor wraps its body with this. */
export function WorkflowProjectProvider({
  project,
  children,
}: {
  project?: string;
  children: ReactNode;
}) {
  return <WorkflowProjectCtx.Provider value={project}>{children}</WorkflowProjectCtx.Provider>;
}

/** The selected workflow project id in scope, or `undefined` outside the editor. */
export function useWorkflowProject(): string | undefined {
  return useContext(WorkflowProjectCtx);
}
