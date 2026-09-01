import type { ReactNode } from "react";
import type { FlowStep } from "./flow-types.ts";

/** The base, always-available node settings — independent of the action's params. */
export type NodeConfig = Pick<FlowStep, "retry" | "onError" | "notes">;

/**
 * A stable reference over a Function or a Workflow (core rfcs/endpoint.md ·
 * Callable). Declared **locally** — structurally identical to
 * `@w6w/workflow-types`'s `Callable` — because `@w6w/ui` has no dependency edge
 * to that package and must not gain one (D-10).
 */
export type CallableRef =
  | { kind: "function"; function: string }
  | { kind: "workflow"; workflow: string };

/**
 * Node settings form: retry-on-fail, error handling, and notes. Operates on a
 * plain {@link NodeConfig} so it's shared by the add-a-step config and the node
 * editor (all fields optional; absent = defaults).
 *
 * `hasGraph` and `reroute` are ADDITIVE (D-10, F-2.1): a graph-less host — a
 * Function or an Endpoint, which has no canvas and so can never author an
 * `Edge.when: "error"` — passes `hasGraph={false}` and supplies `reroute` so a
 * failure can still be redirected somewhere. Both are omitted by every
 * existing caller, so `NodeConfig` itself and every pre-existing render path
 * are unchanged.
 */
export function NodeConfigForm({
  config,
  onChange,
  readOnly,
  hasGraph = true,
  failureHandling = true,
  reroute,
}: {
  config: NodeConfig;
  onChange: (next: NodeConfig) => void;
  readOnly?: boolean;
  /**
   * `false` for a graph-less host. Swaps the "outgoing error edge" hint for a
   * sentence about the `reroute` field, and drops `continue-record` from the
   * `onError` select — `continue-record` writes to a run's `stepErrors`, which
   * a Function/Endpoint invocation has none of. Default `true` reproduces
   * today's behavior byte-identically.
   */
  hasGraph?: boolean;
  /**
   * `false` for a node that cannot fail on its own — today only a trigger,
   * which is the run's ENTRY rather than a step that acts: it emits the start
   * payload, makes no vendor call, and so has nothing to retry and no failure
   * to police (human report, 2026-09-01). Drops the retry and "On error"
   * controls; Notes stay. Default `true` reproduces today's behavior
   * byte-identically.
   */
  failureHandling?: boolean;
  /**
   * Failure re-dispatch — a `CallableRef`, rendered only when supplied. `value`/
   * `onChange` are the host's own state (so it can offer a "clear" affordance);
   * `picker` is a slot the host renders its own selection control into — this
   * component never reaches for anything outside `{retry, onError, notes,
   * reroute}`, so it still has no view of the app/workflow catalog itself.
   */
  reroute?: {
    value: CallableRef | undefined;
    onChange: (next: CallableRef | undefined) => void;
    picker: ReactNode;
  };
}) {
  const retryOn = !!config.retry;
  const attempts = config.retry?.maxAttempts ?? 3;
  const delayMs = config.retry?.delayMs ?? 1000;
  const backoff = config.retry?.backoff ?? "fixed";
  const onError = config.onError ?? "fail";

  const setRetry = (patch: Partial<NonNullable<NodeConfig["retry"]>>) =>
    onChange({
      ...config,
      retry: { maxAttempts: attempts, delayMs, backoff, ...config.retry, ...patch },
    });

  return (
    <div className="w6w-stack">
      {failureHandling && (
        <>
          {/* Retry on fail */}
          <label className="w6w-field">
            <span>
              <input
                type="checkbox"
                checked={retryOn}
                disabled={readOnly}
                onChange={(e) =>
                  onChange({
                    ...config,
                    retry: e.target.checked
                      ? { maxAttempts: attempts, delayMs, backoff }
                      : undefined,
                  })
                }
              />{" "}
              Retry on failure
            </span>
            <span className="w6w-hint">Re-run this step if it fails, up to N attempts.</span>
          </label>
          {retryOn && (
            <div className="w6w-field-row">
              <label className="w6w-field">
                <span>Attempts</span>
                <input
                  type="number"
                  min={1}
                  value={attempts}
                  readOnly={readOnly}
                  onChange={(e) =>
                    setRetry({ maxAttempts: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>
              <label className="w6w-field">
                <span>Delay (ms)</span>
                <input
                  type="number"
                  min={0}
                  value={delayMs}
                  readOnly={readOnly}
                  onChange={(e) => setRetry({ delayMs: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label className="w6w-field">
                <span>Backoff</span>
                <select
                  value={backoff}
                  disabled={readOnly}
                  onChange={(e) => setRetry({ backoff: e.target.value as "fixed" | "exponential" })}
                >
                  <option value="fixed">Fixed</option>
                  <option value="exponential">Exponential</option>
                </select>
              </label>
            </div>
          )}

          {/* Error handling */}
          <label className="w6w-field">
            <span>On error</span>
            <select
              value={onError}
              disabled={readOnly}
              onChange={(e) => {
                const v = e.target.value as NonNullable<NodeConfig["onError"]>;
                // "fail" is the default — store it as absent to keep the step clean.
                onChange({ ...config, onError: v === "fail" ? undefined : v });
              }}
            >
              <option value="fail">Stop the run (default)</option>
              <option value="continue">Continue to the next step</option>
              {hasGraph && (
                <option value="continue-record">
                  Continue to the next step &amp; record the error
                </option>
              )}
            </select>
            {hasGraph ? (
              // This select reads as if it had total authority over failure, and since
              // an error edge became authorable it no longer does: per D-T1-3 an
              // outgoing error edge OVERRIDES this policy. The honest fix is a static
              // hint — this form receives only `{ retry, onError, notes }` (plus the
              // additive `reroute` below) and has no view of the graph, so it cannot
              // know whether the step has such an edge, and giving it one just to
              // find out is out of scope.
              //
              // Ordering per rfcs/workflow.md's Amendment — 2026-07-29 (failure-
              // conditioned edges): retries come first (only a *finally* failed
              // attempt reaches this policy at all); Continue/Continue & record
              // both carry on down this step's normal outgoing edges despite the
              // failure; an outgoing error edge overrides all of the above. The
              // drag gesture named below is the SAME one `LANE_HINT` (T1.1.1)
              // describes for the error exit port — not re-derived here.
              <span className="w6w-muted w6w-small">
                Retries run first: this policy is reached only once this step's retry attempts (if
                any) are exhausted — a run that succeeds on a later attempt continues down the
                normal path instead. Once reached, <strong>Continue</strong> and{" "}
                <strong>Continue &amp; record the error</strong> both carry on down this step's
                ordinary outgoing edges despite the failure. If this step has an outgoing{" "}
                <strong>error</strong> edge on the canvas, that edge decides what happens instead
                and this policy is not consulted — drawn by dragging from the step's error exit
                port.
              </span>
            ) : (
              // Graph-less host: there is no canvas and so no error edge to draw —
              // the reroute field below is this host's equivalent. Must not
              // contradict the graph arm above: retries still come first here too.
              <span className="w6w-muted w6w-small">
                Retries run first: this policy (and reroute, below) is only reached once this step's
                retry attempts (if any) are exhausted — a run that succeeds on a later attempt
                continues normally. This step has no canvas of its own, so it can't carry an error
                edge. Set a <strong>reroute</strong> target below to send a failure somewhere else
                instead of stopping.
              </span>
            )}
          </label>
        </>
      )}

      {/* Reroute on failure — graph-less hosts only (additive; see `reroute`).
          A `<div>`, not a `<label>`: `picker` is the host's own control (of
          unknown shape), so there is no single form element to associate a
          label with here. */}
      {reroute && (
        <div className="w6w-field">
          <span>Reroute on failure</span>
          <div className="w6w-field-row">
            {reroute.picker}
            {reroute.value && (
              <button
                type="button"
                className="w6w-btn w6w-btn-ghost"
                disabled={readOnly}
                onClick={() => reroute.onChange(undefined)}
              >
                Clear
              </button>
            )}
          </div>
          <span className="w6w-hint">
            Invoked once, after retry is exhausted, if this step still fails; its output becomes
            this step's output.
          </span>
        </div>
      )}

      {/* Notes — shown under the step's own card on the canvas (2026-08-30),
          not just here, so a description written once helps a reader orient
          without opening every step. */}
      <label className="w6w-field">
        <span>Notes</span>
        <textarea
          rows={3}
          value={config.notes ?? ""}
          readOnly={readOnly}
          placeholder="A short description — shown under this step on the canvas. Not executed."
          onChange={(e) => onChange({ ...config, notes: e.target.value || undefined })}
        />
      </label>
    </div>
  );
}
