#!/usr/bin/env bash
# Runner for ./action-test-form-guards.test.cjs — ActionTestForm's OWN
# pop-out ("Edit params", `Modal size="full"`) layout invariant no
# `node --test src/**/*.test.ts` can reach: jsdom performs no layout
# (getBoundingClientRect and scrollHeight/clientHeight are all zeros), so a
# jsdom test would pass on a tree that clips real content. This gate mounts
# the REAL ActionTestForm, compiled from source, in real Chromium — mirrors
# `test/expr-template/`'s mechanics verbatim (copy the source tree, symlink
# in this checkout's own node_modules, bundle with esbuild, run in the
# Playwright image), no fourth rig invented beyond what T1.4.1 round 2
# adopted from the evaluator's own throwaway harness.
#
#   pnpm exec bash test/action-test-form/run.sh        # from packages/ui
#   ENGINE=firefox bash test/action-test-form/run.sh   # the same test in another engine
#
# What it does: copies the source tree into a scratch dir, symlinks in the
# checkout's own node_modules (react/react-dom — everything ActionTestForm's
# own import graph reaches; nothing is stubbed or fabricated — this gate
# mounts the real component, unlike studio's page-guards which fake
# @w6w/ui), bundles with esbuild, and runs the test in a browser inside the
# Playwright image with a plain `<W6WUIProvider api={...}>` stub object (no
# network layer — see harness-entry.tsx). It writes ONLY inside its own
# `mktemp -d` and the container is `--rm`: no service, DB, catalog row or
# checkout is touched, so it is safe to re-run.
#
# Prerequisites (all local, no network):
#   - docker, and the image below (docker pull mcr.microsoft.com/playwright:v1.60.0-noble)
#   - packages/ui/node_modules, including its OWN declared devDependency
#     playwright-core@1.60.0 — this runner resolves it from $PKG/node_modules
#     only; it is never scanned for under the caller's home directory, so a
#     stray unrelated checkout's copy can never make this gate "work by
#     accident" the way it can for an undeclared tool.
#
# Knobs: ENGINE, PW_CORE, PW_VERSION, PW_IMAGE, ESBUILD, EXPECTED_TESTS, and
# UI_SRC — point that at a copy of `src` to run the test against a tree other
# than this checkout's (how the guard is mutation-tested without dirtying a
# shared working tree — see the project's result for the exact mutants run).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/../.." && pwd)"
SRC="${UI_SRC:-$PKG/src}"
ENGINE="${ENGINE:-chromium}"
PW_VERSION="${PW_VERSION:-1.60.0}"
PW_IMAGE="${PW_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-noble}"
# Four top-level test()s (M-popout-scroll, T2.1.1's defect-1 gap check,
# T1.1.2's delete-confirm gate, and T1.1.1's duck-typed invoke-error guard). A
# tree that fails to bundle, or a run that dies half-way, reports DID NOT RUN
# rather than "0 failures".
EXPECTED_TESTS="${EXPECTED_TESTS:-4}"

fatal() {
  echo "FATAL: $*"
  exit 2
}

[ -d "$SRC" ] || fatal "no source tree at $SRC"
[ -f "$SRC/ActionTestForm.tsx" ] ||
  fatal "$SRC does not look like packages/ui's src/ (no ActionTestForm.tsx)"
command -v docker >/dev/null 2>&1 || fatal "docker is required to run a real browser"
docker image inspect "$PW_IMAGE" >/dev/null 2>&1 || fatal "image $PW_IMAGE is not present — docker pull $PW_IMAGE"

ESBUILD="${ESBUILD:-$({ find "$PKG/node_modules/.pnpm" -maxdepth 5 -path '*/esbuild/bin/esbuild' -type f 2>/dev/null || true; } | head -1)}"
[ -n "$ESBUILD" ] || fatal "no esbuild binary under $PKG/node_modules/.pnpm — run pnpm install in $PKG"

# playwright-core@1.60.0 is a declared devDependency of packages/ui — resolved
# from THIS package's own node_modules only. No home-directory scan.
PW_CORE="${PW_CORE:-$PKG/node_modules/playwright-core}"
[ -d "$PW_CORE" ] || fatal "no playwright-core at $PW_CORE — run: pnpm add -D playwright-core@${PW_VERSION} (from $PKG)"

W="$(mktemp -d)"
MAIN_PID=$$
cleanup() { [ "$BASHPID" = "$MAIN_PID" ] && rm -rf "$W"; }
trap cleanup EXIT

echo "== source under test: $SRC"
echo "== engine: $ENGINE · image: $PW_IMAGE · playwright-core: $PW_CORE"

mkdir -p "$W/tree/src"
cp -a "$SRC/." "$W/tree/src/"
cp "$HERE/harness-entry.tsx" "$W/tree/src/__action_test_form_entry.tsx"

# Real react / react-dom — everything ActionTestForm's own import graph
# reaches. One read-only symlink to the checkout's own node_modules; the
# checkout itself is never written to.
[ -d "$PKG/node_modules" ] || fatal "missing $PKG/node_modules — run pnpm install in $PKG"
ln -sfn "$PKG/node_modules" "$W/tree/node_modules"

"$ESBUILD" "$W/tree/src/__action_test_form_entry.tsx" --bundle --loader:.tsx=tsx --loader:.ts=ts \
  --jsx=automatic --jsx-import-source=react --format=iife --log-level=warning \
  --outfile="$W/bundle.js" --define:process.env.NODE_ENV='"development"'
[ -s "$W/bundle.js" ] || { echo "DID NOT RUN: the tree at $SRC does not bundle"; exit 3; }

# The stylesheet is <link>ed from the real file, not bundled. Compiled from the
# SCSS source rather than copied from the generated `styles.css`, so the harness
# tests what the partials under src/styles/ currently say and never a stale
# build artifact. The fallback keeps a `UI_SRC` tree that predates the SCSS
# conversion working.
if [ -f "$SRC/styles.scss" ]; then
  "$PKG/node_modules/.bin/sass" --no-source-map --style=expanded "$SRC/styles.scss" "$W/ui.css"
else
  cp "$SRC/styles.css" "$W/ui.css"
fi

cp "$HERE/action-test-form-guards.test.cjs" "$W/tests.cjs"
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
  echo "RED: $fails of $tests action-test-form guard tests failed (engine=$ENGINE, source=$SRC)"
  { grep -E '^not ok' "$tap" || true; }
  exit 1
fi
echo "GREEN: $passes/$tests action-test-form guard tests pass (engine=$ENGINE, source=$SRC)"
exit 0
