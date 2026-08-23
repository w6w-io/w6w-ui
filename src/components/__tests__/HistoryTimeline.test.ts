// Run: node --import ./src/test-jsx-loader.mjs --test src/components/__tests__/HistoryTimeline.test.ts  (Node 24)
//
// Two halves:
//   1. Geometry — `history-scale.ts` is plain `.ts`, imported directly (Node's
//      own type-stripping handles it), no transpile step needed.
//   2. Render — mirrors `UptimeStrip.test.ts`'s harness: transpile the `.tsx`
//      with the package's own `typescript` and render with `renderToStaticMarkup`,
//      the only proven way to assert what the component actually emits. The one
//      difference from that harness: `HistoryTimeline.tsx` has a real relative
//      import (`./history-scale.ts`), so the emitted import specifier is
//      rewritten to an absolute `file:` URL before the scratch module is
//      written — and this test uses its OWN scratch directory
//      (`.w6w-jsx-test-history`, not `UptimeStrip.test.ts`'s `.w6w-jsx-test`)
//      so the two files' `after()` cleanups can never race each other when
//      `node --test` runs them as concurrent processes.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type {
  HistoryTimelineProps,
  HistoryWindow,
  VendorIncidentBar,
} from "../HistoryTimeline.tsx";
import type { UptimeDay } from "../UptimeStrip.tsx";
import { MIN_BAR_WIDTH_PCT, placeIncidentBar } from "../history-scale.ts";

// ─── 1. Geometry ────────────────────────────────────────────────────────────
//
// Every expected number below is computed FROM THE FIXTURE'S OWN LITERALS —
// never by calling `placeIncidentBar` itself, and never copied out of a run.

const WINDOW: HistoryWindow = { from: "2026-08-01", to: "2026-08-30" };
const SPAN_DAYS = 30; // Aug 1 .. Aug 30 inclusive == a 30-day span, per B2.
const NOW_MS = Date.parse("2026-08-23T00:00:00Z");

test("geometry: open incident runs to nowMs", () => {
  const bar: VendorIncidentBar = {
    title: "API outage",
    state: "down",
    startedAt: "2026-08-13T00:00:00Z",
  };
  const placement = placeIncidentBar(WINDOW, bar, NOW_MS);
  assert.ok(placement !== null);
  assert.equal(placement.leftPct, (12 / SPAN_DAYS) * 100);
  assert.equal(placement.widthPct, (10 / SPAN_DAYS) * 100);
  assert.equal(placement.clippedStart, false);
  assert.equal(placement.clippedEnd, false);
});

test("geometry: a resolved incident's width is its own duration", () => {
  const bar: VendorIncidentBar = {
    title: "Brief blip",
    state: "degraded",
    startedAt: "2026-08-05",
    resolvedAt: "2026-08-06",
  };
  const placement = placeIncidentBar(WINDOW, bar, NOW_MS);
  assert.ok(placement !== null);
  assert.equal(placement.widthPct, (1 / SPAN_DAYS) * 100);
});

test("geometry: a bar starting before the window is clipped at the left edge", () => {
  const bar: VendorIncidentBar = {
    title: "Long-running incident",
    state: "down",
    startedAt: "2026-07-20T00:00:00Z",
  };
  const placement = placeIncidentBar(WINDOW, bar, NOW_MS);
  assert.ok(placement !== null);
  assert.equal(placement.leftPct, 0);
  assert.equal(placement.clippedStart, true);
  // Right edge sits at day 23 (Aug 23 is 22 elapsed days into the window).
  assert.equal(placement.leftPct + placement.widthPct, (22 / SPAN_DAYS) * 100);
});

test("geometry: a feed-only entry with no startedAt is a point, at the minimum width", () => {
  const bar: VendorIncidentBar = {
    title: "Status update",
    state: "unknown",
    updatedAt: "2026-08-10T12:00:00Z",
  };
  const placement = placeIncidentBar(WINDOW, bar, NOW_MS);
  assert.ok(placement !== null);
  assert.equal(placement.widthPct, MIN_BAR_WIDTH_PCT);
  // 2026-08-10T12:00Z is 9.5 elapsed days into the window.
  assert.equal(placement.leftPct, (9.5 / SPAN_DAYS) * 100);
});

test("geometry: a bar wholly before the window is dropped", () => {
  const bar: VendorIncidentBar = {
    title: "Old incident",
    state: "down",
    startedAt: "2026-07-10T00:00:00Z",
    resolvedAt: "2026-07-15T00:00:00Z",
  };
  assert.equal(placeIncidentBar(WINDOW, bar, NOW_MS), null);
});

test("geometry: an entry with neither startedAt nor updatedAt has nothing to place", () => {
  const bar: VendorIncidentBar = { title: "Malformed", state: "unknown" };
  assert.equal(placeIncidentBar(WINDOW, bar, NOW_MS), null);
});

// ─── 2. Render ──────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "node_modules", ".w6w-jsx-test-history");
const outFile = join(outDir, "HistoryTimeline.mjs");

mkdirSync(outDir, { recursive: true });
const scaleModuleUrl = pathToFileURL(join(here, "..", "history-scale.ts")).href;
const transpiled = ts
  .transpileModule(readFileSync(join(here, "..", "HistoryTimeline.tsx"), "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  })
  .outputText.replace('from "./history-scale.ts"', `from "${scaleModuleUrl}"`);
writeFileSync(outFile, transpiled);
after(() => rmSync(outDir, { recursive: true, force: true }));

const { HistoryTimeline } = (await import(pathToFileURL(outFile).href)) as {
  HistoryTimeline: (props: HistoryTimelineProps) => ReturnType<typeof createElement>;
};

const render = (props: HistoryTimelineProps) =>
  renderToStaticMarkup(createElement(HistoryTimeline, props));

const day = (n: number, state: UptimeDay["state"] = "ok"): UptimeDay => ({
  day: `2026-08-${String(n).padStart(2, "0")}`,
  state,
});
const THIRTY_DAYS: UptimeDay[] = Array.from({ length: 30 }, (_, i) => day(i + 1));

const OPEN_BAR_DAY_13: VendorIncidentBar = {
  title: "API outage",
  state: "down",
  startedAt: "2026-08-13T00:00:00Z",
};

test("C3: a bar starting on day 13 sits inside cell 13's horizontal span", () => {
  const html = render({
    window: WINDOW,
    days: THIRTY_DAYS,
    incidents: [OPEN_BAR_DAY_13],
    nowMs: NOW_MS,
  });

  const cellRe =
    /class="w6w-history-cell w6w-history-cell-\w+" style="left:([\d.]+)%;width:([\d.]+)%"/g;
  const cells = [...html.matchAll(cellRe)].map((m) => ({
    left: Number(m[1]),
    width: Number(m[2]),
  }));
  assert.equal(cells.length, 30, "expected 30 execution cells");
  const cell13 = cells[12]; // 0-indexed: the 13th cell.

  const barRe =
    /class="w6w-history-bar w6w-history-bar-\w+" style="left:([\d.]+)%;width:([\d.]+)%"/g;
  const bars = [...html.matchAll(barRe)].map((m) => ({ left: Number(m[1]), width: Number(m[2]) }));
  assert.equal(bars.length, 1, "expected exactly one incident bar");
  const bar = bars[0];

  assert.ok(
    bar.left >= cell13.left && bar.left <= cell13.left + cell13.width,
    `bar.left=${bar.left} outside cell13 [${cell13.left}, ${cell13.left + cell13.width}]`,
  );
});

test("renders one execution cell per supplied day — not a fixed 30", () => {
  for (const n of [30, 7]) {
    const html = render({ window: WINDOW, days: THIRTY_DAYS.slice(0, n) });
    assert.equal(html.split("w6w-history-cell ").length - 1, n, `expected ${n} cells`);
  }
});

test("every execution cell and every bar carries a title attribute", () => {
  const html = render({
    window: WINDOW,
    days: THIRTY_DAYS,
    incidents: [OPEN_BAR_DAY_13],
    nowMs: NOW_MS,
  });
  const titleCount = html.split('title="').length - 1;
  assert.ok(titleCount >= 30 + 1, `expected >= 31 titles, got ${titleCount}`);
});

test("Stripe case: incidents undefined — full axis and execution lane, an empty vendor row, zero bars", () => {
  const html = render({ window: WINDOW, days: THIRTY_DAYS });
  assert.ok(html.includes("This vendor publishes no incident history."));
  assert.equal(html.split("w6w-history-bar ").length - 1, 0, "expected zero bar elements");
  assert.equal(html.split("w6w-history-cell ").length - 1, 30, "expected all 30 execution cells");
});

test("quiet-Slack case: incidents: [] — the OTHER default label, zero bars, all cells", () => {
  const html = render({ window: WINDOW, days: THIRTY_DAYS, incidents: [] });
  assert.ok(html.includes("No incidents in this window."));
  assert.ok(!html.includes("This vendor publishes no incident history."));
  assert.equal(html.split("w6w-history-bar ").length - 1, 0, "expected zero bar elements");
  assert.equal(html.split("w6w-history-cell ").length - 1, 30, "expected all 30 execution cells");
});

test("vendorEmptyLabel overrides both defaults", () => {
  const noFeed = render({
    window: WINDOW,
    days: THIRTY_DAYS,
    vendorEmptyLabel: "custom no-feed text",
  });
  assert.ok(noFeed.includes("custom no-feed text"));
  const quiet = render({
    window: WINDOW,
    days: THIRTY_DAYS,
    incidents: [],
    vendorEmptyLabel: "custom quiet text",
  });
  assert.ok(quiet.includes("custom quiet text"));
});

test("the chart is exposed as one labelled image", () => {
  assert.match(render({ window: WINDOW, days: THIRTY_DAYS }), /role="img" aria-label="[^"]+"/);
  assert.match(
    render({ window: WINDOW, days: THIRTY_DAYS, ariaLabel: "Slack, last 30 days" }),
    /aria-label="Slack, last 30 days"/,
  );
});

test("no colour literal reaches the markup — tokens do the colouring", () => {
  const html = render({
    window: WINDOW,
    days: THIRTY_DAYS,
    incidents: [OPEN_BAR_DAY_13],
    nowMs: NOW_MS,
  });
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});
