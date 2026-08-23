import type { UptimeCellState, UptimeDay } from "./UptimeStrip.tsx";
import { placeIncidentBar } from "./history-scale.ts";

/** The calendar window both lanes are plotted against. Both bounds inclusive. */
export interface HistoryWindow {
  /** Inclusive first calendar day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last calendar day, `YYYY-MM-DD`. */
  to: string;
}

/** One entry in the vendor's incident feed. */
export interface VendorIncidentBar {
  id?: string;
  title: string;
  state: UptimeCellState;
  /** ISO instant. Absent = a point-in-time update, not a span. */
  startedAt?: string;
  updatedAt?: string;
  /** ISO instant. Absent WITH `startedAt` present = still open. */
  resolvedAt?: string;
  components?: string[];
  link?: string;
}

export interface HistoryTimelineProps {
  window: HistoryWindow;
  /** Execution lane, oldest first, one entry per calendar day. */
  days: UptimeDay[];
  /** Vendor lane. `undefined` = this vendor publishes no incident history at all. */
  incidents?: VendorIncidentBar[];
  /** Overrides the vendor lane's empty text. */
  vendorEmptyLabel?: string;
  /** Clock injection for tests and for an open incident's right edge. Defaults to `Date.now()`. */
  nowMs?: number;
  ariaLabel?: string;
}

const STATE_LABELS: Record<UptimeCellState, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

const NO_FEED_LABEL = "This vendor publishes no incident history.";
const QUIET_LABEL = "No incidents in this window.";

function barTitle(bar: VendorIncidentBar): string {
  const start = bar.startedAt ?? bar.updatedAt;
  const parts = [bar.title];
  if (bar.components !== undefined && bar.components.length > 0) {
    parts.push(`(${bar.components.join(", ")})`);
  }
  if (start !== undefined) {
    parts.push(
      bar.resolvedAt !== undefined ? `${start} – ${bar.resolvedAt}` : `${start} – ongoing`,
    );
  }
  return parts.join(" ");
}

/**
 * Two time series — our per-day execution history and the vendor's incident
 * history — plotted on one shared x-axis, so "our calls failed *during* that
 * vendor incident" is a visible alignment rather than a claim.
 *
 * Purely presentational, same discipline as `UptimeStrip`: `days` is already
 * one already-decided state per calendar day (no sort, no reverse, no gap
 * fill), and `incidents` is already the vendor's own feed. This component
 * places them; it makes no judgement about what counts as an incident.
 *
 * `incidents === undefined` ("this vendor publishes no incident history") and
 * `incidents === []` ("nothing happened in this window") are different facts
 * and render different empty-row text — Stripe is the first, a quiet Slack
 * window is the second. Either way the axis and the execution lane render in
 * full, at full width: a vendor with no feed never shrinks the half of the
 * chart that does have data.
 *
 * Severity is encoded twice, same rule as `UptimeStrip` and `HealthStatusPill`:
 * a per-state class AND a geometry difference (fill height on a day cell,
 * clip markers on a bar), never colour alone. Every cell and every bar
 * carries a `title`.
 */
export function HistoryTimeline({
  window: win,
  days,
  incidents,
  vendorEmptyLabel,
  nowMs = Date.now(),
  ariaLabel,
}: HistoryTimelineProps) {
  const n = days.length;
  const cellWidthPct = n > 0 ? 100 / n : 0;

  const emptyLabel =
    incidents === undefined
      ? (vendorEmptyLabel ?? NO_FEED_LABEL)
      : incidents.length === 0
        ? (vendorEmptyLabel ?? QUIET_LABEL)
        : null;

  return (
    <div className="w6w-history-timeline" role="img" aria-label={ariaLabel ?? `${n}-day history`}>
      <div className="w6w-history-plot">
        <div className="w6w-history-lane w6w-history-lane-execution">
          {days.map((entry, i) => (
            <span
              // Days are expected to be unique, but the index keeps the key
              // stable even if a caller repeats one — same guard `UptimeStrip` uses.
              key={`${entry.day}-${i}`}
              className={`w6w-history-cell w6w-history-cell-${entry.state}`}
              style={{ left: `${i * cellWidthPct}%`, width: `${cellWidthPct}%` }}
              title={entry.label ?? `${entry.day} — ${STATE_LABELS[entry.state]}`}
            />
          ))}
        </div>
        <div className="w6w-history-lane w6w-history-lane-vendor">
          {emptyLabel !== null ? (
            <span className="w6w-history-empty" title={emptyLabel}>
              {emptyLabel}
            </span>
          ) : (
            incidents?.map((bar, i) => {
              const placement = placeIncidentBar(win, bar, nowMs);
              if (placement === null) return null;
              const clipClass = [
                placement.clippedStart ? "w6w-history-bar-clip-start" : "",
                placement.clippedEnd ? "w6w-history-bar-clip-end" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <span
                  key={bar.id ?? `${bar.title}-${i}`}
                  className={`w6w-history-bar w6w-history-bar-${bar.state}${clipClass ? ` ${clipClass}` : ""}`}
                  style={{ left: `${placement.leftPct}%`, width: `${placement.widthPct}%` }}
                  title={barTitle(bar)}
                />
              );
            })
          )}
        </div>
        <div className="w6w-history-axis">
          <span className="w6w-history-tick w6w-history-tick-start" style={{ left: "0%" }}>
            {win.from}
          </span>
          <span className="w6w-history-tick w6w-history-tick-end" style={{ left: "100%" }}>
            {win.to}
          </span>
        </div>
      </div>
    </div>
  );
}
