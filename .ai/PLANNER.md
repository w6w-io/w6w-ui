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
   Both roots are real and both matter: `src/__tests__/*.test.ts` (**26** files, measured on
   `proj/26-08-29-02-workflow-issues-T1.1.1` — up from 24 at `f846edc` via `StepBuilderModal.connection-only.test.ts`
   (25, this branch's own fork point `main` @ `6a145c3`, an unrelated merged project,
   `26-08-29-00-repository-tab`) then this project's own new `ExpressionEditorModal.documents.test.ts`
   (26)) and `src/components/__tests__/*.test.ts` (9 files, unchanged: `Copyable`, `CopyableText`,
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
| lint | `./node_modules/.bin/biome check .` | `Checked 95 files in 33ms. No fixes applied.` — 0 errors, measured on `proj/26-08-29-02-workflow-issues-T1.1.1` (was 93 files at `f846edc`; 94 at this branch's fork point `main` @ `6a145c3` via `StepBuilderModal.connection-only.test.ts`, an unrelated merged project; +1 from this project's own `ExpressionEditorModal.documents.test.ts`) |
| typecheck | `./node_modules/.bin/tsc -b --noEmit` | exit 0, no output |
| unit suite | `node --import ./src/test-jsx-loader.mjs --test src/__tests__/*.test.ts src/components/__tests__/*.test.ts` | **356 pass, 0 fail** (TAP: `tests 356 · pass 356 · fail 0`), measured on `proj/26-08-29-02-workflow-issues-T1.1.1` (was **348** at this branch's fork point `main` @ `6a145c3` — itself up from `340` at `f846edc` via `StepBuilderModal.connection-only.test.ts`'s own new tests, an unrelated merged project). This project added the remaining **8**: 6 in the new `ExpressionEditorModal.documents.test.ts` and 2 new `renderResult` cases in `expression-template.test.ts`. |
| `check:css` | `node scripts/build-css.mjs --check` | both `src/styles.css` and `src/code.css` up to date |
| picker-layout (Docker/Chromium) | `bash test/picker-layout/run.sh` | **GREEN 22/22** (matching `EXPECTED_TESTS` in fact 4 above), confirmed by `26-08-26-01-studio-fixes`'s T1.1.3 gates — not re-run again at closeout since the merge introduced no further picker-layout-touching change beyond what T1.1.3 already gated |
| copyable (Docker/Chromium) | `bash test/copyable/run.sh` | **GREEN 9/9**, confirmed by the same T1.1.3 gates (`.ai/projects/.work/26-08-26-01-studio-fixes/results/T1.1.3.result.md`) — not re-run again at closeout for the same reason |

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

**Also worth knowing for future work here**: this project found a harness-tooling gap, not a
`packages/ui` code gap — `workspace-up.sh`'s sibling-closure detection (in
`.orchestration/projects/_templates/tools/`) only reads `../`-pattern deps in `package.json`/
`deno.json`, and misses `packages/ui/pnpm-workspace.yaml`'s `overrides: '@w6w/expr':
'link:../core/packages/expr'` — so a harness workspace built with `repos: [ui]` silently gets no
`core` sibling symlink, and every gate in that lane reads a large false-red (227/216/11 tests, 5 tsc
errors) that has nothing to do with whatever the task actually changed. Not a `packages/ui` defect —
recorded here because the next planner scoping a `ui`-only harness project needs to know to check
for `.worktrees/<project-id>/core` before trusting a red gate in that lane.

**T1.1.1 round 2** (same branch, same fork point) corrected a pre-existing drift the round-1 pass
didn't touch: *Where work happens* read `21` smaller components under `src/components/`, already
wrong at this file's own `verified:` commit (`f846edc`) — `22` there and `22` at this branch's own
HEAD (`find src/components -maxdepth 1 -type f ! -name '*.stories.tsx' | wc -l`, excluding the
`__tests__` subdirectory `git ls-tree` also lists). Corrected to `22`. It also rewrote the stale
`ExpressionEditorModal.tsx:106-107` comment claiming a render part can only ever be authored by
toggling an existing `var` chip — round 1's own D-P1 feature (the insert-as-render action) inserts
one directly, so the comment now describes both authoring paths. No behavior change; no gate figure
moved.
