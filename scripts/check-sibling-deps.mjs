#!/usr/bin/env node
// Every `@w6w/*` dependency range must be satisfied by the version in that package's sibling
// source checkout. This is the PR-time check: it never asks npm, so it cannot go red because a
// sibling has not been published yet (publishing in order is the release train's job:
// w6w-io/w6w scripts/npm-release-train.sh). It does catch a range that names a version no
// source has, e.g. a typo or a bump the sibling never made.
//
//   node scripts/check-sibling-deps.mjs            (from the package root; siblings at ../)
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where each `@w6w/*` package's source lives, relative to the directory holding the repos. */
export const SIBLING_SOURCES = {
  "@w6w/expr": "core/packages/expr",
};

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) throw new Error(`not a version: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? "" };
}

function cmp(a, b) {
  for (const k of ["major", "minor", "patch"]) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/** `^`, `~` or an exact version, with npm's 0.x caret rules. Anything else is refused. */
export function satisfies(range, version) {
  const v = parse(version);
  const r = range.trim();
  if (/^\d/.test(r)) return cmp(v, parse(r)) === 0;
  const op = r[0];
  if (op !== "^" && op !== "~") throw new Error(`unsupported range: ${range}`);
  const lo = parse(r.slice(1));
  if (cmp(v, lo) < 0) return false;
  if (v.pre && !(v.major === lo.major && v.minor === lo.minor && v.patch === lo.patch)) return false;
  if (op === "~") return v.major === lo.major && v.minor === lo.minor;
  if (lo.major > 0) return v.major === lo.major;
  if (lo.minor > 0) return v.major === 0 && v.minor === lo.minor;
  return v.major === 0 && v.minor === 0 && v.patch === lo.patch;
}

/** Returns one message per problem; empty when every `@w6w/*` dependency is satisfied. */
export function checkSiblingDeps(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const reposDir = resolve(pkgDir, "..");
  const problems = [];
  for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
    if (!dep.startsWith("@w6w/")) continue;
    const src = SIBLING_SOURCES[dep];
    if (!src) {
      problems.push(`${dep}: no sibling source is mapped in SIBLING_SOURCES`);
      continue;
    }
    let version;
    try {
      version = JSON.parse(readFileSync(join(reposDir, src, "package.json"), "utf8")).version;
    } catch {
      problems.push(`${dep}: cannot read ${join(src, "package.json")} (is the sibling checked out?)`);
      continue;
    }
    if (!satisfies(range, version)) problems.push(`${dep}@${range} is not satisfied by its source version ${version}`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkSiblingDeps(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length) process.exit(1);
  console.log("sibling deps: ok");
}
