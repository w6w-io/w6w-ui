#!/usr/bin/env bash
# Runner for ./picker-layout-guards.test.cjs — the AppPicker / AddConnectionModal /
# StepBuilderModal layout invariants (I1-I9) that no `node --test src/**/*.test.ts`
# can reach: jsdom performs no layout (getBoundingClientRect is all zeros, no
# flexbox, no min(70vh,520px) resolution), so a jsdom test would pass on a
# broken tree. This gate mounts the REAL components, compiled from source, in
# real Chromium.
#
#   pnpm test:picker-layout                    # from packages/ui
#   ENGINE=firefox pnpm test:picker-layout      # the same tests in another engine
#
# What it does: copies the source tree into a scratch dir, symlinks in the
# checkout's own node_modules (react/react-dom plus everything StepBuilderModal's
# import graph actually reaches — @codemirror/*, @uiw/react-codemirror — nothing
# is stubbed or fabricated, unlike studio's page-guards, because this gate mounts
# the real components with no @w6w/ui substitute to fake), bundles with esbuild,
# and runs the tests in a browser inside the Playwright image with a plain
# `<W6WUIProvider api={...}>` stub object (no network layer — see
# harness-entry.tsx). It writes ONLY inside its own mktemp -d and the container
# is --rm: no service, DB, catalog row or checkout is touched, so it is safe to
# re-run.
#
# Prerequisites (all local, no network):
#   - docker, and the image below (docker pull mcr.microsoft.com/playwright:v1.60.0-noble)
#   - packages/ui/node_modules, including its OWN declared devDependency
#     playwright-core@1.60.0 (`pnpm add -D playwright-core@1.60.0` from packages/ui)
#     — this runner resolves it from $PKG/node_modules only; it is never
#     scanned for under the caller's home directory, so a stray unrelated
#     checkout's copy can never make this gate "work by accident" the way it
#     can for an undeclared tool.
#
# Knobs: ENGINE, PW_CORE, PW_VERSION, PW_IMAGE, ESBUILD, EXPECTED_TESTS, and
# UI_SRC — point that at a copy of `src` to run the tests against a tree other
# than this checkout's (how the guards are mutation-tested without dirtying a
# shared working tree — see the project's Mutations section).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/../.." && pwd)"
SRC="${UI_SRC:-$PKG/src}"
ENGINE="${ENGINE:-chromium}"
PW_VERSION="${PW_VERSION:-1.60.0}"
PW_IMAGE="${PW_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-noble}"
# One top-level test() per invariant I1-I9 (I5's body also carries the
# cross-tab panel-width check folded in per the amendment, plus the host==
# content width check added for TA4's H2; I8's body carries TA4's H3/H4
# additions), plus F1 — the test-required note (AppStepConfig's Test tab)
# never moves the footer's Cancel/primary buttons, note-present vs
# note-absent, at two viewports. Plus M-xl — both real -xl dialogs
# (AddConnectionModal, StepBuilderModal) measure >= 1000px wide at VP.wide.
# Plus C1-C4 — the Functions/Workflows tabs (D-12/D-15): sidebar order/
# position, both tabs minting the SAME `@w6w/call` step shape via a REAL
# onAdd (not a discarding stub), and their absence under `appsOnly`.
# Plus (T1.1.1) I10-I13 — the multi-column card grid's geometry, its
# narrow-viewport collapse, and the opt-in category-filter chip row's
# interaction and bounded collapse, on the real components' real DOM.
# The verdict below is REFUSED unless exactly this many ran: a tree that
# fails to bundle, or a run that dies half-way, reports DID NOT RUN rather
# than "0 failures".
EXPECTED_TESTS="${EXPECTED_TESTS:-21}"

fatal() {
  echo "FATAL: $*"
  exit 2
}

[ -d "$SRC" ] || fatal "no source tree at $SRC"
[ -f "$SRC/AppPicker.tsx" ] || fatal "$SRC does not look like packages/ui's src/ (no AppPicker.tsx)"
[ -f "$SRC/StepBuilderModal.tsx" ] || fatal "$SRC does not look like packages/ui's src/ (no StepBuilderModal.tsx)"
command -v docker >/dev/null 2>&1 || fatal "docker is required to run a real browser"
docker image inspect "$PW_IMAGE" >/dev/null 2>&1 || fatal "image $PW_IMAGE is not present — docker pull $PW_IMAGE"

STUDIO_CSS="$PKG/../studio/src/styles.css"
[ -f "$STUDIO_CSS" ] || fatal "no $STUDIO_CSS — packages/studio must be checked out as a sibling"

ESBUILD="${ESBUILD:-$({ find "$PKG/node_modules/.pnpm" -maxdepth 5 -path '*/esbuild/bin/esbuild' -type f 2>/dev/null || true; } | head -1)}"
[ -n "$ESBUILD" ] || fatal "no esbuild binary under $PKG/node_modules/.pnpm — run pnpm install in $PKG"

# playwright-core@1.60.0 is a declared devDependency of packages/ui (pnpm add -D
# playwright-core@1.60.0) — resolved from THIS package's own node_modules only.
# No home-directory scan: an unrelated checkout's copy must never make this "work".
PW_CORE="${PW_CORE:-$PKG/node_modules/playwright-core}"
[ -d "$PW_CORE" ] || fatal "no playwright-core at $PW_CORE — run: pnpm add -D playwright-core@${PW_VERSION} (from $PKG)"

W="$(mktemp -d)"
MAIN_PID=$$
# SHOT_DIR — when set, any *.png a guard writes into its workdir is copied out
# before the workdir is removed. The C6 layout guard writes one, so "is it
# actually two columns?" can be answered by LOOKING, not only by an assertion.
cleanup() {
  if [ "$BASHPID" = "$MAIN_PID" ]; then
    if [ -n "${SHOT_DIR:-}" ]; then
      mkdir -p "$SHOT_DIR" 2>/dev/null || true
      cp "$W"/*.png "$SHOT_DIR"/ 2>/dev/null || true
    fi
    rm -rf "$W"
  fi
}
trap cleanup EXIT

echo "== source under test: $SRC"
echo "== engine: $ENGINE · image: $PW_IMAGE · playwright-core: $PW_CORE"

mkdir -p "$W/tree/src"
cp -a "$SRC/." "$W/tree/src/"
cp "$HERE/harness-entry.tsx" "$W/tree/src/__picker_layout_entry.tsx"

# Real react / react-dom / @codemirror / @uiw / @xyflow (used only as `import
# type`) — everything StepBuilderModal's own import graph reaches. Nothing is
# stubbed or fabricated: this gate mounts the real components, so unlike
# studio's page-guards (which fake @w6w/ui) there is no substitute to keep
# alongside a handful of hand-picked symlinks. One read-only symlink to the
# checkout's own node_modules; the checkout itself is never written to.
[ -d "$PKG/node_modules" ] || fatal "missing $PKG/node_modules — run pnpm install in $PKG"
ln -sfn "$PKG/node_modules" "$W/tree/node_modules"

"$ESBUILD" "$W/tree/src/__picker_layout_entry.tsx" --bundle --loader:.tsx=tsx --loader:.ts=ts \
  --jsx=automatic --jsx-import-source=react --format=iife --log-level=warning \
  --outfile="$W/bundle.js" --define:process.env.NODE_ENV='"development"'
[ -s "$W/bundle.js" ] || { echo "DID NOT RUN: the tree at $SRC does not bundle"; exit 3; }

# Stylesheets are <link>ed from the real files, not bundled — ui.css first,
# then studio.css, matching studio/src/main.tsx:16-17's load order, so the
# consumer-layered cascade (e.g. studio's input[type=text] out-specifying
# .w6w-stepbuilder-search) is reproduced rather than assumed away.
# ui.css is compiled from the SCSS source rather than copied from the generated
# `styles.css`, so the harness tests what the partials under src/styles/
# currently say and never a stale build artifact. The fallback keeps a `UI_SRC`
# tree that predates the SCSS conversion working.
if [ -f "$SRC/styles.scss" ]; then
  "$PKG/node_modules/.bin/sass" --no-source-map --style=expanded "$SRC/styles.scss" "$W/ui.css"
else
  cp "$SRC/styles.css" "$W/ui.css"
fi
cp "$STUDIO_CSS" "$W/studio.css"

cp "$HERE/picker-layout-guards.test.cjs" "$W/tests.cjs"
tap="$W/tap.txt"
# Two reporters: `spec` on the console for a human, `tap` into a file for the
# verdict below — the spec reporter's totals are decorated and
# reporter-dependent, TAP's are not.
docker run --rm -v "$W":/w -v "$PW_CORE":/pw:ro -w /w \
  -e ENGINE="$ENGINE" -e PW_CORE_MOUNT=/pw \
  "$PW_IMAGE" node --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=tap --test-reporter-destination=/w/tap.txt \
  /w/tests.cjs
docker_rc="$?"
[ -f "$tap" ] || { echo "DID NOT RUN: the test process produced no TAP output (node exit $docker_rc)"; exit 3; }

# The verdict is derived from the TAP totals, and only after the total is confirmed.
count() { { grep -oE "^# $1 [0-9]+" "$tap" || true; } | head -1 | { grep -oE '[0-9]+$' || true; }; }
tests="$(count tests)"
fails="$(count fail)"
passes="$(count pass)"
echo
if [ -z "$tests" ] || [ -z "$fails" ] || [ "$tests" != "$EXPECTED_TESTS" ]; then
  echo "DID NOT RUN: expected $EXPECTED_TESTS tests, TAP reported tests='${tests:-<none>}'" \
    "pass='${passes:-<none>}' fail='${fails:-<none>}' (node exit $docker_rc)"
  echo "  -> this is NOT a pass and NOT a survivor: the run itself did not complete."
  exit 3
fi
if [ "$fails" != 0 ]; then
  echo "RED: $fails of $tests picker-layout guard tests failed (engine=$ENGINE, source=$SRC)"
  { grep -E '^not ok' "$tap" || true; }
  exit 1
fi
echo "GREEN: $passes/$tests picker-layout guard tests pass (engine=$ENGINE, source=$SRC)"
exit 0
