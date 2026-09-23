/**
 * coverage:stories — a zero-tolerance gate: every component this package
 * exports must ship a co-located Storybook story.
 *
 * Mechanism:
 *   1. Entry points come from `package.json`'s `exports` map — every entry
 *      whose value is an object with an `import` ending in `.ts`/`.tsx`
 *      (today: `.`, `./flow`, `./code` → `src/index.ts`, `src/flow.ts`,
 *      `src/code.ts`). Never hard-coded, so a fourth entrypoint is picked up
 *      automatically.
 *   2. Each entry file is scanned for `export { … } from "<spec>";` blocks,
 *      including ones spanning multiple lines. `export type { … }` blocks are
 *      skipped wholesale, and an inline `type X` specifier inside an
 *      otherwise-live block (`export { type Foo } from …`) is skipped too —
 *      neither ever names a value, let alone a component. `A as B` exports
 *      the name `B`.
 *   3. A name counts as a component iff it is PascalCase
 *      (`/^[A-Z][A-Za-z0-9]*$/`, so `W6WUIProvider`'s embedded digit still
 *      matches — a naive `/^[A-Z][a-z]/` would silently drop it), contains at
 *      least one lowercase letter (so a `SCREAMING_SNAKE` constant — which
 *      also fails on the underscore alone — can never qualify), and is not on
 *      the DENYLIST below.
 *   4. Names are de-duplicated across entry points before counting — the same
 *      symbol re-exported from two barrels (`CodeBlock`, `Copyable`,
 *      `ExpressionOptionsProvider`) is one obligation, not two or three.
 *   5. A component is COVERED iff `<dirname(resolved "from" path)>/<Name>
 *      .stories.tsx` exists *and* contains `component: <Name>` as a whole
 *      word. This is keyed on the component's own name, never on a story's
 *      *export* name — `src/CodeBlock.stories.tsx` also exports a story
 *      literally called `Copyable`, which must not satisfy `CodeBlock`.
 *
 * DENYLIST — exports that pass the PascalCase heuristic but are not
 * components, so a bare naming rule would false-positive on them:
 *   - "ApiError": a class (`createW6WApi.ts`), never rendered as JSX anywhere
 *     in `src/`.
 *
 *   node scripts/coverage-stories.mjs           # check — see exit codes below
 *   node scripts/coverage-stories.mjs --list     # print every component's status
 *
 * Exit codes:
 *   0  every exported component has a matching, correctly-`component:`-typed
 *      story.
 *   1  at least one exported component has no story (or its story's `meta`
 *      does not declare `component: <Name>`).
 *   3  unknown flag.
 *
 * There is deliberately no baseline file here (unlike `lint:tokens`): this is
 * a zero-tolerance ratchet — a component either has a story or the gate
 * fails, full stop.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const packageJsonPath = join(root, "package.json");

const DENYLIST = new Map([
  ["ApiError", "a class (createW6WApi.ts), never rendered as JSX anywhere in src/"],
]);

const EXPORT_BLOCK_RE = /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\3\s*;/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isComponentName(name) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return false;
  if (!/[a-z]/.test(name)) return false;
  if (DENYLIST.has(name)) return false;
  return true;
}

/** `A as B` exports the name `B`; a leading `type ` specifier is skipped
 * (returns null); everything else is the bare specifier name. */
function specifierName(raw) {
  const s = raw.trim();
  if (s.length === 0) return null;
  if (/^type\s+/.test(s)) return null;
  const asMatch = s.match(/^\S+\s+as\s+(\S+)$/);
  if (asMatch) return asMatch[1];
  return s;
}

/** Every entry point file from `package.json`'s `exports` map whose `import`
 * ends in `.ts`/`.tsx` — never the three files hard-coded. */
function entryPointFiles() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const files = [];
  for (const value of Object.values(pkg.exports ?? {})) {
    if (
      value &&
      typeof value === "object" &&
      typeof value.import === "string" &&
      /\.tsx?$/.test(value.import)
    ) {
      files.push(join(root, value.import));
    }
  }
  return files;
}

/** Every `*.stories.tsx` file under `src/`, as absolute paths. Mirrors
 * `scripts/lint-tokens.mjs`'s `walkScss` shape. */
function walkStories(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkStories(abs));
    } else if (entry.isFile() && entry.name.endsWith(".stories.tsx")) {
      out.push(abs);
    }
  }
  return out;
}

function toRelPosix(abs) {
  return relative(root, abs).split("\\").join("/");
}

/** Every component this one entry file exports, as `name -> expected story
 * path (absolute)`. De-duplication across entry files happens in the caller. */
function componentsFromEntry(entryFile) {
  const text = readFileSync(entryFile, "utf8");
  const dir = dirname(entryFile);
  const found = new Map();
  for (const m of text.matchAll(EXPORT_BLOCK_RE)) {
    const isTypeBlock = Boolean(m[1]);
    if (isTypeBlock) continue;
    const spec = m[4];
    const resolvedFrom = join(dir, spec);
    for (const rawSpecifier of m[2].split(",")) {
      const name = specifierName(rawSpecifier);
      if (name === null) continue;
      if (!isComponentName(name)) continue;
      if (found.has(name)) continue;
      const storyPath = join(dirname(resolvedFrom), `${name}.stories.tsx`);
      found.set(name, storyPath);
    }
  }
  return found;
}

function usage() {
  console.error(
    [
      "Usage: node scripts/coverage-stories.mjs [--list]",
      "  (no flag)  check every exported component has a story — exit 0 clean,",
      "             1 if any is missing",
      "  --list     print every component's name, expected story path and",
      "             ok|MISSING status, one per line",
    ].join("\n"),
  );
}

function main() {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const unknown = args.filter((a) => a !== "--list");
  if (unknown.length > 0) {
    usage();
    process.exit(3);
  }

  const components = new Map();
  for (const entryFile of entryPointFiles()) {
    for (const [name, storyPath] of componentsFromEntry(entryFile)) {
      if (!components.has(name)) components.set(name, storyPath);
    }
  }

  const storyFiles = new Set(walkStories(srcDir));

  const names = [...components.keys()].sort();
  const results = names.map((name) => {
    const storyPath = components.get(name);
    let ok = false;
    if (storyFiles.has(storyPath)) {
      const content = readFileSync(storyPath, "utf8");
      const componentRe = new RegExp(`\\bcomponent:\\s*${escapeRegExp(name)}\\b`);
      ok = componentRe.test(content);
    }
    return { name, storyRel: toRelPosix(storyPath), ok };
  });

  const missing = results.filter((r) => !r.ok);

  if (list) {
    for (const r of results) {
      console.log(`${r.name}\t${r.storyRel}\t${r.ok ? "ok" : "MISSING"}`);
    }
    process.exit(missing.length > 0 ? 1 : 0);
  }

  for (const m of missing) {
    console.log(`MISSING ${m.name} — expected ${m.storyRel}`);
  }
  console.log(
    `coverage:stories — ${results.length} exported components, ${results.length - missing.length} with stories, ${missing.length} missing`,
  );
  process.exit(missing.length > 0 ? 1 : 0);
}

main();
