import { useEffect, useMemo, useState } from "react";
import { PropertyEntryForm } from "./PropertyEntryForm.tsx";
import { type StepTestPersist, requiredParamsFilled } from "./StepBuilderModal.tsx";
import { useW6WApi, useWorkflowProject } from "./provider.tsx";
import { asFieldDefs, fieldsToParams, seedValues } from "./trigger-fields.ts";

type TestState =
  | { status: "running" }
  | { status: "done"; value: unknown; logs?: string[] }
  | { status: "error"; error: string; errorCode?: string; logs?: string[] };

/**
 * The Test-tab widget for a manual/webhook trigger. A trigger's configured
 * `fields` ARE the run's starting state, so testing it means **filling those
 * fields**, not running the raw config (which is why the trigger's output used to
 * come back `{}` — the invoke never carried an `input`).
 *
 * It projects the trigger's `fields` into params (see `./trigger-fields.ts`) and
 * hands them to {@link PropertyEntryForm} — the one property-entry surface, which
 * gives it the per-field widgets, per-field `ƒx`, and the fields ⇄ raw-JSON
 * toggle. This component keeps only the *run*: it enforces each field's
 * `required` via {@link requiredParamsFilled} before enabling Test, and invokes
 * with `{ input: {…filled} }` so the handler (which passes `params.input`
 * through) returns the populated values as the trigger's output state.
 *
 * A trigger with no declared fields (e.g. a webhook, whose payload is arbitrary)
 * gets the raw JSON payload editor — that is the entry form's own empty-params
 * path, not a second code path here — so the operator can still supply a
 * starting state, and the same `{ input }` projection applies.
 *
 * **Remembered values (T4.1.3).** With `persist` supplied, the values are not
 * just used for the invoke: they are saved as the step's latest `step_tests`
 * fixture (`with`) and the run is recorded **against that fixture's id**, and the
 * form seeds itself from the latest fixture next time it opens. The store is
 * project-owned and shared per workflow — any editor of the workflow sees the
 * same saved values, which is the answer to HITL-2. The canvas ▶ Run collect
 * form reads and writes the same fixture, so values entered on either surface
 * come back on the other.
 *
 * That persistence is **local to testing**. It does not by itself reach a
 * production workflow run: `POST /workflows/:id/run` does accept an `input`
 * body field, and a manual trigger's handler now sees it as `params.input`
 * (`run-workflow.ts:391`), but nothing wires this form's saved `step_tests`
 * fixture into that call — a caller has to pass `input` itself.
 */
export function TriggerFillForm({
  app,
  action,
  fields,
  persist,
}: {
  app: string;
  action: string;
  /** The trigger's `fields` param value (an array of field definitions). */
  fields: unknown;
  /**
   * Where to remember the entered values. Absent in the add-step builder — that
   * step is not in a workflow yet, so there is no `(workflowId, stepId)` to key
   * a fixture by and this form neither reads nor writes one.
   */
  persist?: StepTestPersist;
}) {
  const api = useW6WApi();
  // The workflow's selected project scopes document-expression resolution in the
  // trigger test (undefined outside the editor → server default project).
  const project = useWorkflowProject();
  const defs = useMemo(() => asFieldDefs(fields), [fields]);
  const params = useMemo(() => fieldsToParams(defs), [defs]);
  const hasFields = params.length > 0;

  // One value bag for both paths: declared fields fill it by key, a webhook's
  // raw payload replaces it wholesale.
  const [values, setValues] = useState<Record<string, unknown>>(() => seedValues(defs));

  const [state, setState] = useState<TestState | null>(null);

  // Pre-fill from the step's last saved fixture. Depends on the ids rather than
  // on `persist` itself — the host builds that object inline, so its identity
  // changes every render.
  const persistWorkflowId = persist?.workflowId;
  const persistStepId = persist?.stepId;
  // Nothing to wait for when there is no fixture key (the add-step builder).
  const [seeded, setSeeded] = useState(!persistWorkflowId || !persistStepId);
  useEffect(() => {
    if (!persistWorkflowId || !persistStepId) {
      setSeeded(true);
      return;
    }
    let canceled = false;
    api
      .listStepTests(persistWorkflowId, persistStepId)
      .then((tests) => {
        if (canceled) return;
        // `listStepTests` is oldest-first, so the LAST entry is the most recent
        // fixture — the same convention the editor's upstream-seed effect uses.
        // Layered over the declared defaults so a field added since the last run
        // still arrives with its default rather than blank. An `ExprValue`
        // (`{type:"expr",…}`) is stored and restored as-is: `FxField` derives
        // expression mode from the value, so it comes back as a chip.
        const latest = tests.length ? tests[tests.length - 1] : null;
        if (latest?.with) setValues((v) => ({ ...v, ...latest.with }));
        setSeeded(true);
      })
      // A missing/failed list must never block the form — fall back to the
      // declared defaults, silently, exactly as the seed effect does.
      .catch(() => {
        if (!canceled) setSeeded(true);
      });
    return () => {
      canceled = true;
    };
  }, [api, persistWorkflowId, persistStepId]);

  // A raw-JSON draft that is not a values map never reaches `values`. Testing
  // now WRITES the saved fixture the Run form pre-fills from, so running the
  // previous payload while the operator looks at a different one would persist
  // the wrong values too — the same interlock Run uses (T4.1.2's validity-out).
  const [draftValid, setDraftValid] = useState(true);
  // With no declared params the required-check is vacuously true — a webhook
  // payload has nothing to require.
  const canRun = draftValid && requiredParamsFilled(params, values);

  const run = async () => {
    setState({ status: "running" });
    let outcome: Exclude<TestState, { status: "running" }>;
    try {
      // The filled values become the trigger's output/run-input — the handler
      // reads `params.input` and returns it verbatim.
      const result = await api.invokeAction(app, action, { input: values }, { project });
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
    // Remember what was entered, and record the run AGAINST that fixture — the
    // same two-call sequence `StepTestRun` uses on the non-trigger Test path.
    // Without the `stepTestId` the fixture's `last_run_*` columns are never
    // written. Best-effort: a persist failure never masks the run's own result.
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
  };

  const logs = state && state.status !== "running" ? state.logs : undefined;

  return (
    <div className="w6w-stack">
      {/* Held until the saved values land, so the form is never shown with the
          defaults and then re-written under the operator's cursor. */}
      {!seeded ? (
        <p className="w6w-muted w6w-small">Loading saved values…</p>
      ) : (
        <>
          <PropertyEntryForm
            params={params}
            values={values}
            onChange={setValues}
            onValidityChange={setDraftValid}
          />
          {!hasFields && (
            <span className="w6w-hint">
              This trigger declares no fields — provide a sample payload to test with. It becomes
              the trigger's output state (<code>input</code>).
            </span>
          )}
        </>
      )}

      <div className="w6w-steptest">
        <div className="w6w-steptest-bar">
          <button
            type="button"
            className="w6w-btn w6w-btn-ghost"
            disabled={!seeded || !canRun || state?.status === "running"}
            onClick={run}
          >
            {state?.status === "running" ? "Running…" : "▶ Test run"}
          </button>
          {seeded && !canRun && (
            <span className="w6w-muted w6w-small">
              {draftValid
                ? "Fill the required fields to test."
                : "The payload must be a JSON object to test."}
            </span>
          )}
        </div>
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
            <div className="w6w-testout-label">Output state (filled values)</div>
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
    </div>
  );
}
