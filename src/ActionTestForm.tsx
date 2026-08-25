import { useEffect, useMemo, useState } from "react";
import { JsonEditor } from "./JsonEditor.tsx";
import { ParamsForm } from "./ParamsForm.tsx";
import { ApiCallsPanel } from "./components/ApiCallsPanel.tsx";
import { ConfirmModal } from "./components/ConfirmModal.tsx";
import { ListItem } from "./components/ListItem.tsx";
import { Modal } from "./components/Modal.tsx";
import { useW6WApi } from "./provider.tsx";
import type { TestRunSummary } from "./provider.tsx";
import type { ActionDef, ApiCallRecord, SavedTest, ThemeMode } from "./types.ts";

export interface ActionTestFormProps {
  /** App the action belongs to. */
  appId: string;
  /** The app's actions — the caller already has them from the app detail. */
  actions: ActionDef[];
  /** Fixed connection to run against; its credential is resolved server-side. */
  connectionId?: string;
  /**
   * Pre-selected action (controlled). When provided the built-in action
   * `<select>` is hidden — the caller is already driving the selection.
   */
  action?: ActionDef | null;
  /** Theme hint, accepted for parity with other ui-lib components. */
  theme?: ThemeMode;
  /**
   * Studio-integration seam: when provided (and its reference changes) the
   * current action's params are seeded from a shallow copy of this object, so a
   * host page can "open" a saved test pre-filled. The stored object is never
   * mutated; a subsequent user edit is free to diverge. Optional — existing
   * consumers keep compiling.
   */
  seedValues?: Record<string, unknown> | null;
  /**
   * Studio-integration seam: fired after a successful saved-test create/delete
   * so the host page can invalidate its own `["saved-tests", connId]` query.
   * The modal rail still refreshes its own list independently. Optional.
   */
  onSavedTestsChanged?: () => void;
  /**
   * Studio-integration seam (URL-driven host): the id of the saved test being
   * edited, from a studio deep link (`…/test/:testId`). When it changes to a
   * non-null id it is adopted as the current `editingTestId` — so the bottom Save
   * PATCHes that row and the Delete button shows; when null the tester is a
   * fresh/unsaved test. Optional — existing consumers keep compiling.
   */
  seedTestId?: string | null;
  /**
   * Studio-integration seam: fired whenever the current `values` diverge from
   * (or return to) the seeded baseline. This is the unsaved-changes signal the
   * studio host gates modal-close on (its ConfirmModal prompt). Optional.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Studio-integration seam: fired after a successful save (POST create or PATCH
   * update) with the resulting `SavedTest`, so the host can sync the URL
   * (`…/test/:id`) and clear its own dirty state. Optional.
   */
  onTestSaved?: (test: SavedTest) => void;
  /**
   * Studio-integration seam: fired after a successful delete of the saved test
   * currently being edited, with the deleted id, so the host can navigate away
   * from a now-dead `…/test/:id` URL. Optional — existing consumers keep compiling.
   */
  onDeleted?: (testId: string) => void;
  /**
   * Host-embedded mode. When `true` the caller already renders this widget inside
   * its own modal (studio's `ConnectionTesterModal`), so the widget suppresses its
   * OWN `<Modal>` + pop-out (⤢) toggle and instead fills the host container as a
   * full-height flex column: the params + saved-tests region scrolls and the
   * action bar is pinned to the bottom. Default `false` — non-embedded (inline /
   * own pop-out) usages are unchanged.
   */
  embedded?: boolean;
}

/**
 * Minimal relative-time label ("just now", "5m ago", "3h ago", "2d ago", or a
 * date for anything older) from an ISO timestamp. Kept inline — no formatter is
 * imported here — and only used for the saved-tests rail subtitle.
 */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Pull default values out of declared params so the form starts populated. */
function defaultParamsFor(action: ActionDef | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of action?.params ?? []) {
    if (p.key && p.default !== undefined) out[p.key] = p.default;
  }
  return out;
}

/** A rendered action error: a plain-language headline, an optional fix hint, and the raw provider detail. */
interface InvokeError {
  headline: string;
  hint?: string;
  detail?: string;
}

/**
 * Pull the provider's own human-readable message out of a raw error string. App
 * actions often throw like `SendGrid list index returned 403: {"errors":[{"message":"…"}]}`
 * — parse the trailing JSON and surface just the human message, keeping the
 * `"<App> … returned <status>"` prefix.
 */
function extractProviderMessage(msg: string): string {
  const brace = msg.indexOf("{");
  if (brace >= 0) {
    try {
      const j = JSON.parse(msg.slice(brace)) as {
        errors?: { message?: string }[];
        error?: { message?: string } | string;
        message?: string;
      };
      const m =
        j?.errors?.[0]?.message ??
        (typeof j?.error === "object" ? j.error?.message : j?.error) ??
        j?.message;
      if (typeof m === "string" && m.trim()) {
        const prefix = msg.slice(0, brace).replace(/[:\s]+$/, "");
        return prefix ? `${prefix}: ${m.trim()}` : m.trim();
      }
    } catch {
      // Not JSON — fall through and return the message as-is.
    }
  }
  return msg;
}

/**
 * A failed-invoke error shape, matched by field rather than class identity —
 * ui's own `ApiError` and `@w6w/sdk`'s are two different classes across the
 * package boundary, and `status`+`code` is what both actually carry.
 * Considered mirroring `packages/wrappers/cli/src/exit.ts:60-63`'s `name ===
 * "ApiError"` fallback; not adopted — that solves module DUPLICATION of one
 * class, while ui's problem is cross-package IDENTITY, which `status`+`code`
 * already settles.
 */
function isInvokeApiError(
  e: unknown,
): e is { status: number; code: string; message?: string; body?: unknown; raw?: unknown } {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { status: unknown }).status === "number" &&
    typeof (e as { code: unknown }).code === "string"
  );
}

/**
 * Turn a thrown invoke error into a user-facing message. A permission/credential
 * failure at the underlying provider (HTTP 401/403, or the message mentions
 * scopes/forbidden/unauthorized) is stated plainly with what to fix, so the user
 * isn't left staring at a raw upstream JSON blob.
 */
function describeInvokeError(e: unknown): InvokeError {
  if (!isInvokeApiError(e)) {
    return { headline: (e as Error)?.message ?? "The action failed to run." };
  }
  const detail = extractProviderMessage(e.message ?? "");
  const haystack = `${e.status} ${e.code} ${e.message ?? ""}`.toLowerCase();
  const isPermission =
    e.status === 401 ||
    e.status === 403 ||
    /\b(401|403)\b|forbidden|unauthorized|not authorized|permission|scope|access denied|invalid api key|invalid credential/.test(
      haystack,
    );
  if (isPermission) {
    return {
      headline:
        "Permission denied by the provider — this is a credential/scope problem, not a w6w error.",
      hint:
        "The connection's API key is missing the permissions this action needs. Fix it at the " +
        "provider — e.g. SendGrid → Settings → API Keys → give the key the required scopes (or Full " +
        "Access), or create a new key — then update this connection's credential and try again.",
      detail,
    };
  }
  return { headline: "The action returned an error.", detail };
}

/**
 * The captured outbound calls the server attached to a failed invoke — ui's
 * own `ApiError` carries them on `body`, `@w6w/sdk`'s on `raw`; read `body ??
 * raw` so either shape's calls surface.
 */
function apiCallsOf(e: unknown): ApiCallRecord[] {
  const source = isInvokeApiError(e)
    ? ((e.body ?? e.raw) as { apiCalls?: ApiCallRecord[] } | null)
    : null;
  return source?.apiCalls ?? [];
}

/**
 * Schema-driven form to test/run a single action against a connection. Renders
 * the action's declared params through {@link ParamsForm} (the same primitive
 * the step builder uses) instead of a raw JSON textarea, invokes the action via
 * `useW6WApi().invokeAction`, and shows the returned value or error.
 *
 * The selected action is either controlled by the caller (`action` prop) or
 * chosen from a built-in `<select>` over `actions`. Param values reset whenever
 * the selected action changes.
 */
export function ActionTestForm({
  appId,
  actions,
  connectionId,
  action,
  seedValues,
  onSavedTestsChanged,
  seedTestId,
  onDirtyChange,
  onTestSaved,
  onDeleted,
  embedded = false,
}: ActionTestFormProps) {
  const api = useW6WApi();

  // Actions sorted for the built-in picker (only used when uncontrolled).
  const sortedActions = useMemo(() => {
    const list = [...actions];
    list.sort((a, b) => (a.title || a.key).localeCompare(b.title || b.key));
    return list;
  }, [actions]);

  // Internal selection, used only when the caller doesn't control `action`.
  const [pickedKey, setPickedKey] = useState<string>(action?.key ?? "");
  const selectedAction: ActionDef | null =
    action ?? actions.find((a) => a.key === pickedKey) ?? null;

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<InvokeError | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  // The outbound HTTP calls the last run made (redacted request + response).
  // Populated on success AND failure — a wrong payload is usually only visible
  // on the wire, not in the value.
  const [apiCalls, setApiCalls] = useState<ApiCallRecord[]>([]);

  // Params view: the schema-driven form, or the whole `values` object as raw JSON.
  const [viewMode, setViewMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonInvalid, setJsonInvalid] = useState(false);

  // Pop-out: when open, the params region moves into a larger `Modal` canvas.
  // It is the SAME region bound to the SAME `values`/`setValues`, just relocated,
  // so edits stay in sync with the inline view.
  const [modalOpen, setModalOpen] = useState(false);

  // Param values, re-seeded from defaults whenever the selected action changes.
  // On a FRESH MOUNT with `seedValues` present (e.g. a deep-linked saved test),
  // seed from a shallow copy of it rather than defaults — otherwise the seed guard
  // below never fires on first render (`lastSeed` inits to the same ref) and the
  // seeded values are dropped.
  const selectedKey = selectedAction?.key ?? null;
  const initialValues = seedValues ? { ...seedValues } : defaultParamsFor(selectedAction);
  const [valuesByAction, setValuesByAction] = useState<{
    key: string | null;
    values: Record<string, unknown>;
  }>(() => ({
    key: selectedKey,
    values: initialValues,
  }));

  // The id of the saved test currently being edited, or `null` for an unsaved
  // test. Drives the PATCH-vs-POST decision in `submitSaveTest`: a set id updates
  // that row in place, `null` creates a new named row. Seeded from `seedTestId`
  // so a studio deep link (`…/test/:testId`) mounts already in edit mode.
  const [editingTestId, setEditingTestId] = useState<string | null>(seedTestId ?? null);

  // Dirty baseline: the values as last seeded/loaded/saved. `values` is compared
  // against this to derive the host-facing `dirty` signal (`onDirtyChange`). Reset
  // wherever a fresh set of values is adopted (action change, seed, load, save).
  const [baseline, setBaseline] = useState<Record<string, unknown>>(initialValues);

  if (valuesByAction.key !== selectedKey) {
    // Selection changed (controlled or via the picker, without a remount) — reset the
    // form values AND clear any stale result/error carried over from the previously
    // selected action (a 403 from `list-get` must not linger while `mail-send` shows).
    // Editing id: a genuine action-switch starts a fresh unsaved test (→ null), BUT a
    // deep-link whose action arrives AFTER mount is NOT an action-switch — the selected
    // action IS the seeded test's action. A truthy `seedTestId` therefore wins here, so
    // the late null→key transition keeps `editingTestId === seedTestId` (Save PATCHes,
    // Delete shows) instead of clobbering it to null and POSTing a duplicate row.
    const fresh = defaultParamsFor(selectedAction);
    setValuesByAction({ key: selectedKey, values: fresh });
    setBaseline(fresh);
    setEditingTestId(seedTestId ?? null);
    setError(null);
    setResult(undefined);
    setApiCalls([]);
  }

  // Studio seam: adopt a deep-linked saved-test id. When `seedTestId` changes to a
  // non-null id, make it the current editing id (bottom Save PATCHes, Delete
  // shows); a change to null returns the tester to a fresh/unsaved test.
  const [lastSeedTestId, setLastSeedTestId] = useState<string | null | undefined>(seedTestId);
  if (seedTestId !== lastSeedTestId) {
    setLastSeedTestId(seedTestId);
    setEditingTestId(seedTestId ?? null);
  }

  // Studio seam: when a new `seedValues` reference arrives (e.g. "open a saved
  // test"), seed the current action's params from a SHALLOW COPY of it. Applied
  // as a render-phase guard like the action-change reseed above; the passed
  // object is never mutated and later edits are free to diverge.
  const [lastSeed, setLastSeed] = useState<Record<string, unknown> | null | undefined>(seedValues);
  if (seedValues !== lastSeed) {
    // Content-aware, not reference-keyed: a `["saved-tests"]` invalidation (fired by
    // onTestSaved/onSavedTestsChanged after a Save) hands back a fresh OBJECT with the
    // SAME content — that must NOT reseed the draft or clear the on-screen Run
    // result/error. Reseed only when the incoming values differ STRUCTURALLY from the
    // last applied seed. `lastSeed` advances to the new ref regardless, so we don't
    // re-compare the same pair every render.
    const structurallyChanged =
      JSON.stringify(seedValues ?? null) !== JSON.stringify(lastSeed ?? null);
    setLastSeed(seedValues);
    if (seedValues && structurallyChanged) {
      const seeded = { ...seedValues };
      setValuesByAction({ key: selectedKey, values: seeded });
      setBaseline(seeded);
      setError(null);
      setResult(undefined);
      setApiCalls([]);
    }
  }

  const values = valuesByAction.values;
  const setValues = (next: Record<string, unknown>) =>
    setValuesByAction({ key: selectedKey, values: next });

  // Host-facing dirty signal: do the current values diverge from the seeded
  // baseline? Compared by structural JSON so a load→edit→revert cycle clears it.
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(baseline),
    [values, baseline],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire only when `dirty` flips, not on every `onDirtyChange` identity change.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  // Entering the JSON view seeds the editor from the current values; edits that
  // parse to a plain object round-trip straight back into `values`.
  const enterJsonView = () => {
    setJsonText(JSON.stringify(values, null, 2));
    setJsonInvalid(false);
    setViewMode("json");
  };

  // The single invoke path — used by "Run action" and by re-running a saved test.
  const runWith = async (params: Record<string, unknown>) => {
    if (!selectedAction) return;
    const actionKey = selectedAction.key;
    setRunning(true);
    setError(null);
    setResult(undefined);
    setApiCalls([]);
    let outcome: { ok: boolean; summary: string; result?: unknown };
    try {
      const r = await api.invokeAction(appId, actionKey, params, { connectionId });
      setResult(r.value);
      setApiCalls(r.apiCalls ?? []);
      outcome = { ok: true, summary: "OK", result: r.value };
    } catch (e) {
      const err = describeInvokeError(e);
      setError(err);
      // The server returns the captured calls on the error body too — the
      // request that failed is the thing worth looking at.
      setApiCalls(apiCallsOf(e));
      outcome = { ok: false, summary: err.headline };
    } finally {
      setRunning(false);
    }
    // Log every run (success or failure) against the connection, and update the
    // saved test's last-run when this run came from an editing session. Best
    // effort — a logging failure must not mask the run's own result.
    if (connectionId) {
      try {
        await api.recordTestRun(connectionId, {
          savedTestId: editingTestId ?? null,
          actionKey,
          ok: outcome.ok,
          summary: outcome.summary.slice(0, 200),
          result: outcome.result,
        });
        refreshSavedTests();
        refreshRunHistory();
        onSavedTestsChanged?.();
      } catch {
        // Ignore — the run itself already surfaced via result/error.
      }
    }
  };
  const run = () => runWith(values);

  // Saved tests for this connection. `nonce` re-triggers the fetch after a
  // create/delete so the rail reflects the change without a full remount.
  const [savedTests, setSavedTests] = useState<SavedTest[] | null>(null);
  const [savedTestsError, setSavedTestsError] = useState<string | null>(null);
  const [savedTestsNonce, setSavedTestsNonce] = useState(0);
  // Name-a-saved-test dialog (in-app Modal — never the browser's prompt()).
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");
  // Delete-confirm dialog (in-app ConfirmModal — never the browser's confirm()).
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const refreshSavedTests = () => setSavedTestsNonce((n) => n + 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `savedTestsNonce` is a deliberate re-fetch trigger, not read inside the effect.
  useEffect(() => {
    if (!connectionId) {
      setSavedTests(null);
      return;
    }
    let canceled = false;
    setSavedTestsError(null);
    api
      .listSavedTests(connectionId)
      .then((list) => !canceled && setSavedTests(list))
      .catch((e) => !canceled && setSavedTestsError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api, connectionId, savedTestsNonce]);

  // Only this action's saved tests belong on the rail.
  const railTests = selectedKey
    ? (savedTests ?? []).filter((t) => t.actionKey === selectedKey)
    : [];

  // Connection run history from the unified `run_log` ledger (F-1). Complements
  // the per-saved-test `lastRun*` badge with the full recent-run list. Fetched
  // via the OPTIONAL `api.listTestRuns` — a consumer that doesn't implement it
  // (studio, until T2.2.2) simply shows no history. `runHistoryNonce` re-triggers
  // the fetch after a run is recorded so the list stays current.
  const [runHistory, setRunHistory] = useState<TestRunSummary[] | null>(null);
  const [runHistoryNonce, setRunHistoryNonce] = useState(0);
  const refreshRunHistory = () => setRunHistoryNonce((n) => n + 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `runHistoryNonce` is a deliberate re-fetch trigger, not read inside the effect.
  useEffect(() => {
    const load = api.listTestRuns;
    if (!connectionId || !load) {
      setRunHistory(null);
      return;
    }
    let canceled = false;
    load(connectionId)
      .then((list) => !canceled && setRunHistory(list))
      // Best-effort: a history load failure must never break the tester.
      .catch(() => !canceled && setRunHistory(null));
    return () => {
      canceled = true;
    };
  }, [api, connectionId, runHistoryNonce]);

  // History rows for the current action (mirrors the saved-tests rail filter),
  // most-recent first — the server orders newest-first but we don't rely on it.
  const railRunHistory = selectedKey
    ? (runHistory ?? [])
        .filter((r) => r.actionKey === selectedKey)
        .slice()
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    : [];

  // Open the in-app name dialog to save the current params as a NEW named test.
  const openSaveModal = () => {
    if (!connectionId || !selectedAction) return;
    setPendingName("");
    setSavedTestsError(null);
    setNameModalOpen(true);
  };
  // Bottom Save affordance. When a saved test is loaded for editing
  // (`editingTestId` set) the save is a silent PATCH — no throwaway name dialog
  // (FU-1). With no editing id, open the name dialog to create a new named row.
  const handleSaveClick = () => {
    if (!connectionId || !selectedAction) return;
    if (editingTestId) {
      void submitSaveTest();
    } else {
      openSaveModal();
    }
  };
  // Persist the current params. When a saved test is loaded for editing
  // (`editingTestId` set), PATCH that row in place — updating only `values` keeps
  // its name and sidesteps the 409 duplicate-name guard a re-POST would trip.
  // With no editing id, create a new named row from the dialog and remember its
  // id so the next save updates in place rather than spawning a second row.
  const submitSaveTest = async () => {
    if (!connectionId || !selectedAction) return;
    try {
      let saved: SavedTest;
      if (editingTestId) {
        saved = await api.updateSavedTest(connectionId, editingTestId, { values });
      } else {
        const name = pendingName.trim();
        if (!name) return;
        saved = await api.createSavedTest(connectionId, {
          actionKey: selectedAction.key,
          name,
          values,
        });
        setEditingTestId(saved.id);
      }
      // The just-saved values are the new clean baseline (dirty → false).
      setBaseline({ ...values });
      setNameModalOpen(false);
      setPendingName("");
      refreshSavedTests();
      onSavedTestsChanged?.();
      onTestSaved?.(saved);
    } catch (e) {
      setSavedTestsError((e as Error).message);
    }
  };

  // Load a saved test's values into the form (shallow copy — never mutate the
  // stored row). Clicking a saved test's name loads it for editing: values +
  // editing id are adopted and the load becomes the new clean baseline.
  const loadSavedTest = (t: SavedTest) => {
    const loaded = { ...t.values };
    setValuesByAction({ key: selectedKey, values: loaded });
    setBaseline(loaded);
    // Remember which row is being edited so a subsequent save PATCHes it in place.
    setEditingTestId(t.id);
    setViewMode("form");
    setError(null);
    setResult(undefined);
    setApiCalls([]);
  };
  // Delete the saved test currently being edited (Delete only shows with an
  // editing id set). Clears the editing id so the form drops to unsaved state.
  const deleteCurrentTest = async () => {
    if (!connectionId || !editingTestId) return;
    const deletedId = editingTestId;
    try {
      await api.deleteSavedTest(connectionId, deletedId);
      setEditingTestId(null);
      refreshSavedTests();
      onSavedTestsChanged?.();
      // Host hook: let the URL-driven host (studio's ConnectionTesterModal) navigate
      // away from the now-dead `…/test/:deletedId` deep link.
      onDeleted?.(deletedId);
    } catch (e) {
      setSavedTestsError((e as Error).message);
    }
  };

  // The params region: the form↔JSON toggle plus the ParamsForm/JsonEditor block.
  // Rendered in exactly one place at a time — inline when the pop-out is closed,
  // inside the `Modal` when it's open — so there's a single instance bound to the
  // single `values`/`setValues` state (no copy-on-open, edits stay in sync).
  const paramsRegion = (
    <div className="w6w-stack" style={{ gap: "var(--w6w-sp-1-5)" }}>
      <div
        className="w6w-field-labelrow"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span className="w6w-muted w6w-small">Parameters</span>
        <div style={{ display: "flex", gap: "var(--w6w-sp-1)" }}>
          <button
            type="button"
            className={`w6w-btn w6w-btn-sm w6w-btn-ghost${viewMode === "form" ? " active" : ""}`}
            aria-pressed={viewMode === "form"}
            onClick={() => setViewMode("form")}
          >
            Form
          </button>
          <button
            type="button"
            className={`w6w-btn w6w-btn-sm w6w-btn-ghost${viewMode === "json" ? " active" : ""}`}
            aria-pressed={viewMode === "json"}
            onClick={enterJsonView}
          >
            JSON
          </button>
          {/* Pop-out toggle — suppressed in embedded mode: the host already
              provides full-screen modal chrome, so a modal-in-modal ⤢ is redundant. */}
          {!embedded && (
            <button
              type="button"
              className="w6w-btn w6w-btn-sm w6w-btn-ghost"
              aria-pressed={modalOpen}
              title={
                modalOpen ? "Collapse the params editor" : "Open the params editor in a larger view"
              }
              aria-label={
                modalOpen ? "Collapse the params editor" : "Open the params editor in a larger view"
              }
              onClick={() => setModalOpen((v) => !v)}
            >
              {modalOpen ? "⤡" : "⤢"}
            </button>
          )}
        </div>
      </div>

      {viewMode === "form" ? (
        <ParamsForm params={selectedAction?.params ?? []} values={values} onChange={setValues} />
      ) : (
        <>
          <JsonEditor
            value={jsonText}
            onChange={setJsonText}
            minHeight={modalOpen ? "50vh" : "200px"}
            aria-label="Params JSON"
            onValidChange={(parsed) => {
              // Only a JSON object maps onto the params `values` record; ignore a
              // bare array/scalar so `values` stays a plain key→value object.
              if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                setValues(parsed as Record<string, unknown>);
              }
            }}
            onValidityChange={({ valid }) => setJsonInvalid(!valid)}
          />
          {jsonInvalid && (
            <span className="w6w-hint" style={{ color: "var(--w6w-danger)" }}>
              Invalid JSON
            </span>
          )}
        </>
      )}
    </div>
  );

  // The saved-tests rail — the right pane of the pop-out. Only meaningful when a
  // connection is fixed; hidden entirely otherwise (guarded on `connectionId`).
  const savedTestsRail = connectionId ? (
    <div className="w6w-stack" style={{ gap: "var(--w6w-sp-1-5)" }}>
      <div
        className="w6w-field-labelrow"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span className="w6w-muted w6w-small">Saved tests</span>
      </div>
      {savedTestsError && (
        <span className="w6w-hint" style={{ color: "var(--w6w-danger)" }}>
          {savedTestsError}
        </span>
      )}
      {railTests.length === 0 ? (
        <p className="w6w-muted w6w-small">No saved tests for this action yet.</p>
      ) : (
        <ul
          className="w6w-stack"
          style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--w6w-sp-1-5)" }}
        >
          {railTests.map((t) => (
            <li key={t.id}>
              {/* Clicking a saved test loads it for editing — no per-row
                  Load/Run/Delete buttons; those actions live at the modal bottom.
                  Subtitle shows the last run (✓/✗ + relative time), falling back
                  to the last-saved time when the test has never been run. */}
              <ListItem
                title={t.name}
                subtitle={
                  t.lastRunAt ? (
                    <span>
                      <span
                        style={{ color: t.lastRunOk ? "var(--w6w-success)" : "var(--w6w-danger)" }}
                      >
                        {t.lastRunOk ? "✓" : "✗"}
                      </span>{" "}
                      {t.lastRunSummary ? `${t.lastRunSummary} · ` : ""}
                      {relativeTime(t.lastRunAt)}
                    </span>
                  ) : (
                    `saved ${relativeTime(t.updatedAt)}`
                  )
                }
                active={t.id === editingTestId}
                onClick={() => loadSavedTest(t)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Run history (F-1): the connection's recent tester runs for this action,
          from the unified `run_log` ledger. Read-only rows (no onClick) — this is
          a log, not a loadable input like the saved tests above. Only rendered
          when the api exposes `listTestRuns` (optional member) and there is
          history to show, so a consumer without it degrades to no section. */}
      {api.listTestRuns && railRunHistory.length > 0 && (
        <>
          <div
            className="w6w-field-labelrow"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span className="w6w-muted w6w-small">Recent runs</span>
          </div>
          <ul
            className="w6w-stack"
            style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--w6w-sp-1-5)" }}
          >
            {railRunHistory.map((r) => (
              <li key={r.id}>
                <ListItem
                  title={
                    <span>
                      <span style={{ color: r.ok ? "var(--w6w-success)" : "var(--w6w-danger)" }}>
                        {r.ok ? "✓" : "✗"}
                      </span>{" "}
                      {r.actionKey}
                    </span>
                  }
                  subtitle={
                    <span>
                      {r.summary ? `${r.summary} · ` : ""}
                      {relativeTime(r.occurredAt)}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  ) : null;

  // Nullable: `editingTestId` can be seeded from a studio deep link before
  // `savedTests` itself has finished fetching, so this may not resolve yet.
  const deletingTestName = savedTests?.find((t) => t.id === editingTestId)?.name;

  return (
    <div className={`w6w-stack${embedded ? " w6w-tester-embedded-root" : ""}`}>
      {/* Action picker — only when the caller isn't controlling the selection. */}
      {!action &&
        (actions.length === 0 ? (
          <p className="w6w-muted w6w-small">This app exposes no actions.</p>
        ) : (
          <label className="w6w-field">
            <span>Action{selectedKey ? "" : " *"}</span>
            <select value={pickedKey} onChange={(e) => setPickedKey(e.target.value)}>
              <option value="">— pick an action —</option>
              {sortedActions.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.title ?? a.key} ({a.key})
                </option>
              ))}
            </select>
          </label>
        ))}

      {selectedAction ? (
        <>
          <div>
            <strong>
              {selectedAction.title ?? selectedAction.key}{" "}
              <code className="w6w-muted">{selectedAction.key}</code>
            </strong>
            {selectedAction.description && (
              <p className="w6w-muted w6w-small" style={{ margin: "var(--w6w-sp-0-5) 0 0" }}>
                {selectedAction.description}
              </p>
            )}
          </div>

          {(() => {
            // The scrollable tester content: params editor + error + result. Shared
            // by every layout (inline body, pop-out modal, embedded footer layout)
            // so it stays a single instance bound to the single `values` state.
            const paramsAndResult = (
              <div className="w6w-stack" style={{ gap: "var(--w6w-sp-3)" }}>
                {paramsRegion}
                {error && (
                  <div className="w6w-result w6w-error">
                    <strong>{error.headline}</strong>
                    {error.hint && (
                      <div style={{ marginTop: "var(--w6w-sp-1-5)" }}>{error.hint}</div>
                    )}
                    {error.detail && (
                      <div
                        className="w6w-muted w6w-small"
                        style={{
                          marginTop: "var(--w6w-sp-1-5)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {error.detail}
                      </div>
                    )}
                  </div>
                )}
                {result !== undefined && (
                  <div className="w6w-stack" style={{ gap: "var(--w6w-sp-1)" }}>
                    <strong className="w6w-small">Result</strong>
                    <pre className="w6w-result">{JSON.stringify(result, null, 2)}</pre>
                  </div>
                )}
                <ApiCallsPanel calls={apiCalls} />
              </div>
            );
            // Bottom-anchored actions: Run / Save always; Delete only when an
            // editing id is set (an already-saved test is loaded). In embedded mode
            // this becomes a bottom-pinned, bordered footer outside the scroll region.
            const actionBar = (
              <div
                className={`w6w-tester-actions${
                  embedded || modalOpen ? " w6w-tester-actions-footer" : ""
                }`}
                style={{ display: "flex", gap: "var(--w6w-sp-2)" }}
              >
                <button type="button" className="w6w-btn" disabled={running} onClick={run}>
                  {running ? "Running…" : "Run action"}
                </button>
                {connectionId && (
                  <button type="button" className="w6w-btn w6w-btn-ghost" onClick={handleSaveClick}>
                    Save test
                  </button>
                )}
                {connectionId && editingTestId && (
                  <button
                    type="button"
                    className="w6w-btn w6w-btn-ghost"
                    style={{ marginLeft: "auto", color: "var(--w6w-danger)" }}
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Delete
                  </button>
                )}
              </div>
            );
            // The tester body: params + result + actions, stacked. Rendered inline
            // when the pop-out modal is closed, and inside the pop-out modal (left
            // pane, saved-tests rail on the right) when open.
            const body = (
              <div className="w6w-stack" style={{ gap: "var(--w6w-sp-3)" }}>
                {paramsAndResult}
                {actionBar}
              </div>
            );
            // Host-embedded: the host owns the modal chrome, so fill it as a
            // full-height flex column — params + saved-tests rail scroll, the action
            // bar is pinned to the bottom as a non-scrolling footer.
            if (embedded) {
              return (
                <div className="w6w-tester-embedded">
                  <div className="w6w-tester-embedded-scroll">
                    {savedTestsRail ? (
                      <div className="w6w-tester-embedded-cols">
                        <div className="w6w-tester-embedded-main">{paramsAndResult}</div>
                        <div className="w6w-tester-embedded-rail">{savedTestsRail}</div>
                      </div>
                    ) : (
                      paramsAndResult
                    )}
                  </div>
                  {actionBar}
                </div>
              );
            }
            return modalOpen ? (
              <Modal
                title={`Edit params — ${selectedAction.title ?? selectedAction.key}`}
                onClose={() => setModalOpen(false)}
                size="full"
              >
                {/* The pop-out's own internal scroll boundary (T1.4.1 round 2): with
                    `-full`'s `overflow: hidden` live, the dialog itself no longer
                    scrolls, so params + result (+ the saved-tests rail) get a
                    dedicated scroll region here and the action bar stays a pinned
                    footer below it — mirrors `.w6w-tester-embedded-scroll`'s
                    mechanism (see styles.css), just for this own-pop-out layout
                    instead of the host-embedded one. */}
                <div className="w6w-tester-popout">
                  <div className="w6w-tester-popout-scroll">
                    {savedTestsRail ? (
                      <div
                        style={{
                          display: "flex",
                          gap: "var(--w6w-sp-4)",
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>{paramsAndResult}</div>
                        <div style={{ width: 260, flexShrink: 0 }}>{savedTestsRail}</div>
                      </div>
                    ) : (
                      paramsAndResult
                    )}
                  </div>
                  {actionBar}
                </div>
              </Modal>
            ) : (
              body
            );
          })()}

          {nameModalOpen && (
            <Modal title="Save test" onClose={() => setNameModalOpen(false)}>
              <form
                className="w6w-stack"
                style={{ gap: "var(--w6w-sp-3)" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSaveTest();
                }}
              >
                <label className="w6w-field">
                  <span>Name this saved test</span>
                  <input
                    type="text"
                    value={pendingName}
                    placeholder="e.g. valid sender"
                    onChange={(e) => setPendingName(e.target.value)}
                  />
                </label>
                {savedTestsError && (
                  <span className="w6w-hint" style={{ color: "var(--w6w-danger)" }}>
                    {savedTestsError}
                  </span>
                )}
                <div
                  style={{ display: "flex", gap: "var(--w6w-sp-2)", justifyContent: "flex-end" }}
                >
                  <button
                    type="button"
                    className="w6w-btn w6w-btn-ghost"
                    onClick={() => setNameModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="w6w-btn" disabled={!pendingName.trim()}>
                    Save
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {confirmDeleteOpen && (
            <ConfirmModal
              title="Delete saved test"
              message={
                deletingTestName
                  ? `Delete "${deletingTestName}"? This cannot be undone.`
                  : "Delete this saved test? This cannot be undone."
              }
              confirmLabel="Delete"
              onConfirm={() => {
                setConfirmDeleteOpen(false);
                void deleteCurrentTest();
              }}
              onClose={() => setConfirmDeleteOpen(false)}
            />
          )}
        </>
      ) : (
        !action && <p className="w6w-muted w6w-small">Pick an action above to test it.</p>
      )}
    </div>
  );
}
