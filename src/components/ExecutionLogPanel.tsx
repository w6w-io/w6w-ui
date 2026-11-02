import type { StateWarningCode } from "@w6w/expr";
import { useState } from "react";
import type { ReactNode } from "react";
import { CodeBlock } from "../CodeBlock.tsx";
import { conditionOperatorLabel } from "../condition-editor.ts";
import { internalNodeDef } from "../flow-types.ts";
import type { StepMeta } from "../provider.tsx";
import { IconButton } from "./IconButton.tsx";
import { ResultViewer } from "./ResultViewer.tsx";
import { StepStatusPill } from "./StepStatusPill.tsx";
import type { SkipReason, StepStatus } from "./StepStatusPill.tsx";

/** What a step is: the app and action it uses, and whether it is a trigger (`uses.trigger`). */
export interface ExecutionLogNode {
  app: string;
  action: string;
  trigger?: boolean;
  appName?: string;
  actionName?: string;
}

/** A node's kind and display names, a built-in `@w6w/*` node resolved from its own definition. */
function describeNode(node: ExecutionLogNode): {
  trigger: boolean;
  appName: string;
  actionName: string;
} {
  const builtin = internalNodeDef(node.app, node.action);
  return {
    trigger: node.trigger === true || builtin?.group === "trigger",
    appName: node.appName ?? builtin?.displayName ?? node.app,
    actionName: node.actionName ?? builtin?.label ?? node.action,
  };
}

/**
 * A step's or run's failure, already normalised by the HOST from the workflow
 * spec's `StepError` (`code`/`message`/`phase`/`retryable`). The panel never
 * parses an `unknown` error itself — same "host owns the data" split as the
 * rest of this file. Rendered in `TriggerFillForm`'s error visual: a
 * `.w6w-result.w6w-error` box, an optional `<code>` badge line, then the message.
 */
export interface ExecutionLogError {
  /** `StepError.code`. Optional: the host may normalise an error that carries no code. */
  code?: string;
  /** The human-readable reason. Never empty when the host supplies it. */
  message: string;
  /** `StepError.phase`, when known. Carried for the host; not rendered. */
  phase?: string;
  /** `StepError.retryable`, when known. Carried for the host; not rendered. */
  retryable?: boolean;
}

/**
 * One entry of `RunState.stepErrors` — a step failure the run recorded and
 * moved past (`onError: "continue-record"`, or a failure an error edge
 * handled), so the run itself may still have succeeded.
 */
export interface ExecutionLogRecordedError {
  /** The step the error belongs to. */
  stepId: string;
  /** Human-readable step name. Falls back to `stepId` when rendered. */
  label?: string;
  error: ExecutionLogError;
}

/**
 * One step's display row — an already-mapped, already-resolved slice of a
 * `RunState`/`StepExecution` (workflow spec). The HOST maps its own run
 * state into this shape (same "host owns the data, the panel is
 * presentational" split `readOnly` already establishes elsewhere in this
 * package) — this component never fetches, polls, or reaches for an SDK.
 */
export interface ExecutionLogStep {
  /** Stable id for this row — typically the step id from the workflow definition. */
  id: string;
  /** Human-readable step name. Falls back to `id` when omitted. */
  label?: string;
  status: StepStatus;
  /**
   * Why a `skipped` step did not run (`StepExecution.skipReason`). `not_on_path` rows leave the
   * list for the "other paths" footer; the rest show a short reason beside the Skipped pill.
   * Absent (a run recorded before reasons existed) ⇒ a plain Skipped row, as before.
   */
  skipReason?: SkipReason;
  /** ISO-8601 timestamp the step started, once it has. */
  startedAt?: string;
  /** ISO-8601 timestamp the step finished, once it has. */
  finishedAt?: string;
  /** The resolved input sent to the step's action, once it is known. */
  input?: unknown;
  /** The step's output, once it has one. */
  output?: unknown;
  /**
   * What ran (`StepExecution.meta`): app, version, action and connection id. Shown as a
   * Metadata block after Output. Absent or `null` ⇒ no block at all (R-12: no filler).
   */
  meta?: StepMeta | null;
  /**
   * What this step IS, from the workflow definition — shown on the row itself so a run reads as
   * "Trigger · Cohost · Order Placed" rather than a bare node id. `appName`/`actionName` are the
   * host's display names for a registered app; a built-in `@w6w/*` node is named here from its
   * own definition, and anything unnamed falls back to the raw id. Absent ⇒ the row shows its
   * label alone, as before.
   */
  node?: ExecutionLogNode;
  /**
   * Why the step failed (`StepExecution.error`, "present on failed"). Rendered
   * below the row's box and outside its lazy `<details>` body, so the reason
   * reads without expanding the row.
   */
  error?: ExecutionLogError;
  /** For each only (I4): the per-iteration body-step records, index ascending. */
  iterations?: ExecutionLogIteration[];
  /** Distinct iteration indices the run recorded (may exceed `iterations.length`). */
  iterationsTotal?: number;
  /** How many of those iterations failed. */
  iterationsFailed?: number;
  /** `true` when `iterations` holds fewer than `iterationsTotal`. */
  iterationsTruncated?: boolean;
  /**
   * The step's state writes (`stateWrites`, the run's state log rows for this step), in write
   * order: `state.<path>: old → new`, or a warning when `warning` is set (a `StateWarningCode`).
   * `item` is the For each item a hoisted body write came from. Absent, `null` or `[]` ⇒ no rows.
   */
  stateWrites?: Array<{
    path: string[];
    item?: number;
    old?: unknown;
    new?: unknown;
    warning?: string;
  }> | null;
  /**
   * The run's state tree after this step, shown as "State after this step" in the State block.
   * Absent or `null` ⇒ not shown; `{}` shows only alongside writes.
   */
  stateAfter?: Record<string, unknown> | null;
}

/** One For each iteration: its status and the body-step records, in execution order. */
export interface ExecutionLogIteration {
  /** 0-based; the same number as `foreach.index` in that iteration's expressions. */
  index: number;
  status: "succeeded" | "failed" | "running";
  /** The body step that failed, when one did. */
  failedNodeId?: string;
  steps: ExecutionLogStep[];
}

export interface ExecutionLogPanelProps {
  /** The run's steps, rendered in exactly this order — never re-sorted. */
  steps: ExecutionLogStep[];
  /** Shown instead of the list when `steps` is empty. */
  emptyLabel?: ReactNode;
  /**
   * Supplied ⇒ the panel grows a header row carrying a dismiss control that
   * calls this and nothing else (T1.1.1). Omitted ⇒ no header row at all, no
   * extra DOM node. The panel still owns no run state — it only reports the
   * click; the host decides what dismissing means.
   */
  onDismiss?: () => void;
  /**
   * The run's own failure (`RunState.error`). Rendered below the dismiss head
   * and above the steps — in the empty branch too, since a run that failed
   * before any step ran has nothing else to say why.
   */
  runError?: ExecutionLogError;
  /**
   * Step failures the run recorded and moved past (`RunState.stepErrors`),
   * one error block each, in the order given, after `runError`.
   */
  stepErrors?: ExecutionLogRecordedError[];
}

/**
 * Read-only log of a workflow run's steps, in the order given: each row is
 * the step's status pill, its timing, and its resolved input/output.
 *
 * A pure display leaf — no data fetching, no polling, no layout media
 * queries (the host docks the panel; see `_scale.scss`'s breakpoint
 * docstring). Fills whatever box its host gives it.
 */
export function ExecutionLogPanel({
  steps,
  emptyLabel,
  onDismiss,
  runError,
  stepErrors,
}: ExecutionLogPanelProps) {
  // Rendered by BOTH branches below, deliberately: the reported repro (T-1) is
  // a canvas whose log panel shows "No nodes have run yet." — a header mounted
  // only above the `<ol>` would be invisible in exactly that state, and that is
  // the state the dismiss control exists to get the user out of.
  const head = onDismiss ? (
    <div className="w6w-execution-log-head">
      <IconButton label="Dismiss run log" data-testid="execution-log-dismiss" onClick={onDismiss}>
        ×
      </IconButton>
    </div>
  ) : null;

  // Same both-branches rule as `head`: a run that failed before its first step
  // is exactly the empty branch. Nothing to report ⇒ no wrapper node at all.
  const recorded = stepErrors ?? [];
  const errors =
    runError || recorded.length > 0 ? (
      <div className="w6w-execution-log-errors w6w-stack">
        {runError && <ExecutionLogErrorBlock error={runError} />}
        {recorded.map((entry, index) => (
          <ExecutionLogErrorBlock
            // `stepId` alone may repeat (a step retried into the record twice).
            key={`${entry.stepId}:${index}`}
            label={entry.label ?? entry.stepId}
            error={entry.error}
          />
        ))}
      </div>
    ) : null;

  // A step on another path (not downstream of the fired trigger) was never part of this run:
  // it is not a skip, so it leaves the list for one collapsed footer line.
  const inRun = steps.filter((s) => !isOffPath(s));
  const offPath = steps.filter(isOffPath);
  const footer = offPath.length > 0 ? <ExecutionLogOffPath steps={offPath} /> : null;

  if (inRun.length === 0) {
    return (
      <>
        {head}
        {errors}
        <div className="w6w-execution-log-empty">
          <p className="w6w-muted w6w-small">{emptyLabel ?? "No nodes have run yet."}</p>
        </div>
        {footer}
      </>
    );
  }

  return (
    <>
      {head}
      {errors}
      <ol className="w6w-execution-log">
        {inRun.map((step) => (
          <ExecutionLogRow key={step.id} step={step} />
        ))}
      </ol>
      {footer}
    </>
  );
}

const isOffPath = (step: ExecutionLogStep) =>
  step.status === "skipped" && step.skipReason === "not_on_path";

/** The short reason shown beside a real skip's pill. */
const SKIP_REASON_LABELS: Record<Exclude<SkipReason, "not_on_path">, string> = {
  condition: "condition false",
  stopped: "run stopped",
  disabled: "disabled",
};

/** "N steps on other paths, not part of this run" — collapsed; expands to their names. */
function ExecutionLogOffPath({ steps }: { steps: ExecutionLogStep[] }) {
  const n = steps.length;
  return (
    <details className="w6w-execution-log-off-path" data-testid="execution-log-off-path">
      <summary className="w6w-muted w6w-small">
        {`${n} ${n === 1 ? "step" : "steps"} on other paths, not part of this run`}
      </summary>
      <ul className="w6w-muted w6w-small">
        {steps.map((s) => (
          <li key={s.id}>{s.label ?? s.id}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Collapsed-by-default disclosure per step (REVIEW.md R-1) — reuses
 * `.w6w-section`'s bordered `<details>` idiom (`ApiCallsPanel.tsx`,
 * `ParamsForm.tsx`'s `section: "collapsible"`), not a bespoke card. The
 * `<summary>` is the one-line scan line (pill + label + timing, unchanged
 * content from the old always-visible row header); Input/Output move inside
 * the details body, and are only mounted into the DOM once opened — a
 * closed run of N steps costs N compact rows, not N×2 rendered JSON blocks.
 *
 * A step with neither `input` nor `output` has nothing to disclose: it
 * renders a plain, non-interactive row (still `.w6w-section`-styled for
 * visual consistency with its siblings) rather than an empty `<details>` a
 * user opens only to find "Not available." twice (A3). An `error` alone is
 * not something to disclose either: it renders on every row as a sibling
 * AFTER the row's box — outside the lazily mounted `<details>` body (so it
 * reads while collapsed and never mounts twice once opened) and outside the
 * `<summary>` (whose phrasing-content model and click-to-toggle make it the
 * wrong home for a selectable block of text).
 */
function ExecutionLogRow({ step }: { step: ExecutionLogStep }) {
  const [open, setOpen] = useState(false);
  const node = step.node ? describeNode(step.node) : null;
  const header = (
    <div className="w6w-execution-log-row-header">
      <StepStatusPill state={step.status} />
      {node && (
        <span
          className={`w6w-execution-log-kind${node.trigger ? " w6w-execution-log-kind-trigger" : ""}`}
          data-testid="execution-log-kind"
        >
          {node.trigger ? "Trigger" : "Node"}
        </span>
      )}
      <span className="w6w-execution-log-row-title">
        <span className="w6w-execution-log-row-label">{step.label ?? step.id}</span>
        {node && (
          <span className="w6w-execution-log-row-uses" data-testid="execution-log-uses">
            {node.appName === node.actionName
              ? node.appName
              : `${node.appName} · ${node.actionName}`}
          </span>
        )}
      </span>
      {step.status === "skipped" && step.skipReason && step.skipReason !== "not_on_path" && (
        <span className="w6w-execution-log-skip-reason" data-testid="execution-log-skip-reason">
          {SKIP_REASON_LABELS[step.skipReason]}
        </span>
      )}
      <StepTiming startedAt={step.startedAt} finishedAt={step.finishedAt} />
    </div>
  );

  const error = step.error ? <ExecutionLogErrorBlock error={step.error} /> : null;
  const loop = Array.isArray(step.iterations) ? <ExecutionLogIterations step={step} /> : null;

  const state = hasStateBlock(step) ? <ExecutionLogState step={step} /> : null;

  if (step.input === undefined && step.output === undefined && !step.meta && !state) {
    return (
      <li className="w6w-execution-log-row">
        <div className="w6w-section">{header}</div>
        {error}
        {loop}
      </li>
    );
  }

  return (
    <li className="w6w-execution-log-row">
      <details className="w6w-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="w6w-section-summary">{header}</summary>
        {open && (
          <div className="w6w-execution-log-row-body w6w-section-body w6w-stack">
            <ExecutionLogConditions input={step.input} />
            <ExecutionLogJson title="Input" value={step.input} />
            <ExecutionLogJson title="Output" value={step.output} />
            {step.meta && (
              <div className="w6w-execution-log-json w6w-stack">
                <strong className="w6w-small">Metadata</strong>
                <CodeBlock code={JSON.stringify(step.meta, null, 2)} language="json" />
              </div>
            )}
            {state}
          </div>
        )}
      </details>
      {error}
      {loop}
    </li>
  );
}

/**
 * A For each row's per-iteration view: a summary (count, failures, pointer at the
 * failing body step), one presentational chip per served iteration, and one
 * sub-row per body step with its own iteration `<select>` (failed iteration
 * preselected, else the last served one). Pure props -> DOM; no fetching.
 */
function ExecutionLogIterations({ step }: { step: ExecutionLogStep }) {
  const iterations = step.iterations ?? [];
  const total = step.iterationsTotal ?? iterations.length;
  const failedCount =
    step.iterationsFailed ?? iterations.filter((it) => it.status === "failed").length;
  const firstFailed = iterations.find((it) => it.status === "failed");
  const defaultIndex = firstFailed?.index ?? iterations[iterations.length - 1]?.index;

  const bodyIds: string[] = [];
  const labels = new Map<string, string>();
  for (const it of iterations) {
    for (const s of it.steps) {
      if (!labels.has(s.id)) {
        bodyIds.push(s.id);
        labels.set(s.id, s.label ?? s.id);
      }
    }
  }
  const failedId =
    firstFailed?.failedNodeId ?? firstFailed?.steps.find((s) => s.status === "failed")?.id;

  return (
    <div className="w6w-execution-log-foreach w6w-stack">
      <div className="w6w-small" data-testid="execution-log-foreach-summary">
        <span>
          {total === 1 ? "1 item" : `${total} items`}
          {failedCount > 0 ? ` · ${failedCount} failed` : ""}
        </span>
        {firstFailed && failedId !== undefined && (
          <div>
            {labels.get(failedId) ?? failedId} failed in iteration {firstFailed.index}
          </div>
        )}
        {step.iterationsTruncated === true && (
          <div className="w6w-muted">{`showing ${iterations.length} of ${total}`}</div>
        )}
      </div>
      <div className="w6w-execution-log-iteration-chips">
        {iterations.map((it) => (
          <span
            key={it.index}
            className={`w6w-execution-log-iteration-chip w6w-execution-log-iteration-chip-${it.status}`}
            data-testid="execution-log-iteration-chip"
            data-status={it.status}
          >
            {it.index} · {it.status}
          </span>
        ))}
      </div>
      <ul className="w6w-execution-log-subrows">
        {bodyIds.map((id) => (
          <ExecutionLogBodyStep
            key={id}
            id={id}
            label={labels.get(id) ?? id}
            iterations={iterations}
            initial={defaultIndex}
          />
        ))}
      </ul>
    </div>
  );
}

function ExecutionLogBodyStep({
  id,
  label,
  iterations,
  initial,
}: {
  id: string;
  label: string;
  iterations: ExecutionLogIteration[];
  initial: number | undefined;
}) {
  const [selected, setSelected] = useState<number | undefined>(initial);
  const record = iterations.find((it) => it.index === selected)?.steps.find((s) => s.id === id);
  return (
    <li className="w6w-execution-log-subrow w6w-stack">
      <div className="w6w-execution-log-subrow-head">
        <strong className="w6w-small">{label}</strong>
        <select
          className="w6w-select"
          aria-label={`Iteration for ${label}`}
          data-testid="execution-log-iteration-select"
          value={selected === undefined ? "" : String(selected)}
          onChange={(e) => setSelected(Number(e.currentTarget.value))}
        >
          {iterations.map((it) => (
            <option key={it.index} value={String(it.index)}>
              {`iteration ${it.index} (${it.status})`}
            </option>
          ))}
        </select>
      </div>
      {record ? (
        <ol className="w6w-execution-log">
          <ExecutionLogRow key={selected} step={record} />
        </ol>
      ) : (
        <p className="w6w-muted w6w-small">Did not run in this iteration.</p>
      )}
    </li>
  );
}

/**
 * `TriggerFillForm`'s StepError visual, reused rather than re-invented: the
 * `.w6w-result.w6w-error` box, an optional muted `<code>` line, then the
 * message. `label` (recorded step errors only) names the step on a line above.
 * The code line's spacing lives in `_execution-log.scss` as tokens instead of
 * `TriggerFillForm`'s inline style — same values (`0.75` opacity, a 4px gap).
 */
function ExecutionLogErrorBlock({ error, label }: { error: ExecutionLogError; label?: string }) {
  return (
    <div className="w6w-result w6w-error">
      {label !== undefined && <strong className="w6w-execution-log-error-label">{label}</strong>}
      {error.code && (
        <div className="w6w-small w6w-execution-log-error-code">
          <code>{error.code}</code>
        </div>
      )}
      {error.message}
    </div>
  );
}

/**
 * "started / finished, or elapsed" (A2): both timestamps render verbatim
 * plus the computed elapsed duration between them; only `startedAt` renders
 * as "Started <ts>"; neither renders as a plain dash. Never a live-ticking
 * clock — a `setInterval` would make this component a timer owner rather
 * than a pure function of its props.
 */
function StepTiming({ startedAt, finishedAt }: { startedAt?: string; finishedAt?: string }) {
  if (startedAt && finishedAt) {
    const elapsed = formatElapsed(startedAt, finishedAt);
    return (
      <span className="w6w-execution-log-timing">
        {startedAt} → {finishedAt}
        {elapsed && <span> ({elapsed})</span>}
      </span>
    );
  }
  if (startedAt) {
    return <span className="w6w-execution-log-timing">Started {startedAt}</span>;
  }
  return <span className="w6w-execution-log-timing">—</span>;
}

function formatElapsed(startedAt: string, finishedAt: string): string | null {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(finishedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const ms = endMs - startMs;
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

/** Each payload starts collapsed and mounts its read-only JSON tree on demand.
 * The shared viewer provides key folding, Expand/Collapse all and full-value copy.
 * Force JSON so an output string stays a string, even when it contains HTML or JSON text. */
function ExecutionLogJson({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === undefined) {
    return (
      <div className="w6w-execution-log-json w6w-stack">
        <strong className="w6w-small">{title}</strong>
        <p className="w6w-muted w6w-small">Not available.</p>
      </div>
    );
  }
  return (
    <details
      className="w6w-execution-log-json"
      open={open}
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary>
        <strong className="w6w-small">{title}</strong>
      </summary>
      {open && <ResultViewer value={value} format="json" />}
    </details>
  );
}

interface ConditionRow {
  left: unknown;
  op: string;
  right: unknown;
  result: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The engine's `{ conditions, combinator? }` trace on a record, if it carries one. */
function conditionTrace(v: unknown): { rows: ConditionRow[]; combinator?: string } | undefined {
  if (!isRecord(v) || !Array.isArray(v.conditions)) return;
  const rows = v.conditions.filter(
    (r): r is ConditionRow => isRecord(r) && typeof r.op === "string" && "result" in r,
  );
  if (rows.length === 0) return;
  return { rows, combinator: typeof v.combinator === "string" ? v.combinator : undefined };
}

/**
 * An If / Stop workflow / Router input's resolved comparisons as a left | operator | right |
 * result table — what was compared, not only `condition: true`. The engine records them
 * beside the boolean (`{ conditions: [{ left, op, right, result }], combinator? }`; a Router
 * per route); a record without that trace renders nothing, and the raw Input below still
 * shows everything.
 */
function ExecutionLogConditions({ input }: { input: unknown }) {
  const groups: { title?: string; trace: NonNullable<ReturnType<typeof conditionTrace>> }[] = [];
  const own = conditionTrace(input);
  if (own) groups.push({ trace: own });
  if (isRecord(input) && Array.isArray(input.routes)) {
    for (const route of input.routes) {
      const trace = conditionTrace(route);
      if (!trace || !isRecord(route)) continue;
      groups.push({ title: String(route.label ?? route.id ?? "Route"), trace });
    }
  }
  if (groups.length === 0) return null;
  return (
    <div className="w6w-execution-log-json w6w-stack" data-testid="execution-log-conditions">
      <strong className="w6w-small">Condition</strong>
      {groups.map(({ title, trace }, g) => (
        <div key={title ?? g} className="w6w-stack">
          {title && <span className="w6w-small w6w-muted">{title}</span>}
          {trace.combinator && trace.rows.length > 1 && (
            <span className="w6w-small w6w-muted">
              {trace.combinator === "or" ? "Any row must match" : "Every row must match"}
            </span>
          )}
          <div className="w6w-data-table-frame">
            <table className="w6w-data-table w6w-execution-log-conditions">
              <thead>
                <tr>
                  <th>Left</th>
                  <th>Operator</th>
                  <th>Right</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {trace.rows.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder.
                  <tr key={i}>
                    <td>
                      <code>{operandText(row.left)}</code>
                    </td>
                    <td>{conditionOperatorLabel(row.op)}</td>
                    <td>
                      <code>{operandText(row.right)}</code>
                    </td>
                    <td
                      className={
                        row.result
                          ? "w6w-execution-log-condition-true"
                          : "w6w-execution-log-condition-false"
                      }
                    >
                      {row.result ? "true" : "false"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A resolved operand as JSON, so `""`, `"5"` vs `5` and `null` read apart. */
function operandText(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

/** Plain-language text for each state-write warning code — never the raw code. */
const STATE_WARNING_LABELS: Record<StateWarningCode, string> = {
  not_object: "Not written — the output isn't an object, so it can't be merged at the root",
  missing_source: "Not written — the output has no value at that field",
  null_append: "Not appended — the value was null",
  append_not_array: "Not appended — the existing value isn't a list",
  write_too_large: "Not written — the value is too large",
  run_too_large: "Not written — the run's state would grow past its size limit",
  too_deep: "Not written — the value is nested too deeply",
  key_too_long: "Not written — a key in the value is too long",
  forbidden_key: "Not written — the value uses a reserved key name",
  log_truncated: "Later state changes aren't shown — the run's state log reached its limit",
};

function stateWarningLabel(code: string): string {
  return Object.hasOwn(STATE_WARNING_LABELS, code)
    ? STATE_WARNING_LABELS[code as StateWarningCode]
    : code;
}

function hasStateBlock(step: ExecutionLogStep): boolean {
  const hasWrites = Array.isArray(step.stateWrites) && step.stateWrites.length > 0;
  const after = step.stateAfter;
  const hasAfter = typeof after === "object" && after !== null;
  return hasWrites || (hasAfter && Object.keys(after).length > 0);
}

const STATE_VALUE_MAX = 120;

function stateValueText(v: unknown): string {
  if (v === undefined) return "(not set)";
  const text = JSON.stringify(v) ?? String(v);
  return text.length > STATE_VALUE_MAX ? `${text.slice(0, STATE_VALUE_MAX)}…` : text;
}

/**
 * The State block: one row per state write in the order the run recorded them
 * (`state.<path>: old → new`, or the warning that stopped it), then the run's
 * state tree after this step. Rendered only when there is something to show.
 */
function ExecutionLogState({ step }: { step: ExecutionLogStep }) {
  const writes = Array.isArray(step.stateWrites) ? step.stateWrites : [];
  const after = step.stateAfter;
  return (
    <div className="w6w-execution-log-state w6w-stack" data-testid="execution-log-state">
      <strong className="w6w-small">State</strong>
      {writes.length > 0 && (
        <ul className="w6w-execution-log-state-writes">
          {writes.map((w, i) => {
            const path = Array.isArray(w.path) ? w.path : [];
            const label = `state${path.length ? `.${path.join(".")}` : ""}${w.item !== undefined ? ` (item ${w.item})` : ""}`;
            return w.warning !== undefined ? (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, never reordered
                key={i}
                className="w6w-execution-log-state-write w6w-execution-log-state-warning w6w-small"
                data-testid="execution-log-state-write"
                data-warning={w.warning}
              >
                {`${label}: ${stateWarningLabel(w.warning)}`}
              </li>
            ) : (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, never reordered
                key={i}
                className="w6w-execution-log-state-write w6w-small"
                data-testid="execution-log-state-write"
              >
                {`${label}: ${stateValueText(w.old)} → ${stateValueText(w.new)}`}
              </li>
            );
          })}
        </ul>
      )}
      {typeof after === "object" && after !== null && (
        <div className="w6w-stack" data-testid="execution-log-state-after">
          <span className="w6w-small w6w-muted">State after this step</span>
          <CodeBlock code={JSON.stringify(after, null, 2)} language="json" />
        </div>
      )}
    </div>
  );
}
