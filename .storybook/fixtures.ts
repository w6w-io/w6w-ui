/**
 * The ONE shared fake `W6WApi` fixture every Storybook story that calls
 * `useW6WApi()` imports — instead of a ninth hand-rolled `fakeApi()` next to
 * the 8 that already live in `src/__tests__/*.test.ts`.
 *
 * Modelled on `src/__tests__/StepBuilderModal.commit.test.ts`'s `fakeApi()`
 * (the most complete of the 8 — 15 stubbed methods with realistic return
 * shapes), extended here with the sample apps/actions/auth/connections/
 * functions/workflows the story mount paths need, and with `listFunctions`/
 * `listWorkflows` — `StepBuilderModal`'s `useReadyToUse` calls both
 * UNCONDITIONALLY on every mount (not just on its Functions/Workflows tabs),
 * so every `StepBuilderModal` story needs them to resolve.
 *
 * `listAppsPage` is deliberately OMITTED so `AppPicker` always takes its
 * legacy `listApps` eager-fetch path (`typeof api.listAppsPage === "function"`
 * reads false).
 *
 * Lives in `.storybook/` rather than `src/`: that directory is in
 * `tsconfig.json`'s `include` and `biome.json`'s `files.include`, and outside
 * `package.json`'s `files` allowlist (`["src", …]`), so it never ships in the
 * published package and needs no `package.json` edit.
 */
import type { W6WApi } from "../src/provider.tsx";
import type {
  ActionDef,
  AppSummary,
  AuthDef,
  ConnectionSummary,
  FunctionDetail,
  FunctionSummary,
  SavedTest,
  WorkflowDetail,
  WorkflowSummary,
} from "../src/types.ts";

/** Two sample apps — enough for a picker grid to read as real. */
export const SAMPLE_APPS: AppSummary[] = [
  {
    id: "sendgrid",
    displayName: "SendGrid",
    version: "1.4.0",
    description: "Transactional and marketing email.",
    categories: ["email", "marketing"],
  },
  {
    id: "slack",
    displayName: "Slack",
    version: "2.0.1",
    description: "Team messaging.",
    categories: ["communication"],
  },
];

export const SAMPLE_AUTHS: AuthDef[] = [
  {
    key: "apiKey",
    type: "apiKey",
    displayName: "API key",
    fields: [{ key: "apiKey", label: "API key", type: "secret", required: true }],
  },
];

export const SAMPLE_ACTIONS: ActionDef[] = [
  {
    key: "send-email",
    title: "Send email",
    description: "Send a transactional email.",
    params: [
      { key: "to", type: "string", required: true, label: "To" },
      { key: "subject", type: "string", required: true, label: "Subject" },
    ],
  },
];

export const SAMPLE_CONNECTIONS: ConnectionSummary[] = [
  {
    id: "c1",
    appId: "sendgrid",
    authKey: "apiKey",
    displayName: "Production SendGrid",
    state: "connected",
  },
];

export const SAMPLE_FUNCTIONS: FunctionSummary[] = [
  { id: "fn_1", key: "send-welcome-email", displayName: "Send welcome email", valid: true },
];

export const SAMPLE_WORKFLOWS: WorkflowSummary[] = [
  { id: "wf_1", name: "onboarding", displayName: "Onboarding", status: "active" },
];

const SAMPLE_SAVED_TEST: SavedTest = {
  id: "st_1",
  connectionId: "c1",
  appId: "sendgrid",
  actionKey: "send-email",
  name: "Sample test",
  values: { to: "ada@example.com", subject: "Welcome" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_FUNCTION_DETAIL: FunctionDetail = {
  id: "fn_1",
  key: "send-welcome-email",
  displayName: "Send welcome email",
  inputs: [{ key: "to", type: "string", required: true, label: "To" }],
  valid: true,
};

const SAMPLE_WORKFLOW_DETAIL: WorkflowDetail = {
  id: "wf_1",
  name: "onboarding",
  displayName: "Onboarding",
  steps: [],
};

/** A promise that never resolves — the in-flight fetch a Loading story needs. */
export function neverResolves<T = never>(): Promise<T> {
  return new Promise<T>(() => {});
}

/**
 * The shared fake `W6WApi`. `overrides` replaces individual methods per
 * story (a rejecting `getAppAuth` for `AuthLoadError`, a never-resolving
 * `listApps` for `Loading`, …) exactly like the source it's modelled on.
 */
export function fakeApi(overrides: Partial<W6WApi> = {}): W6WApi {
  return {
    listApps: async () => SAMPLE_APPS,
    getAppAuth: async () => SAMPLE_AUTHS,
    listConnectionsForApp: async () => SAMPLE_CONNECTIONS,
    listConnections: async () => SAMPLE_CONNECTIONS,
    getAppActions: async () => SAMPLE_ACTIONS,
    invokeAction: async () => ({ value: { ok: true } }),
    listSavedTests: async () => [SAMPLE_SAVED_TEST],
    createSavedTest: async () => SAMPLE_SAVED_TEST,
    updateSavedTest: async () => SAMPLE_SAVED_TEST,
    deleteSavedTest: async () => {},
    recordTestRun: async () => {},
    saveStepTest: async () => ({
      id: "t1",
      workflowId: "wf_1",
      stepId: "s1",
      name: null,
      input: {},
      with: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    recordStepTestRun: async () => {},
    createConnection: async () => ({
      id: "c1",
      appId: "sendgrid",
      authKey: "apiKey",
      state: "connected" as const,
    }),
    startAppOAuthFlow: async () => ({ authorizationUrl: "" }),
    listStepTests: async () => [],
    listFunctions: async () => SAMPLE_FUNCTIONS,
    getFunction: async () => SAMPLE_FUNCTION_DETAIL,
    invokeFunction: async () => ({ ok: true }),
    listWorkflows: async () => SAMPLE_WORKFLOWS,
    getWorkflow: async () => SAMPLE_WORKFLOW_DETAIL,
    runWorkflow: async () => ({ runId: "r1", status: "succeeded", terminal: true }),
    ...overrides,
  } as unknown as W6WApi;
}
