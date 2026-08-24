/**
 * Pure category-derivation + label logic for `AppPicker`'s opt-in category
 * filter (T1.1.1). No React import — usable from a plain unit test and from
 * the real-browser `test/picker-layout` gate's bundle alike.
 *
 * Two things are MIRRORED, not imported (`ui` sits upstream of both `studio`
 * and `frontend` in the package dependency graph, so neither is reachable):
 *
 *   - filter LOGIC — `packages/studio/src/pages/AppsPage.tsx:110-197`:
 *     `selectedCats: string[]`, empty array means "all", OR-across-selected
 *     membership (an app matches if it carries ANY selected slug).
 *   - label ALGORITHM — `packages/frontend/packages/web/src/lib/categories.ts:65-74`:
 *     split on `[-_\s]+`, capitalize each word, join with spaces.
 *
 * D-4 (project DECISIONS.md): no 31-slug transcription of `rfcs/categories.md`.
 * Only the handful of acronyms/irregulars the mechanical algorithm gets wrong
 * carry an explicit override; every other slug — including one the RFC's own
 * vocabulary doesn't list, e.g. the live `sales` value — falls through to the
 * algorithm and renders as a readable (if unofficial) label, never a throw.
 */
import type { AppSummary } from "./types.ts";

/**
 * Slugs where hyphen/underscore-split + per-word title-case produces the
 * wrong reading (an acronym, or a mid-word capital). Exactly the five the
 * live catalog needs (`building-blocks.md` §3) — not a transcription of the
 * RFC's full label table.
 */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  ai: "AI",
  cms: "CMS",
  crm: "CRM",
  hr: "HR",
  devops: "DevOps",
};

/**
 * Display label for a category slug. A known override wins; otherwise the
 * slug is split on `-`/`_`/whitespace and each word is capitalized. Never
 * throws — an empty/non-string slug renders as `""`, and any out-of-
 * vocabulary slug still gets a readable (title-cased) label.
 *
 * @example
 * categoryLabel("crm");                // "CRM"            (override)
 * categoryLabel("project-management"); // "Project Management"
 * categoryLabel("sales");              // "Sales"           (out-of-vocabulary, still safe)
 */
export function categoryLabel(slug: string): string {
  if (typeof slug !== "string" || slug.trim() === "") return "";
  const known = LABEL_OVERRIDES[slug];
  if (known) return known;
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** One category chip's derived data — a slug, its display label, and how
 * many of the supplied apps carry it. */
export interface CategoryChip {
  slug: string;
  label: string;
  count: number;
}

/**
 * Distinct category slugs present across `apps`, each with its app count.
 * Ordered by count DESCENDING; ties break on the derived LABEL, ascending
 * (a deterministic order — never insertion/slug order, which would vary with
 * the catalog's own listing order).
 *
 * Derive from the caller's already-visible catalog (post any `filter` prop),
 * never from the full RFC vocabulary — a category with nothing behind it in
 * the current list is a dead end (D-1a).
 */
export function deriveCategories(apps: readonly AppSummary[]): CategoryChip[] {
  const counts = new Map<string, number>();
  for (const app of apps) {
    for (const slug of app.categories ?? []) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: categoryLabel(slug), count }))
    .sort(
      (a, b) =>
        b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
}

/**
 * Whether `app` matches a set of selected category slugs. An EMPTY selection
 * means "all" (every app matches); a non-empty selection is OR-across-
 * selected — the app matches if it carries ANY of the selected slugs. Mirrors
 * `AppsPage.tsx`'s `cats.size === 0 ? … : appCats.some((c) => cats.has(c))`.
 */
export function matchesCategories(app: AppSummary, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const cats = app.categories ?? [];
  return selected.some((slug) => cats.includes(slug));
}
