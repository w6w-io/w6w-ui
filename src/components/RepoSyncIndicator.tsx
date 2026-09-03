import { useEffect, useRef, useState } from "react";

export interface RepoSyncIndicatorProps {
  /** Branch name, e.g. "main". */
  branch: string;
  /** Already-shortened commit sha (the consumer formats it — D-6). `null` renders no sha. */
  shortSha: string | null;
  /** Already-formatted last-sync text, e.g. "3/9/2026, 12:16:29 PM" or "Never synced".
   *  `null` renders no time row. */
  lastSyncLabel: string | null;
  /** Fired when the flyout's "Sync now" item is activated. The consumer owns the mutation. */
  onSyncNow: () => void;
  /** True while the consumer's sync is in flight. */
  syncing?: boolean;
  className?: string;
  "data-testid"?: string;
}

/** The GitHub mark — the connection provider's icon (`RepoBinding.provider` is
 *  always `"github"` today). Copied path data from
 *  `studio/src/components/Layout.tsx:38-40`'s `GitHubLink` — `@w6w/ui` has no
 *  shared `Icon` component, so each component colocates its own glyph
 *  (`studio/src/components/SyncButton.tsx:3-5`). */
function GitHubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.04 1.78 2.72 1.26 3.38.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.15v3.18c0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

/** The in-flight sync badge overlaid on `GitHubGlyph` while `syncing` is true.
 *  Path data copied verbatim from `studio/src/components/SyncButton.tsx`'s
 *  `RefreshGlyph` (a stroke-based Feather `refresh-cw` icon); only
 *  `width`/`height` shrink to 10x10 for this corner-badge use. */
function SyncSpinGlyph() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w6w-repo-sync-spin"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

/**
 * A compact header control showing a repo glyph, a branch name and a short
 * commit sha, with an inline flyout menu carrying the sync detail and a
 * "Sync now" action the consumer wires.
 *
 * `@w6w/ui` never fetches and holds no studio policy
 * (`studio/src/ui/ExpressionScope.tsx:40-41`, extended by D-6) — this
 * component takes already-formatted strings and a callback.
 *
 * The open/close + outside-click + Escape state machine mirrors
 * `studio/src/components/Layout.tsx:222-328`'s `ProjectMenu()` (D-3: no
 * shared Menu/Popover/Dropdown primitive — there is exactly one consumer).
 */
export function RepoSyncIndicator(props: RepoSyncIndicatorProps) {
  const { branch, shortSha, lastSyncLabel, onSyncNow, syncing, className, ...rest } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={`w6w-repo-sync${className ? ` ${className}` : ""}`}
      ref={ref}
      data-testid={rest["data-testid"]}
    >
      <button
        type="button"
        className="w6w-repo-sync-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={syncing}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w6w-repo-sync-icon">
          <GitHubGlyph />
          {syncing && <SyncSpinGlyph />}
        </span>
        <span className="w6w-repo-sync-branch">{branch}</span>
        {shortSha != null && <code className="w6w-repo-sync-sha">{shortSha}</code>}
      </button>
      {open && (
        <div className="w6w-repo-sync-menu" role="menu">
          <div className="w6w-repo-sync-detail">
            <span>{branch}</span>
            {shortSha != null && <code>{shortSha}</code>}
            {lastSyncLabel != null && <span>{lastSyncLabel}</span>}
          </div>
          <button
            type="button"
            role="menuitem"
            className="w6w-repo-sync-item"
            data-testid="repo-sync-now"
            disabled={syncing}
            onClick={onSyncNow}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      )}
    </div>
  );
}
