// Run (from packages/ui): node --test src/__tests__/check-sibling-deps.test.ts  (Node 24)
//
// scripts/check-sibling-deps.mjs replaced the npm-registry gate in PR CI: it must accept exactly
// the versions npm's own range rules accept, or a valid bump would go red (or a bad one green).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error plain .mjs script, no declarations
import { checkSiblingDeps, satisfies } from "../../scripts/check-sibling-deps.mjs";

test("satisfies: 0.x caret pins the minor", () => {
  assert.equal(satisfies("^0.1.1", "0.1.1"), true);
  assert.equal(satisfies("^0.1.1", "0.1.9"), true);
  assert.equal(satisfies("^0.1.1", "0.1.0"), false);
  assert.equal(satisfies("^0.1.1", "0.2.0"), false);
});

test("satisfies: 0.0.x caret pins the patch; 1.x caret pins the major", () => {
  assert.equal(satisfies("^0.0.3", "0.0.3"), true);
  assert.equal(satisfies("^0.0.3", "0.0.4"), false);
  assert.equal(satisfies("^1.2.0", "1.9.0"), true);
  assert.equal(satisfies("^1.2.0", "2.0.0"), false);
});

test("satisfies: tilde, exact, and prereleases only on the same triple", () => {
  assert.equal(satisfies("~0.1.1", "0.1.5"), true);
  assert.equal(satisfies("~0.1.1", "0.2.0"), false);
  assert.equal(satisfies("0.1.1", "0.1.1"), true);
  assert.equal(satisfies("0.1.1", "0.1.2"), false);
  assert.equal(satisfies("^0.1.1", "0.1.2-rc.1"), false);
  assert.equal(satisfies("^0.1.1-rc.1", "0.1.1-rc.2"), true);
});

test("satisfies: an unsupported range throws instead of guessing", () => {
  assert.throws(() => satisfies(">=0.1.0", "0.1.0"));
});

function repos(depRange: string, srcVersion: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), "sibling-deps-"));
  mkdirSync(join(root, "ui"));
  writeFileSync(
    join(root, "ui", "package.json"),
    JSON.stringify({ dependencies: { "@w6w/expr": depRange, react: "^18" } }),
  );
  if (srcVersion !== undefined) {
    mkdirSync(join(root, "core", "packages", "expr"), { recursive: true });
    writeFileSync(
      join(root, "core", "packages", "expr", "package.json"),
      JSON.stringify({ version: srcVersion }),
    );
  }
  return join(root, "ui");
}

test("checkSiblingDeps: a range the source satisfies passes, whatever npm has", () => {
  assert.deepEqual(checkSiblingDeps(repos("^0.1.1", "0.1.1")), []);
});

test("checkSiblingDeps: a range the source cannot satisfy is reported", () => {
  const problems = checkSiblingDeps(repos("^0.1.2", "0.1.1"));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /@w6w\/expr@\^0\.1\.2 is not satisfied by its source version 0\.1\.1/);
});

test("checkSiblingDeps: a missing sibling checkout is reported, not skipped", () => {
  const problems = checkSiblingDeps(repos("^0.1.1", undefined));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /cannot read/);
});
