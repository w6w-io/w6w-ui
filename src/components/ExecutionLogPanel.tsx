import { useState } from "react";
import type { ReactNode } from "react";
import { CodeBlock } from "../CodeBlock.tsx";
import { StepStatusPill } from "./StepStatusPill.tsx";
import type { StepStatus } from "./StepStatusPill.tsx";

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
  /** ISO-8601 timestamp the step started, once it has. */
  startedAt?: string;
  /** ISO-8601 timestamp the step finished, once it has. */
  finishedAt?: string;
  /** The resolved input sent to the step's action, once it is known. */
  input?: unknown;
  /** The step's output, once it has one. */
  output?: unknown;
}

export interface ExecutionLogPanelProps {
  /** The run's steps, rendered in exactly this order — never re-sorted. */
  steps: ExecutionLogStep[];
  /** Shown instead of the list when `steps` is empty. */
  emptyLabel?: ReactNode;
}

/**
 * Read-only log of a workflow run's steps, in the order given: each row is
 * the step's status pill, its timing, and its resolved input/output.
 *
 * A pure display leaf — no data fetching, no polling, no layout media
 * queries (the host docks the panel; see `_scale.scss`'s breakpoint
 * docstring). Fills whatever box its host gives it.
 */
export function ExecutionLogPanel({ steps, emptyLabel }: ExecutionLogPanelProps) {
  if (steps.length === 0) {
    return (
      <div className="w6w-execution-log-empty">
        <p className="w6w-muted w6w-small">{emptyLabel ?? "No steps have run yet."}</p>
      </div>
    );
  }

  return (
    <ol className="w6w-execution-log">
      {steps.map((step) => (
        <ExecutionLogRow key={step.id} step={step} />
      ))}
    </ol>
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
 * user opens only to find "Not available." twice (A3).
 */
function ExecutionLogRow({ step }: { step: ExecutionLogStep }) {
  const [open, setOpen] = useState(false);
  const header = (
    <div className="w6w-execution-log-row-header">
      <StepStatusPill state={step.status} />
      <span className="w6w-execution-log-row-label">{step.label ?? step.id}</span>
      <StepTiming startedAt={step.startedAt} finishedAt={step.finishedAt} />
    </div>
  );

  if (step.input === undefined && step.output === undefined) {
    return (
      <li className="w6w-execution-log-row">
        <div className="w6w-section">{header}</div>
      </li>
    );
  }

  return (
    <li className="w6w-execution-log-row">
      <details className="w6w-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="w6w-section-summary">{header}</summary>
        {open && (
          <div className="w6w-execution-log-row-body w6w-section-body w6w-stack">
            <ExecutionLogJson title="Input" value={step.input} />
            <ExecutionLogJson title="Output" value={step.output} />
          </div>
        )}
      </details>
    </li>
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

/**
 * Input/output as read-only, syntax-highlighted JSON — `CodeBlock`, not
 * `JsonEditor`: per `CodeBlock.tsx`'s own doc comment, `JsonEditor` mounts a
 * CodeMirror instance to *edit* text, "heavy and semantically wrong for a
 * snippet nobody types into" — exactly this row's read-only value, rendered
 * potentially many times over a whole run. `ResolvedParams.tsx` doesn't fit
 * either: it renders a *schema* (`ActionParam[]`) against resolved values,
 * and this panel has no param schema, only the already-resolved input/output
 * values themselves (see the file header's "host maps `RunState`" note).
 * Never a plain `<pre>` dump: `CodeBlock` is this library's own read-only
 * structured-code idiom (highlighting, copy affordance, `--w6w-code-*`
 * tokens), the thing `<pre>` is not.
 */
function ExecutionLogJson({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="w6w-execution-log-json w6w-stack">
      <strong className="w6w-small">{title}</strong>
      {value === undefined ? (
        <p className="w6w-muted w6w-small">Not available.</p>
      ) : (
        <CodeBlock code={JSON.stringify(value, null, 2)} language="json" />
      )}
    </div>
  );
}
