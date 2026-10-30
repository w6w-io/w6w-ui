#!/usr/bin/env bash
# The ONE list of checks for @w6w/ui. CI's `test` job runs exactly this file after
# `pnpm install --frozen-lockfile`, and so does the pre-push hook (w6w-io/w6w
# .githooks/pre-push), so a push that passes here passes CI. Add a check HERE, never
# only in ci.yml. Expects the sibling layout: ../core next to this repo.
set -euo pipefail
cd "$(dirname "$0")/.."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 24 ]; then
  echo "verify: Node $(node --version) — CI runs Node 24; run w6w-io/w6w scripts/install-hooks.sh to fetch it" >&2
  exit 1
fi

step() { printf '\n== %s\n' "$*"; }
step lint;                pnpm lint
step "check:css";         pnpm check:css
step typecheck;           pnpm typecheck
step "sibling deps";      node scripts/check-sibling-deps.mjs
step test;                pnpm test
step build;               pnpm build
step "pack + manifest"
pack_dir="$(mktemp -d)"
trap 'rm -rf "$pack_dir"' EXIT
pnpm pack --pack-destination "$pack_dir" >/dev/null
node scripts/assert-packed-manifest.mjs "$pack_dir"/w6w-ui-*.tgz
printf '\nverify: ok\n'
