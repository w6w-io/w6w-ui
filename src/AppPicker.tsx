import { type ReactNode, useEffect, useState } from "react";
import { deriveCategories, matchesCategories } from "./app-categories.ts";
import { AppIcon } from "./components/AppIcon.tsx";
import { isInternalApp } from "./flow-types.ts";
import { useW6WApi } from "./provider.tsx";
import type { AppSummary, ThemeMode } from "./types.ts";

/**
 * Category-filter chip row collapse budget (D-1a: "collapsed to a fixed
 * count budget with a `+N more` toggle", "≈2 rows"). An implementation
 * constant, not part of the public API.
 */
const CHIP_VISIBLE_BUDGET = 8;

export interface AppPickerProps {
  /** Fired when the user picks an app card. */
  onSelectApp: (app: AppSummary) => void;
  theme?: ThemeMode;
  /** Optional pre-filter over the app list (e.g. only connectable apps). */
  filter?: (app: AppSummary) => boolean;
  /** Search-box placeholder. Defaults to "Search apps…". */
  searchPlaceholder?: string;
  /** Message shown when the (filtered) app list is empty. */
  emptyMessage?: string;
  /** Render the search input. Defaults to `true`; the connected-apps list opts out. */
  search?: boolean;
  /** Rendered beneath `emptyMessage` in the empty state (e.g. a "Browse all apps" button). */
  emptyAction?: ReactNode;
  /**
   * Supply the catalog instead of letting the picker fetch it. For a caller
   * that already holds the list — and, more to the point, that decides
   * membership from fields this package's {@link AppSummary} does not carry
   * (`supportsOAuth`, `owner`): passing the decided list keeps ONE list and one
   * loading/error state, where `filter` would mean a second `listApps()` whose
   * result can disagree with the caller's. `null` is "still loading" and
   * renders the same placeholder the internal fetch does.
   */
  apps?: AppSummary[] | null;
  /**
   * Render an opt-in category-filter chip row, derived from the VISIBLE
   * catalog's own `categories` values (never the full RFC vocabulary — see
   * `app-categories.ts`). Defaults to `false`. Only {@link AddConnectionModal}
   * turns this on today — both `StepBuilderModal` picker call sites already
   * narrow their catalog through `filter`, so a second filter layer there
   * would be redundant.
   */
  categoryFilter?: boolean;
}

/**
 * Searchable grid of app cards (icon + name + id) — the shared app picker used
 * by both the step builder and the add-connection modal. Fetches the app list
 * from `useW6WApi()` unless the caller passes `apps`; filters alphabetically by
 * name/id as the user types.
 */
export function AppPicker({
  onSelectApp,
  theme,
  filter,
  searchPlaceholder,
  emptyMessage,
  search = true,
  emptyAction,
  apps: providedApps,
  categoryFilter = false,
}: AppPickerProps) {
  const api = useW6WApi();
  const [fetchedApps, setFetchedApps] = useState<AppSummary[] | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [catsExpanded, setCatsExpanded] = useState(false);
  // `undefined` means "not supplied" — a supplied `null` is a caller whose own
  // fetch has not resolved yet, which must NOT start a second one.
  const supplied = providedApps !== undefined;

  useEffect(() => {
    if (supplied) return;
    let canceled = false;
    api
      .listApps()
      .then((r) => !canceled && setFetchedApps(r))
      .catch((e) => !canceled && setAppsError((e as Error).message));
    return () => {
      canceled = true;
    };
  }, [api, supplied]);

  const apps = supplied ? (providedApps ?? null) : fetchedApps;

  // Single layout owner for all four exits below, so the panel never resizes
  // between error/loading/empty and the loaded list — see `.w6w-apppicker-host`.
  const host = (body: ReactNode) => <div className="w6w-apppicker-host">{body}</div>;

  if (appsError) return host(<div className="w6w-result w6w-error">{appsError}</div>);
  if (apps === null) return host(<p className="w6w-muted w6w-small">Loading apps…</p>);

  // Reserved `@w6w/*` pseudo-apps are added via the builder's "Controls" tab, not
  // as connectable apps — keep them out of this grid even after they register.
  const connectable = apps.filter((a) => !isInternalApp(a.id));
  const base = filter ? connectable.filter(filter) : connectable;
  if (base.length === 0) {
    return host(
      <div className="w6w-stack">
        <p className="w6w-muted w6w-small">
          {emptyMessage ?? "No apps registered yet. Register one from the Apps page first."}
        </p>
        {emptyAction}
      </div>,
    );
  }

  // Category chips (opt-in — P4/P6): derived from `base`, the VISIBLE
  // catalog post the `filter` prop and pre-search, never from the raw `apps`
  // fetch and never from the RFC's full slug vocabulary — a category with no
  // apps behind it here is a dead end. Chips over the collapse budget stay
  // hidden unless already selected (P5), so toggling a selection never makes
  // its own chip disappear.
  const chips = categoryFilter ? deriveCategories(base) : [];
  const withinBudget = chips.slice(0, CHIP_VISIBLE_BUDGET);
  const pinnedOverflow = chips
    .slice(CHIP_VISIBLE_BUDGET)
    .filter((c) => selectedCats.includes(c.slug));
  const collapsedChips = [...withinBudget, ...pinnedOverflow];
  const hiddenChipCount = chips.length - collapsedChips.length;
  const displayedChips = catsExpanded ? chips : collapsedChips;
  const toggleCat = (slug: string) =>
    setSelectedCats((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  const clearCats = () => setSelectedCats([]);

  // Composition order (P4): the `filter` prop already ran (-> `base`); the
  // category-chip selection composes next; the search query runs last.
  const catFiltered =
    categoryFilter && selectedCats.length > 0
      ? base.filter((a) => matchesCategories(a, selectedCats))
      : base;

  // Alphabetical by display name, then filtered by the search box (name or id).
  const q = query.trim().toLowerCase();
  const sorted = [...catFiltered].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
  const visible = q
    ? sorted.filter(
        (a) => a.displayName.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
      )
    : sorted;
  // A7: a category selection narrowed the list to nothing, distinct from the
  // search-only empty state below (and distinct from either alone: the
  // message names whichever of the two is actually active).
  const categoryEmpty = categoryFilter && selectedCats.length > 0 && visible.length === 0;

  return host(
    <div className="w6w-stepbuilder-apps">
      {search && (
        <input
          type="text"
          className="w6w-stepbuilder-search"
          placeholder={searchPlaceholder ?? "Search apps…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search apps"
        />
      )}
      {categoryFilter && chips.length > 0 && (
        <div className="w6w-apppicker-cats">
          {displayedChips.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="w6w-apppicker-chip"
              aria-pressed={selectedCats.includes(c.slug)}
              aria-label={`Filter by ${c.label}`}
              onClick={() => toggleCat(c.slug)}
            >
              {c.label} <span className="w6w-muted">({c.count})</span>
            </button>
          ))}
          {!catsExpanded && hiddenChipCount > 0 && (
            <button
              type="button"
              className="w6w-btn w6w-btn-ghost w6w-btn-sm"
              onClick={() => setCatsExpanded(true)}
            >
              +{hiddenChipCount} more
            </button>
          )}
          {catsExpanded && chips.length > CHIP_VISIBLE_BUDGET && (
            <button
              type="button"
              className="w6w-btn w6w-btn-ghost w6w-btn-sm"
              onClick={() => setCatsExpanded(false)}
            >
              Show less
            </button>
          )}
          {selectedCats.length > 0 && (
            <button type="button" className="w6w-btn w6w-btn-ghost w6w-btn-sm" onClick={clearCats}>
              Clear
            </button>
          )}
        </div>
      )}
      {visible.length === 0 ? (
        categoryEmpty ? (
          <div className="w6w-stack">
            <p className="w6w-muted w6w-small">
              {q
                ? `No apps match “${query}” in the selected categories.`
                : "No apps match the selected categories."}
            </p>
            <button
              type="button"
              className="w6w-btn w6w-btn-ghost w6w-btn-sm"
              onClick={() => {
                setSelectedCats([]);
                setQuery("");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <p className="w6w-muted w6w-small">No apps match “{query}”.</p>
        )
      ) : (
        <div className="w6w-stepbuilder-list w6w-apppicker-grid w6w-stepbuilder-scroll">
          {visible.map((a) => (
            <button
              key={a.id}
              type="button"
              className="w6w-stepbuilder-item w6w-apppicker-card"
              onClick={() => onSelectApp(a)}
            >
              <AppIcon
                src={a.iconSvg}
                srcDark={a.iconSvgDark}
                brandColor={a.brandColor}
                name={a.displayName}
                theme={theme}
                size={24}
              />
              <span className="w6w-stepbuilder-item-main">
                <strong>{a.displayName}</strong>
                <code className="w6w-muted w6w-small">{a.id}</code>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>,
  );
}
