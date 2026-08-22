// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/__tests__/app-categories.test.ts
//
// T1.1.1's A6 coverage for `../app-categories.ts` — the AppPicker category
// filter's pure logic (no React, so no JSDOM rig is needed here). Each case
// below is named for the mutant it discriminates, per the contract's G5.
import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryLabel, deriveCategories, matchesCategories } from "../app-categories.ts";
import type { AppSummary } from "../types.ts";

const app = (id: string, categories?: string[]): AppSummary => ({
  id,
  displayName: id,
  categories,
});

// ── categoryLabel — the five live overrides (P8) ────────────────────────────
test("categoryLabel: the five overrides the mechanical algorithm gets wrong", () => {
  assert.equal(categoryLabel("ai"), "AI");
  assert.equal(categoryLabel("cms"), "CMS");
  assert.equal(categoryLabel("crm"), "CRM");
  assert.equal(categoryLabel("hr"), "HR");
  assert.equal(categoryLabel("devops"), "DevOps");
});

// A `categoryLabel` mutant that just returns the raw slug would pass the
// override cases above IF the overrides matched the slug verbatim (they
// don't — "ai" -> "AI" already differs), but this pins the algorithmic path
// too, independently.
test("categoryLabel: hyphen forms split and title-case, no override needed", () => {
  assert.equal(categoryLabel("project-management"), "Project Management");
  assert.equal(categoryLabel("social-media"), "Social Media");
  assert.equal(categoryLabel("version-control"), "Version Control");
  assert.equal(categoryLabel("data-warehousing"), "Data Warehousing");
});

// The live catalog's one out-of-vocabulary slug (`gap-analysis.md` §1) — must
// fall through to the algorithm, not throw, not disappear.
test("categoryLabel: an out-of-vocabulary slug still renders a safe label", () => {
  assert.equal(categoryLabel("sales"), "Sales");
});

test("categoryLabel: empty/whitespace/non-string input never throws", () => {
  assert.equal(categoryLabel(""), "");
  assert.equal(categoryLabel("   "), "");
  // @ts-expect-error — exercising the runtime guard against a non-string caller.
  assert.equal(categoryLabel(null), "");
});

// ── deriveCategories ─────────────────────────────────────────────────────────
test("deriveCategories: an app with missing/empty categories contributes no slug and does not throw", () => {
  const apps = [app("a", undefined), app("b", []), app("c", ["crm"])];
  const chips = deriveCategories(apps);
  assert.deepEqual(
    chips.map((c) => c.slug),
    ["crm"],
  );
  assert.equal(chips[0].count, 1);
});

// Order is count-descending; a same-count tie breaks on the derived LABEL,
// ascending — never insertion order, never raw-slug order. This discriminates
// a derivation sorted by name-only (would put "ai" before "crm" regardless of
// count) as well as one sorted by insertion (undiscriminating tie-break).
test("deriveCategories: count-descending order, deterministic label tie-break", () => {
  const apps = [
    app("a1", ["crm"]),
    app("a2", ["crm"]),
    app("a3", ["crm"]),
    app("a4", ["ai"]),
    app("a5", ["ai"]),
    app("a6", ["hr"]),
    app("a7", ["hr"]),
  ];
  const chips = deriveCategories(apps);
  // crm (3) first; ai/hr tie at 2 — "AI" < "HR" alphabetically, so ai next.
  assert.deepEqual(
    chips.map((c) => c.slug),
    ["crm", "ai", "hr"],
  );
  assert.deepEqual(
    chips.map((c) => c.count),
    [3, 2, 2],
  );
  assert.deepEqual(
    chips.map((c) => c.label),
    ["CRM", "AI", "HR"],
  );
});

// An app carrying two slugs contributes to BOTH chips' counts.
test("deriveCategories: an app carrying two slugs is counted under each", () => {
  const apps = [app("a", ["ai", "crm"]), app("b", ["crm"])];
  const chips = deriveCategories(apps);
  const bySlug = Object.fromEntries(chips.map((c) => [c.slug, c.count]));
  assert.deepEqual(bySlug, { ai: 1, crm: 2 });
});

// ── matchesCategories ────────────────────────────────────────────────────────
// A predicate that defaults to non-empty (e.g. treats [] as "match nothing")
// would fail this — empty selection must mean "all apps match".
test("matchesCategories: an empty selection matches every app", () => {
  assert.equal(matchesCategories(app("a", ["crm"]), []), true);
  assert.equal(matchesCategories(app("b", undefined), []), true);
});

// OR, not AND: a single-selected-slug match is membership; this pins the OR
// shape specifically, across two selected slugs.
test("matchesCategories: OR semantics across two selected slugs", () => {
  const selected = ["ai", "hr"];
  assert.equal(matchesCategories(app("a", ["ai"]), selected), true);
  assert.equal(matchesCategories(app("b", ["hr"]), selected), true);
  assert.equal(matchesCategories(app("c", ["crm"]), selected), false);
});

// An AND-shaped mutant (every selected slug must be present) would fail this:
// the app carries only ONE of the two selected slugs and must still match.
test("matchesCategories: an app carrying two slugs matches on either selected one", () => {
  const app1 = app("a", ["ai", "crm"]);
  assert.equal(matchesCategories(app1, ["ai"]), true);
  assert.equal(matchesCategories(app1, ["crm"]), true);
  assert.equal(matchesCategories(app1, ["hr"]), false);
  assert.equal(matchesCategories(app1, ["hr", "crm"]), true);
});
