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

/** Branching line — a bound git repository. Copied path data from
 *  `studio/src/components/Layout.tsx`'s `RepositoryIcon` — `@w6w/ui` has no
 *  shared `Icon` component, so each component colocates its own glyph
 *  (`studio/src/components/SyncButton.tsx:3-5`). */
function RepositoryGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0ZM4 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0ZM14 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0ZM5.25 7h1.5v8h-1.5ZM7.64 8.36L14.64 15.36L13.36 16.64L6.36 9.64Z" />
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
        onClick={() => setOpen((v) => !v)}
      >
        <RepositoryGlyph />
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
