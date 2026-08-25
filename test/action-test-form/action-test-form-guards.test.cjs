// Browser gate for ActionTestForm's OWN pop-out ("Edit params", `Modal
// size="full"`) — the surface T1.4.1's contract declared unpinnable in round
// 1 (no rig in this repo mounted ActionTestForm) and which round 1's
// specificity fix then regressed: with `-full`'s `overflow: hidden` live for
// the first time, a realistic param count (15-23 is typical for a
// first-party action) clipped ~409px of content with zero internal scroll
// container and zero scrollbar — reachable pre-fix (the dialog itself
// scrolled under the base rule's `overflow: auto`), unreachable after.
// Adopted from T1.4.1 round 2's evaluator harness/probe
// (`artifacts/T1.4.1-ungated-harness-entry.tsx` /
// `T1.4.1-ungated-probe.cjs` in the project folder) into a permanent guard.
// Mounts the REAL ActionTestForm, bundled from source by ./run.sh, into real
// Chromium via harness-entry.tsx — no jsdom (it performs no layout: every
// rect and scrollHeight would read zero and this test would pass on the
// broken tree), no `@w6w/ui` substitute.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const pw = require(process.env.PW_CORE_MOUNT || "/pw");
const ENGINE = process.env.ENGINE || "chromium";
const engine = pw[ENGINE];
if (!engine) throw new Error(`no such browser engine: ${ENGINE}`);

const VP = { width: 1440, height: 900 };

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>action-test-form</title>
<link rel="stylesheet" href="/ui.css">
</head><body><div id="root"></div>
<script src="/bundle.js"></script></body></html>`;

// `variant` — optional, defaults to today's behaviour (no `?variant=` query,
// so M-popout-scroll below is untouched by the new fixture switch).
async function open(browser, variant) {
  const page = await browser.newPage({ viewport: VP });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.route("**/*", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/") return route.fulfill({ contentType: "text/html", body: HTML });
    if (p === "/bundle.js")
      return route.fulfill({ contentType: "text/javascript", path: "/w/bundle.js" });
    if (p === "/ui.css") return route.fulfill({ contentType: "text/css", path: "/w/ui.css" });
    return route.fulfill({ status: 404, body: "" });
  });
  const url = variant
    ? `http://action-test-form.test/?variant=${encodeURIComponent(variant)}`
    : "http://action-test-form.test/";
  await page.goto(url);
  await page.waitForFunction(() => window.__mounted === true, null, { timeout: 10000 });
  await page.waitForTimeout(150);
  if (errs.length) {
    throw new Error(`pageerror mounting variant=${variant ?? "(default)"}: ${errs.join("; ")}`);
  }
  return page;
}

let browser;
before(async () => {
  browser = await engine.launch();
});
after(async () => {
  if (browser) await browser.close();
});

// ── M-popout-scroll — the "Edit params" pop-out shows ALL content, reachable
//    via its OWN internal scrollbar, not the dialog's (which is `overflow:
//    hidden` by design — pinned decision #2 of T1.4.1 round 1, gated
//    separately by M-full in test/expr-template). ─────────────────────────
test("M-popout-scroll — ActionTestForm's -full pop-out shows all content via an internal scroll boundary, nothing clipped", async () => {
  const page = await open(browser);

  const btn = await page.$('button[aria-label="Open the params editor in a larger view"]');
  assert.ok(btn, "expand-to-pop-out toggle button not found");
  await btn.click();
  await page.waitForSelector("dialog[open]", { timeout: 5000 });
  await page.waitForTimeout(150);

  const info = await page.evaluate(() => {
    const dlg = document.querySelector("dialog");
    const scroller = document.querySelector(".w6w-tester-popout-scroll");
    const runBtn = [...document.querySelectorAll(".w6w-tester-actions button")].find(
      (b) => b.textContent.trim() === "Run action",
    );
    const dlgRect = dlg?.getBoundingClientRect();
    const runRectBefore = runBtn?.getBoundingClientRect();
    return {
      dlgWidth: dlgRect?.width ?? null,
      dlgOverflow: dlg ? getComputedStyle(dlg).overflow : null,
      dlgClipped: dlg ? dlg.scrollHeight - dlg.clientHeight : null,
      scrollerFound: !!scroller,
      scrollerOverflow: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
      runFoundBefore: !!runBtn,
      runTopBefore: runRectBefore ? runRectBefore.top : null,
      runBottomBefore: runRectBefore ? runRectBefore.bottom : null,
      dlgBottom: dlgRect ? dlgRect.bottom : null,
      docScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  // Same -full mechanics M-full pins (expr-template): still ≥1150 wide, still
  // `overflow: hidden` on the DIALOG itself, no horizontal page scroll.
  assert.ok(info.dlgWidth >= 1150, `-full dialog width ${info.dlgWidth} < 1150 floor`);
  assert.equal(
    info.dlgOverflow,
    "hidden",
    `-full dialog computed overflow was "${info.dlgOverflow}", expected "hidden"`,
  );
  assert.ok(
    info.docScrollWidth <= info.viewportWidth,
    `-full dialog causes horizontal page scroll: documentElement.scrollWidth ${info.docScrollWidth} > viewport width ${info.viewportWidth}`,
  );

  // The dialog itself must NOT be the thing that overflows (that is what
  // `overflow: hidden` on the DIALOG means, per the round-1 fix) — any
  // overflow must be contained by the internal scroller below, not the
  // dialog box.
  assert.equal(
    info.dlgClipped,
    0,
    `-full dialog itself has clipped content (scrollHeight - clientHeight = ${info.dlgClipped}) — overflow must be owned by .w6w-tester-popout-scroll, not the dialog`,
  );

  // The internal scroll boundary must exist...
  assert.ok(info.scrollerFound, ".w6w-tester-popout-scroll not found inside the pop-out dialog");
  // ...and, at this realistic (14-param) fixture, actually have real content
  // to scroll — otherwise a host that merely stops clipping (nothing to
  // clip) would pass this assertion for the wrong reason, exactly like I1's
  // "scrollableBefore > 0" precondition in test/picker-layout.
  assert.ok(
    info.scrollerOverflow > 0,
    `.w6w-tester-popout-scroll has nothing to scroll at 14 params (overflow ${info.scrollerOverflow}) — this fixture must actually stress the layout`,
  );

  assert.ok(info.runFoundBefore, `"Run action" button not found in the pop-out's action bar`);
  // The action bar (Run/Save/Delete) is a PINNED footer, outside the scroll
  // region — it must already be fully visible within the dialog's own box
  // before any scrolling, at this realistic param count.
  assert.ok(
    info.runBottomBefore <= info.dlgBottom + 1,
    `"Run action" button (bottom ${info.runBottomBefore}) sits below the dialog's own bottom (${info.dlgBottom}) — it is clipped, not reachable`,
  );

  // Scroll the internal container to the bottom: it must actually move (a
  // fixed, non-scrolling container — e.g. `overflow: hidden` accidentally
  // landing on `.w6w-tester-popout-scroll` itself — would leave scrollTop at
  // 0), and the action bar's own position must be UNCHANGED by that scroll
  // (it lives outside the scroll region, pinned).
  const after_ = await page.evaluate(() => {
    const scroller = document.querySelector(".w6w-tester-popout-scroll");
    scroller.scrollTop = 999999;
    const runBtn = [...document.querySelectorAll(".w6w-tester-actions button")].find(
      (b) => b.textContent.trim() === "Run action",
    );
    const r = runBtn?.getBoundingClientRect();
    return {
      scrollTopAfter: scroller.scrollTop,
      runTopAfter: r ? r.top : null,
      runBottomAfter: r ? r.bottom : null,
    };
  });
  assert.ok(
    after_.scrollTopAfter > 0,
    `.w6w-tester-popout-scroll did not actually scroll (scrollTop stayed ${after_.scrollTopAfter}) — it is not a real scroll container`,
  );
  assert.equal(
    after_.runTopAfter,
    info.runTopBefore,
    `"Run action" button moved after scrolling the params region (before top ${info.runTopBefore}, after ${after_.runTopAfter}) — it must be a pinned footer, not part of the scrolled content`,
  );

  await page.close();
});

// ── T2.1.1 defect 1 — the error box must NOT sit flush against the params
//    region above it, in BOTH embedded variants (`.w6w-tester-embedded-main`,
//    the rail case, AND `.w6w-tester-embedded-scroll`, the no-rail case). A
//    fix on `.w6w-tester-embedded-main` alone passes the rail variant and
//    leaves the no-rail one at a 0px gap — that near-miss is exactly why both
//    variants are exercised in one test rather than one probe each. ────────
test("T2.1.1 defect 1 — 12px gap between params and the error box, in both embedded variants", async () => {
  for (const variant of ["embedded-rail", "embedded-norail"]) {
    const page = await open(browser, variant);

    const runBtn = await page.$(".w6w-tester-actions button");
    assert.ok(runBtn, `[${variant}] "Run action" button not found`);
    await runBtn.click();
    await page.waitForSelector(".w6w-result.w6w-error", { timeout: 5000 });
    await page.waitForTimeout(150);

    const info = await page.evaluate(() => {
      const err = document.querySelector(".w6w-result.w6w-error");
      const prev = err?.previousElementSibling ?? null;
      const errRect = err?.getBoundingClientRect();
      const prevRect = prev?.getBoundingClientRect();
      return {
        errFound: !!err,
        errHeight: errRect ? errRect.height : null,
        prevFound: !!prev,
        prevClass: prev ? prev.className : null,
        prevText: prev ? prev.textContent.trim().slice(0, 20) : null,
        gap: errRect && prevRect ? errRect.top - prevRect.bottom : null,
      };
    });

    // The fixture must be real, or the gap assertion below passes for the
    // wrong reason (nothing to measure a gap between).
    assert.ok(info.errFound, `[${variant}] .w6w-result.w6w-error not found`);
    assert.ok(
      info.errHeight > 0,
      `[${variant}] .w6w-result.w6w-error has zero height (errH ${info.errHeight})`,
    );
    assert.ok(info.prevFound, `[${variant}] error box has no previous sibling to measure against`);
    assert.ok(
      info.prevClass && info.prevClass.includes("w6w-stack"),
      `[${variant}] error box's previous sibling is "${info.prevClass}", expected the params region's "w6w-stack"`,
    );
    assert.ok(
      info.prevText && info.prevText.startsWith("Parameters"),
      `[${variant}] error box's previous sibling does not start with "Parameters" (got "${info.prevText}")`,
    );

    // The literal 12, not a self-referential read of --w6w-sp-3 — a tree that
    // redefines the token to 0 must fail this, not pass it.
    assert.ok(
      info.gap >= 11 && info.gap <= 13,
      `[${variant}] gap between params region and error box is ${info.gap}px, expected 12px ±1`,
    );

    await page.close();
  }
});

// ── T1.1.2 — the saved-test Delete button must be gated behind a
//    ConfirmModal, not call `deleteSavedTest` on the raw click. A tree with
//    the ConfirmModal rendered-but-unwired (still calling deleteCurrentTest
//    directly from the Delete button, in ADDITION to opening the confirm)
//    fails here at the "click Delete" step, before Confirm is even reached —
//    a bare presence-grep for ConfirmModal would not catch that. ──────────
test("delete-confirm — Delete is gated behind ConfirmModal, not fired on the raw click", async () => {
  const page = await open(browser, "delete-confirm");

  const callsBefore = await page.evaluate(() => window.__deleteSavedTestCalls);
  assert.equal(callsBefore, 0, `__deleteSavedTestCalls should start at 0, got ${callsBefore}`);

  const deleteClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".w6w-tester-actions button")].find(
      (b) => b.textContent.trim() === "Delete",
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert.ok(deleteClicked, '.w6w-tester-actions "Delete" button not found');

  // The mutation must NOT have fired yet — this is the assertion that
  // distinguishes real gating from a rendered-but-unwired modal.
  const callsAfterClick = await page.evaluate(() => window.__deleteSavedTestCalls);
  assert.equal(
    callsAfterClick,
    0,
    `clicking Delete must not call deleteSavedTest directly, got ${callsAfterClick} call(s)`,
  );

  await page.waitForSelector("dialog[open]", { timeout: 5000 });
  const confirmClicked = await page.evaluate(() => {
    const dlg = document.querySelector("dialog[open]");
    const btn = dlg
      ? [...dlg.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete")
      : null;
    if (!btn) return false;
    btn.click();
    return true;
  });
  assert.ok(confirmClicked, 'ConfirmModal "Delete" button not found in the open dialog');

  await page.waitForFunction(() => window.__deleteSavedTestCalls === 1, null, {
    timeout: 5000,
  });
  const callsAfterConfirm = await page.evaluate(() => window.__deleteSavedTestCalls);
  assert.equal(
    callsAfterConfirm,
    1,
    `deleteSavedTest should have fired exactly once after confirming, got ${callsAfterConfirm}`,
  );

  await page.close();
});

// ── T1.1.1 — the invoke-error duck-type predicate. `ActionTestForm` used to
//    classify a failed invoke with `e instanceof ApiError` against ui's OWN
//    class, which nothing in the running app throws (studio passes
//    `@w6w/sdk`'s `ApiError` straight through), so the permission headline
//    never fired and the API-calls panel rendered empty. Three fixtures:
//    a PLAIN-OBJECT `@w6w/sdk`-shaped rejection (`raw`, no `body`), a real
//    `Error`-instance ui-shaped rejection (`body`, no `raw`), and the
//    pre-existing bare `Error` (neither shape) — which must NOT be
//    misclassified as a permission error. ──────────────────────────────────
test("T1.1.1 — duck-typed invoke error: headline + apiCalls panel for both error shapes, bare Error unaffected", async () => {
  // Fixture 1 — `error-raw`: plain object, `raw.apiCalls`, no `body` key.
  {
    const page = await open(browser, "error-raw");
    const runBtn = await page.$(".w6w-tester-actions button");
    assert.ok(runBtn, "[error-raw] \"Run action\" button not found");
    await runBtn.click();
    await page.waitForSelector(".w6w-result.w6w-error", { timeout: 5000 });
    await page.waitForTimeout(150);

    const info = await page.evaluate(() => {
      const headline = document.querySelector(".w6w-result.w6w-error strong")?.textContent ?? null;
      const rows = [...document.querySelectorAll("details.w6w-result")];
      return {
        headline,
        rowCount: rows.length,
        summary: rows[0]?.querySelector("summary")?.textContent ?? null,
      };
    });
    assert.ok(
      info.headline?.startsWith("Permission denied by the provider"),
      `[error-raw] headline "${info.headline}" does not start with "Permission denied by the provider"`,
    );
    assert.equal(
      info.rowCount,
      1,
      `[error-raw] expected exactly one details.w6w-result row, got ${info.rowCount}`,
    );
    assert.ok(
      info.summary?.includes("GET") && info.summary?.includes("https://api.sendgrid.com/v3/marketing/lists"),
      `[error-raw] api-call row summary "${info.summary}" does not contain the fixture's method + URL`,
    );
    await page.close();
  }

  // Fixture 2 — `error-body`: a real Error instance, `body.apiCalls`, no `raw` key.
  {
    const page = await open(browser, "error-body");
    const runBtn = await page.$(".w6w-tester-actions button");
    assert.ok(runBtn, "[error-body] \"Run action\" button not found");
    await runBtn.click();
    await page.waitForSelector(".w6w-result.w6w-error", { timeout: 5000 });
    await page.waitForTimeout(150);

    const info = await page.evaluate(() => {
      const headline = document.querySelector(".w6w-result.w6w-error strong")?.textContent ?? null;
      const rows = [...document.querySelectorAll("details.w6w-result")];
      return {
        headline,
        rowCount: rows.length,
        summary: rows[0]?.querySelector("summary")?.textContent ?? null,
      };
    });
    assert.ok(
      info.headline?.startsWith("Permission denied by the provider"),
      `[error-body] headline "${info.headline}" does not start with "Permission denied by the provider"`,
    );
    assert.equal(
      info.rowCount,
      1,
      `[error-body] expected exactly one details.w6w-result row, got ${info.rowCount}`,
    );
    assert.ok(
      info.summary?.includes("POST") && info.summary?.includes("https://api.sendgrid.com/v3/mail/send"),
      `[error-body] api-call row summary "${info.summary}" does not contain the fixture's method + URL`,
    );
    await page.close();
  }

  // Fixture 3 — the existing `embedded-rail` bare `Error`: neither shape (no
  // `status`/`code`) must NOT be misclassified as a permission error, and
  // carries no apiCalls at all.
  {
    const page = await open(browser, "embedded-rail");
    const runBtn = await page.$(".w6w-tester-actions button");
    assert.ok(runBtn, '[embedded-rail] "Run action" button not found');
    await runBtn.click();
    await page.waitForSelector(".w6w-result.w6w-error", { timeout: 5000 });
    await page.waitForTimeout(150);

    const info = await page.evaluate(() => {
      const headline = document.querySelector(".w6w-result.w6w-error strong")?.textContent ?? null;
      const rows = [...document.querySelectorAll("details.w6w-result")];
      return { headline, rowCount: rows.length };
    });
    assert.equal(
      info.headline,
      "action-test-form harness: invokeAction rejected",
      `[embedded-rail] headline "${info.headline}" is not exactly the bare Error's message`,
    );
    assert.equal(
      info.rowCount,
      0,
      `[embedded-rail] expected zero details.w6w-result rows, got ${info.rowCount}`,
    );
    await page.close();
  }
});
