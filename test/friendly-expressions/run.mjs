// Bundles this checkout's real editor; no server, API or workflow execution.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", { paths: [require.resolve("vite")] }),
);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./harness.tsx", import.meta.url))],
  bundle: true,
  write: false,
  conditions: ["w6w-source"],
  jsx: "automatic",
  format: "iife",
});
const css = await readFile(new URL("../../src/styles.css", import.meta.url));
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://preview.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: path === "/"
        ? "text/html"
        : path.endsWith("css")
        ? "text/css"
        : "application/javascript",
      body: path === "/"
        ? '<html data-theme="light"><head><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
        : path.endsWith("css")
        ? css
        : Buffer.from(bundle.outputFiles[0].contents),
    });
  });
  const editor = page.locator(".w6w-exprmodal-chips");
  const result = page.locator(".w6w-exprmodal-result");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const saved = async () =>
    JSON.parse(await page.getByTestId("saved").textContent());
  const expected =
    '{{ ={"==":[{"var":"nodes.order_merge.output.order.context.source"},"eventbrite"]} }}';
  const paste = async (text) => {
    await editor.evaluate((el, text) => {
      el.focus();
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData, bubbles: true }),
      );
    }, text);
  };

  await page.goto("http://preview.test/");
  await editor.click();
  await page.keyboard.type('order_merge.order.context.source == "eventbrite"');
  assert.equal(
    await editor.textContent(),
    'order_merge.order.context.source == "eventbrite"',
    "typing preserves caret order",
  );
  assert.equal(await result.textContent(), "true");
  await save.click();
  assert.equal(await saved(), expected);
  await page.getByRole("button", { name: "Open expression" }).click();
  const chip = editor.locator('[data-kind="expr"]');
  assert.match(
    await chip.textContent(),
    /order_merge.order.context.source == "eventbrite"/,
  );
  assert.doesNotMatch(await chip.textContent(), /"var"/);
  await chip.dblclick();
  assert.equal(
    await editor.textContent(),
    'nodes.order_merge.output.order.context.source == "eventbrite"',
  );
  await editor.fill("nodes.order_merge.output.order.context.source ==");
  assert.equal(await save.isDisabled(), true);
  assert.match(
    await page.getByRole("alert").textContent(),
    /Expected a field or value/,
  );
  await page.keyboard.type(' "cohost"');
  assert.equal(await save.isEnabled(), true);
  assert.equal(await result.textContent(), "false");
  await save.click();
  assert.match(await saved(), /cohost/);
  console.log(
    "PASS: shorthand typing, boolean preview, save/reopen, readable editing, incomplete-expression validation",
  );

  await page.goto("http://preview.test/?v=broken");
  await chip.waitFor();
  assert.equal(await result.textContent(), "true");
  const sample = page.getByPlaceholder("sample value");
  await sample.fill("cohost");
  assert.equal(await result.textContent(), "false");
  await sample.fill("eventbrite");
  await save.click();
  assert.equal(await saved(), expected);

  await page.goto("http://preview.test/");
  await editor.click();
  await paste(
    '{{ nodes.order_merge.output.order.context.source }} == "eventbrite"',
  );
  assert.equal(await result.textContent(), "true");
  await save.click();
  assert.equal(await saved(), expected);
  console.log(
    "PASS: existing broken comparison repaired, samples update the result, pasted field plus comparison",
  );

  await page.goto("http://preview.test/");
  await page.getByRole("button", { name: "Variables", exact: true }).click();
  await page.getByTitle("Insert source", { exact: true }).click();
  assert.equal(
    await editor.isVisible(),
    true,
    "selecting a field must leave the editor open",
  );
  await page.keyboard.type(' == "eventbrite"');
  assert.equal(await result.textContent(), "true");
  await page.screenshot({ path: "/tmp/friendly-expression-editor.png" });
  await save.click();
  assert.equal(
    await saved(),
    '{{ ={"==":[{"var":"var.source"},"eventbrite"]} }}',
  );

  await page.goto("http://preview.test/");
  await editor.click();
  await paste("{{ var.source }}!");
  assert.equal(await save.isEnabled(), true);
  await save.click();
  assert.equal(await saved(), "{{ var.source }}!");
  console.log(
    "PASS: picker insertion allows a comparison, ordinary punctuation remains a text template",
  );

  await page.goto("http://preview.test/?v=inline");
  const inline = page.getByRole("textbox", {
    name: "inline expression",
    exact: true,
  });
  await inline.fill('order_merge.order.context.source == "eventbrite"');
  assert.equal(await saved(), expected);
  assert.deepEqual(errors, []);
  console.log("PASS: inline field also compiles friendly comparisons");
} finally {
  await browser.close();
}
