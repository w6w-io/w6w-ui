// Run: node --test src/components/__tests__/resolved-clip.test.ts  (Node 24, type-stripped)
//
// Pure module, imported directly — no JSX harness (the `history-scale.ts`
// precedent). What it pins is the RULE the Test tab's rows depend on: a short
// value is untouched, a long one is cut to a bounded prefix and reports the
// full length so the toggle can name it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RESOLVED_VALUE_CLIP, clipResolvedValue } from "../resolved-clip.ts";

test("a value inside the budget is returned byte-identically and grows no toggle", () => {
  const text = "dev+1@w6w.io";
  const clip = clipResolvedValue(text);
  assert.equal(clip.text, text);
  assert.equal(clip.clipped, false);
  assert.equal(clip.length, text.length);
});

test("a value exactly at the budget is still not clipped (boundary is inclusive)", () => {
  const text = "x".repeat(RESOLVED_VALUE_CLIP);
  const clip = clipResolvedValue(text);
  assert.equal(clip.clipped, false);
  assert.equal(clip.text, text);
});

test("one character over the budget clips", () => {
  const text = "x".repeat(RESOLVED_VALUE_CLIP + 1);
  const clip = clipResolvedValue(text);
  assert.equal(clip.clipped, true);
  assert.equal(clip.text.length, RESOLVED_VALUE_CLIP);
  assert.equal(clip.length, RESOLVED_VALUE_CLIP + 1);
});

test("a document-body-sized HTML value keeps only the prefix, and reports the true length", () => {
  // The shape that caused this: `documents.confirmation-email.body` resolving
  // to a full HTML email pasted inline into one row.
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">${"<p>x</p>".repeat(5000)}`;
  const clip = clipResolvedValue(body);
  assert.equal(clip.clipped, true);
  assert.ok(clip.text.length <= RESOLVED_VALUE_CLIP, "the collapsed row stays within the budget");
  assert.ok(body.startsWith(clip.text), "the shown text is a prefix of the value, never a rewrite");
  assert.equal(
    clip.length,
    body.length,
    "the toggle can name the FULL length, not the clipped one",
  );
});

test("trailing whitespace at the cut is trimmed so the ellipsis sits against the text", () => {
  const text = `${"a".repeat(RESOLVED_VALUE_CLIP - 2)}  tail`;
  const clip = clipResolvedValue(text);
  assert.equal(clip.clipped, true);
  assert.equal(clip.text, "a".repeat(RESOLVED_VALUE_CLIP - 2));
});
