# PLANNER.md — read this first when planning work in `w6w-ui`

> Every claim below carries a citation — a `file:line`, or a command plus its output — and this
> file carries its own `verified:` date. Where this doc and the code disagree, **the code wins** —
> and fixing the doc is part of the work, not a favour. See *Maintenance* at the bottom: this file
> is only worth reading if it is true, and the facts it records have already drifted once between
> the intake that first wrote them down and this file's own pickup commit (facts 1 and 3 below).

## Where work happens

Almost every change lands in `src/`, which splits three ways: **14** top-level `.tsx` files (large,
often multi-export modules — e.g. `AppPicker.tsx`, and `StepBuilderModal.tsx`, which bundles
`NodeList`, `CallableList`, `CallableRow` and `ReadyToUseFlow` as sibling functions in one file; see
fact 1), **22** smaller components under `src/components/`, and **28** SCSS partials under
`src/styles/` that compile into the two committed `.css` bundles (fact 2). `scripts/` holds two
small Node-only build/lint tools, each documented by its own header docstring — read the docstring
before the script body (`scripts/build-css.mjs:1-21`, `scripts/lint-tokens.mjs:1-29`). `test/` holds
four real-browser Docker/Chromium suites (`test/picker-layout`, `test/expr-template`,
`test/action-test-form`, `test/copyable`), each its own `pnpm test:*` script — distinct from the
Node-native unit suite under `src/__tests__/` + `src/components/__tests__/` (fact 3). `docs/` is
small and authoritative for two specific surfaces — see the routing table below.

## Which doc to read

| your task touches… | read |
|---|---|
| the spacing/type token scale, which `--w6w-*` custom property to reach for | [`docs/design-system.md`](../docs/design-system.md) |
| light/dark mode, how a host embedding `@w6w/ui` controls the theme | [`docs/theming.md`](../docs/theming.md) |
| the public component API, install/usage patterns | [`README.md`](../README.md) |
| gate commands, the token-lint ratchet, the picker-layout Chromium suite | the *Gate baselines* section below — `packages/ui` is not big enough for a separate testing doc |

## The five things that bite people who skip this

1. **The shared-class trap.** `.w6w-stepbuilder-item` / `-list` / `-search` are consumed by four
   components and asserted on by one real-browser suite — treat them as **additive-only**.
   Consumers, re-verified at this file's pickup commit: `AppPicker.tsx:160` (`-search`), `:229`
   (`-list`), `:234`/`:245` (`-item`/`-item-main`); `StepBuilderModal.tsx`'s `NodeList` (function at
   `:577`, uses `-list`/`-item` at `:585`/`:590`), `CallableList` (`:861`, `-search`/`-list` at
   `:911`/`:922`), `CallableRow` (`:1567`, `-item`/`--callable` at `:1580`), `ReadyToUseFlow`
   (`:1621`, `-list` at `:1651`). **The single-digit assertion-site count this fact once carried
   does not reproduce** in `test/picker-layout/picker-layout-guards.test.cjs` — recount rather than
   repeat it. Two real counts, both re-measured here, that mean different things:
   - `/usr/bin/grep -cE 'w6w-stepbuilder-(item|list|search)' test/picker-layout/picker-layout-guards.test.cjs`
     → **25** — every raw occurrence of the three class-name strings, including indirect
     `rect()`/`querySelector` helper calls.
   - `/usr/bin/grep -nE 'assert\.(ok|equal)' test/picker-layout/picker-layout-guards.test.cjs | /usr/bin/grep -E 'w6w-stepbuilder-(item|list|search)'`
     → **5** direct `assert.ok`/`assert.equal` calls whose own message string names one of the
     three classes (lines `191`, `239`, `309`, `425`, `980`).

   Neither is "nine." State which count you mean when you cite this trap.

2. **`src/styles.css` (and `src/code.css`) are COMMITTED BUILD OUTPUT, not source.** Authored source
   is `src/styles.scss` + `src/styles/_*.scss`; `scripts/build-css.mjs:1-21`'s own header states the
   rationale verbatim: studio consumes this package as a live `link:../ui` source link with no Sass
   toolchain of its own, so a gitignored artifact would leave a clean checkout with no stylesheet at
   all, and committing keeps every consumer working. `package.json:45-46` wires this in as
   `"build:css": "node scripts/build-css.mjs"` and `"check:css": "node scripts/build-css.mjs
   --check"`. Edit the partial, run `build:css`, commit both files — never hand-merge the generated
   `.css` on a conflict; regenerate instead (`build-css.mjs` is deterministic).

3. **`pnpm test` is a TWO-root glob, not a flat one.** `package.json:48`:
   ```
   "test": "node --import ./src/test-jsx-loader.mjs --test src/__tests__/*.test.ts src/components/__tests__/*.test.ts"
   ```
   Both roots are real and both matter: `src/__tests__/*.test.ts` (**31** files, measured on
   `proj/26-08-31-00-issues` post-merge — this doc's `29` had already drifted; this project's own
   T1.1.1 extended the existing `step-preview-state.test.ts` with `output`-projection cases (no new
   file), T1.1.2 added `ExpressionEditorModal.rail.test.ts` (30), T1.1.3 added
   `JsonEditor.copy.test.ts` (31) — see the *Gate baselines* section's closing paragraph) and
   `src/components/__tests__/*.test.ts` (9 files, unchanged: `Copyable`, `CopyableText`,
   `DeleteButton`, `EditButton`, `HistoryTimeline`, `IconButton`, `UptimeStrip`, `expression-dom`,
   `expression-template`).
   The trap survives the fix that added the second root: a `.test.ts` file placed in a **third**
   location, or named `.test.tsx`, silently never runs — the loader (`src/test-jsx-loader.mjs:16-20`)
   transpiles `.tsx` on import, but the `--test` arguments above are `.test.ts` globs only, so a
   `.tsx`-named test file is never even discovered.

4. **`test/picker-layout/` is a real-Chromium gate with a pinned test count.**
   `test/picker-layout/run.sh:64`: `EXPECTED_TESTS="${EXPECTED_TESTS:-22}"`; `:161-163` is the
   `DID NOT RUN` (exit 3) branch on a mismatch between that constant and the TAP-reported test
   total — so adding a `test()` to `picker-layout-guards.test.cjs` without bumping the constant
   silently voids the gate rather than reporting a false pass. Recounted at this file's pickup
   commit: `grep -cE '^\s*test\(' test/picker-layout/picker-layout-guards.test.cjs` → exactly **22**,
   still matching the default.

5. **Gate commands that work here, and a caveat that is conditional, not absolute.**
   `./node_modules/.bin/tsc -b --noEmit` and `./node_modules/.bin/biome check .` both run clean from
   an already-installed checkout (see *Gate baselines* below) — these are the same two commands
   `package.json:47`'s `typecheck` and `package.json:55`'s `lint` scripts wrap. Root `CLAUDE.md:150-153` documents
   that the `pnpm typecheck` / `pnpm lint` wrappers "run a dep-status install check first and can
   hard-fail on ignored build scripts (esbuild/biome) even when the code is fine" — **this is a
   fresh-install condition**, not something that reproduces on every checkout: both `pnpm typecheck`
   and `pnpm lint` were re-run live in this already-installed lane while writing this file and both
   exited clean. It bites a freshly built harness workspace (`pnpm install` just ran, ignored build
   scripts not yet approved); it does not bite a checkout you have already been working in. If the
   wrapper hard-fails, fall back to the two direct binaries above.

## Gate baselines section

Measured live at this file's own pickup commit (see footer). **`.ai/projects/artifacts/studio-ui-gate-baselines.md`
is the reference for the `lint:tokens` two-sided-ratchet *mechanism* — its own numeric tables for
`packages/ui` have already drifted twice since it was written on 2026-08-18: its biome file count
is now different below (see the table), and its ratchet total first regressed to a red count one
higher than its own committed baseline, then was fixed down to the total this table records
below. Re-measure, don't copy.** For the `lint:tokens` exit-code semantics themselves (0/1/2/3), `scripts/lint-tokens.mjs:1-29`'s
own header docstring is the **primary** source — more current and more authoritative than the
artifact, which is useful only for the historical "why a bare violation count is an unsafe gate"
framing (its TRAP 2 section).

| gate | command | result |
|---|---|---|
| token-lint ratchet | `node scripts/lint-tokens.mjs` | `lint:tokens — 59 violations in 18 files (baseline: 59)`, **exit 0** |
| lint | `./node_modules/.bin/biome check .` | `Checked 101 files in ~40ms. No fixes applied.` — 0 errors, measured on `proj/26-08-31-00-issues` post-merge (this doc's stale `98` was already correct at this project's own base, `main` @ `2486441`, independently re-verified by the planner rather than copied — see `.ai/projects/.work/26-08-31-00-issues/FOLLOWUPS.md` F-N4; T1.1.2 added `ExpressionEditorModal.rail.test.ts` → 99; T1.1.3 added `components/use-copy.ts` and `JsonEditor.copy.test.ts` → 101) |
| typecheck | `./node_modules/.bin/tsc -b --noEmit` | exit 0, no output |
| unit suite | `node --import ./src/test-jsx-loader.mjs --test src/__tests__/*.test.ts src/components/__tests__/*.test.ts` | **398 pass, 0 fail** (TAP: `tests 398 · pass 398 · fail 0`), measured on `proj/26-08-31-00-issues` post-merge (this doc's stale `380` had already drifted to **383** at `main` @ `2486441`, this project's own base — independently re-verified by the planner, not copied from the contract; T1.1.1 extended `step-preview-state.test.ts` with `output`-projection cases; T1.1.2 added `ExpressionEditorModal.rail.test.ts`; T1.1.3 added `JsonEditor.copy.test.ts`, landing at **398**) |
| `check:css` | `node scripts/build-css.mjs --check` | both `src/styles.css` and `src/code.css` up to date |
| picker-layout (Docker/Chromium) | `bash test/picker-layout/run.sh` | **GREEN 22/22** (matching `EXPECTED_TESTS` in fact 4 above), confirmed by `26-08-26-01-studio-fixes`'s T1.1.3 gates — not re-run at `26-08-31-00-issues`'s closeout since none of its three nodes touched picker-layout-adjacent code |
| copyable (Docker/Chromium) | `bash test/copyable/run.sh` | **GREEN 9/9**, confirmed by `26-08-26-01-studio-fixes`'s T1.1.3 gates (`.ai/projects/.work/26-08-26-01-studio-fixes/results/T1.1.3.result.md`) — **not re-run at `26-08-31-00-issues`'s closeout**: that project's own T1.1.3 (`copyable` prop on `JsonEditor`) could not run it either, for the same reason recorded in `FOLLOWUPS.md` — it hard-requires a sibling `packages/studio` checkout the harness workspace does not symlink in. `Copyable.tsx` itself is provably unchanged (byte-identical `Copyable.test.ts`/`CopyableText.test.ts`, verified by both T1.1.2 and T1.1.3's evaluators), so this row is stale on file identity, not on behavior — re-run from a full checkout if that changes |
| expr-template (Docker/Chromium) | `bash test/expr-template/run.sh` | **GREEN 18/18**, re-run at `26-08-31-00-issues`'s closeout on the merged integration tip (`proj/26-08-31-00-issues` — T1.1.2 touched the Result pane's height/flex and the rail this suite's T-height/G-sigil/R4 cover). This gate was missing from this table entirely before this project (see `FOLLOWUPS.md` F-N4) despite fact 5's own text already naming it a real-Chromium suite alongside picker-layout |

The `lint:tokens` line above is **pinned** by this project's own T1.1.1: it dropped
`_step-builder.scss`'s violations from a red 4-vs-baseline-3 regression back to a clean, matching
baseline, which is what carries the whole-package total from the artifact's stale 62 down to 59. If
`node scripts/lint-tokens.mjs` prints anything else in your checkout, the ratchet has moved since
this file was last verified — re-measure and update this table rather than trust it.

## Maintenance — why this file has a shelf life

A standing doc nobody updates is worse than no doc: it is confidently wrong and it gets believed.
This project's own gap-analysis found exactly that had already started here — this file's own fact
1 (the shared-class trap's old assertion-site count) and fact 3 (the `pnpm test` glob shape) both
carried claims from an earlier intake that no longer reproduced, and
`studio-ui-gate-baselines.md`'s numeric tables had already drifted (see *Gate baselines* above) —
before this file even existed.

So:

- **Cite every claim** — a `file:line`, a command, or a measurement. This project's own contract
  fixed `file:line` as the citation form for `packages/ui` (a smaller, slower-moving package than
  `w6w-frontend`, where `frontend/.ai/PLANNER.md`'s own Maintenance section instead prefers text
  anchors because lines there rot fast). Whichever form you use, **re-verify at your own pickup
  commit** rather than trust a number carried forward — every citation in this file was re-run
  against its own pickup commit rather than copied from an earlier project's notes, which is exactly
  what caught fact 1 and fact 3's drift.
- **Delete a wrong claim, do not annotate it.** "This may be out of date" teaches nobody anything.
- **Updating this doc is part of project closeout, not optional** — a project that touches
  `packages/ui`'s shared classes, its test globs, its gate baselines, or its build/lint scripts
  should fold the correction in as part of its own work, not leave it for the next reader to
  rediscover.
- **This file describes the commit in its `verified:` line below — the tip at authoring time, not
  necessarily your branch point.** If your project branches from an older base, diff before you cite:
  `git diff <base>..<verified-sha> --stat` over `packages/ui` is one command and tells you exactly
  which of the facts above are ahead of you.

verified: 2026-08-28 · against `main` @ `f846edc` (project 26-08-07-01-ui-dblclick-test-receiver-pin closeout, post-merge)

**What this project changed here, at a glance** — this file did not exist before
`26-08-22-02-ui-planner-and-token-debt`; `packages/ui/.ai/` had zero prior art, and this task
(T1.1.2) is what created it, mirroring `packages/frontend/.ai/PLANNER.md`'s shape but inline (no
`context/` split — `packages/ui` is not big enough to warrant one). Its sibling task, T1.1.1,
dropped `_step-builder.scss`'s `lint:tokens` entry from a red 4-vs-baseline-3 regression to a clean
match, which is what the *Gate baselines* table above records as the whole-package `59 violations in
18 files (baseline: 59)` total — replacing the older, now twice-stale `62/19` figure that
`studio-ui-gate-baselines.md` still carries. `26-08-26-01-studio-fixes`'s T1.1.3 corrected fact 4
(the `test/picker-layout` `EXPECTED_TESTS` default and matching `test(` count, both `21`→`22`) and
re-verified — not changed — the unit-suite baseline as measured at its own pickup commit (`313`, not
the `316` an earlier pass through this file had assumed without re-measuring against the pickup
commit it named). **At `26-08-26-01-studio-fixes`'s own closeout** (merge to `main` @ `895e25d`), the unit suite,
biome file count, and both test-root file counts in fact 3 were re-measured again and bumped to their
current post-merge values (`335` pass, `92` biome files, `23`/`9` test files) — the `313`/`88`/`21`/`8`
figures above are history, kept only where a sentence explicitly compares against them.

**At `26-08-07-01-ui-dblclick-test-receiver-pin`'s closeout** (merge to `main` @ `f846edc`): this
project pinned the receiver in `WorkflowFlowEditor.dblclick-wiring.test.ts`'s add/remove-pair
assertion (a real listener-leak mutant — registering on `document`, cleaning up on `div` — used to
pass the suite undetected) and fixed two stale comments; it added 0 new tests and 0 new files. The
unit suite, biome file count and fact 3's `src/__tests__` count were re-measured and bumped again to
their current post-merge values (`340` pass, `93` biome files, `24`/`9` test files) — but that delta
is **not** this project's own: it is entirely `StepBuilderModal.autoconnect.test.ts`, added by a
different, unrelated project (`feat(stepbuilder): third connection state`) that merged to `main`
between this file's two verifications. `335`/`92`/`23` are now history.

**T1.1.1 of `26-08-29-02-workflow-issues`** (measured on its own task branch,
`proj/26-08-29-02-workflow-issues-T1.1.1`, forked from `main` @ `6a145c3` — not yet merged, so no
post-merge sha to cite here) widened `ExpressionOptions.documents` from `string[]` to
`ExpressionDocumentSource[]` (a document's top-level JSON fields, gated on `doc.format === "json"`
and a successful plain-object parse, mirroring `run-seed.ts`'s `documentsSeed`), added the matching
nested `w6w-exprmodal-subsources` rendering plus a second, visible "insert as render" action on each
field row (`data-testid="expr-insert-render"`), and extended `renderResult`/`usedRefs` to treat a
`render` part's ref the same way a `var` part's is treated for the design-time preview. It added one
new file (`ExpressionEditorModal.documents.test.ts`, 6 tests) and 2 new `renderResult` cases in the
existing `expression-template.test.ts`, bumping the unit suite from this branch's fork-point baseline
of `348` to `356` and the biome file count from `94` to `95` (fact 3's `src/__tests__` count moves
from `25` to `26` accordingly). `_expression-modal.scss` gained the new render-button styling entirely
in `--w6w-*` tokens (font-size, gap) plus box-geometry properties the ratchet does not scan
(width/height/border/border-radius, per this file's own *Gate baselines* note above) — the
`lint:tokens` whole-package total stays unchanged at `59 violations in 18 files (baseline: 59)`.

**T1.1.1 round 2** (same branch, same fork point) corrected a pre-existing drift the round-1 pass
didn't touch: *Where work happens* read `21` smaller components under `src/components/`, already
wrong at this file's own `verified:` commit (`f846edc`) — `22` there and `22` at this branch's own
HEAD (`find src/components -maxdepth 1 -type f ! -name '*.stories.tsx' | wc -l`, excluding the
`__tests__` subdirectory `git ls-tree` also lists). Corrected to `22`. It also rewrote the stale
`ExpressionEditorModal.tsx:106-107` comment claiming a render part can only ever be authored by
toggling an existing `var` chip — round 1's own D-P1 feature (the insert-as-render action) inserts
one directly, so the comment now describes both authoring paths. No behavior change; no gate figure
moved.

**`26-08-30-00-fixes`'s T1.1.1 and T1.1.2** (measured on `proj/26-08-30-00-fixes-T1.1.2`, forked
from `proj/26-08-30-00-fixes` at the merged T1.1.1 tip — not yet merged to `main`, so no post-merge
sha to cite here) found this doc's *Gate baselines* table and fact 3 had already drifted **before**
either task started: this project's own base, `f76edc7`, independently re-measured (`git archive
f76edc7` into a scratch checkout, both gates re-run there) rather than trusted from the contract,
was already `359` pass / `96` biome files / `27` `src/__tests__` files — not the `356`/`95`/`26`
this doc had recorded. T1.1.1 (the error-port edge lane derivation + `LANE_HINT` rewording) added
one new file, `WorkflowFlowEditor.error-port-wiring.test.ts`, plus cases in the existing
`flow-connect.test.ts`/`flow-utils.test.ts`, landing at `370` pass / `97` biome files / `28`
`src/__tests__` files. T1.1.2 (the step edit modal: one combined App+Connection field, the ports
checkbox hidden behind `SHOW_STEP_PORTS`, and on-error copy reworded to state retry-first/
continue-proceeds/error-edge-overrides per `rfcs/workflow.md`'s Amendment) added one new file,
`StepEditModal.setup-and-configure.test.ts` (10 tests), landing at the **`380`/`98`/`29`** this
doc's *Gate baselines* table and fact 3 now record. It also deleted this doc's stale claim that
`workspace-up.sh` misses `pnpm-workspace.yaml` in its sibling-closure `find` — re-checked directly
against `.orchestration/projects/_templates/tools/workspace-up.sh:70`, which already lists
`pnpm-workspace.yaml` alongside `deno.json`/`package.json`; this lane's own `core` sibling symlink
resolved correctly (`readlink -f node_modules/@w6w/expr` → a real path), so the claim no longer
reproduced and was removed rather than annotated, per this file's own Maintenance rule.

**`26-08-31-00-issues`'s three nodes** (measured on `proj/26-08-31-00-issues` post-merge, forked
from `main` @ `2486441` — not yet merged to `main`, so no post-merge sha to cite here) found this
doc's *Gate baselines* table had already drifted **before any task started**: `main` @ `2486441`
measured `383` pass / `98` biome files (this doc's stale `380`/`98` — the biome count was already
correct, only the unit-suite count had drifted), and the table had no `expr-template` row at all
despite fact 5 already naming it a real-Chromium suite alongside `picker-layout`. T1.1.1
(`InternalNodeDef.output` for `@w6w/template · render` and `@w6w/http · request`, projected by
`projectStepSources`) extended the existing `step-preview-state.test.ts` — no new file, no biome
count change. T1.1.2 (expr-editor rail reorder, `Inputs` gate, collapse-by-default, Result-pane
copy control) added `ExpressionEditorModal.rail.test.ts`. T1.1.3 (`copyable` prop on `JsonEditor`,
wired to the six step-JSON panes) added `components/use-copy.ts` and `JsonEditor.copy.test.ts`,
landing at the **`398`/`101`/`31` (`src/__tests__`)** this doc's table and fact 3 now record. The
`expr-template` suite was re-run at closeout (T1.1.2 touched the Result pane's height/flex the
suite's `T-height` gates) and added to the table as **GREEN 18/18**. `test/copyable/run.sh` stayed
un-re-run — it hard-requires a sibling `packages/studio` checkout the harness workspace does not
symlink in, the same gap T1.1.3's own contract hit and recorded in
`.ai/projects/.work/26-08-31-00-issues/FOLLOWUPS.md`; `Copyable.tsx` itself is proven byte-identical
by both T1.1.2 and T1.1.3's evaluators, so the row is stale on provenance only, not on behavior.
