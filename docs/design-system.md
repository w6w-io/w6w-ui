---
title: "The spacing / typography scale"
section: "guides"
---

# The spacing / typography scale

`@w6w/ui` ships a spacing and typography scale as CSS custom properties, under
`--w6w-*`, declared in `src/styles/_scale.scss` and compiled into the exported
`src/styles.css` alongside everything else the package themes (colours,
`--w6w-radius`, etc. — see the [README](../README.md#theming) for those).

This doc is the file every sibling adoption (studio, admin, frontend/web) and
every future `ui` contract should point at rather than re-listing the tokens.

## (a) The full ramp

### Spacing — 4px base

| Token | Value | px |
|---|---|---|
| `--w6w-sp-1` | `4px` | 4 |
| `--w6w-sp-2` | `8px` | 8 |
| `--w6w-sp-3` | `12px` | 12 |
| `--w6w-sp-4` | `16px` | 16 |
| `--w6w-sp-5` | `20px` | 20 |
| `--w6w-sp-6` | `24px` | 24 |
| `--w6w-sp-8` | `32px` | 32 |
| `--w6w-sp-10` | `40px` | 40 |
| `--w6w-sp-12` | `48px` | 48 |
| `--w6w-sp-16` | `64px` | 64 |
| `--w6w-sp-20` | `80px` | 80 |

Half-steps — **`ui`-only**, not part of `frontend/web`'s set (see (b) and (d)):

| Token | Value | px |
|---|---|---|
| `--w6w-sp-0-5` | `2px` | 2 |
| `--w6w-sp-1-5` | `6px` | 6 |
| `--w6w-sp-2-5` | `10px` | 10 |

### Type ramp — rem-based

| Token | Value | px equivalent (16px root) |
|---|---|---|
| `--w6w-fs-xs` | `0.75rem` | 12 |
| `--w6w-fs-sm` | `0.875rem` | 14 |
| `--w6w-fs-base` | `1rem` | 16 |
| `--w6w-fs-lg` | `1.125rem` | 18 |
| `--w6w-fs-xl` | `1.25rem` | 20 |
| `--w6w-fs-2xl` | `1.5rem` | 24 |
| `--w6w-fs-3xl` | `2rem` | 32 |

The "px equivalent" column assumes a 16px root — see (e) for why that
assumption can silently break in a host that sets a non-default root size.

### Weights and line-heights

| Token | Value |
|---|---|
| `--w6w-fw-regular` | `400` |
| `--w6w-fw-medium` | `500` |
| `--w6w-fw-semibold` | `600` |
| `--w6w-fw-bold` | `700` |
| `--w6w-lh-tight` | `1.2` |
| `--w6w-lh-normal` | `1.5` |
| `--w6w-lh-relaxed` | `1.7` |

### Font pair

| Token | Value |
|---|---|
| `--w6w-font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--w6w-font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` |

That's 30 tokens total. Nothing else (colour, `--w6w-radius`, shadows,
transitions) is part of this scale — see `src/styles/_tokens.scss` for those.

## (b) Choosing a step, and what is deliberately NOT on this scale

**Whole steps for new code. A half-step is only for preserving an existing
measured value that does not sit on a 4px step** — never reach for
`--w6w-sp-0-5` / `--w6w-sp-1-5` / `--w6w-sp-2-5` when authoring something new.
They exist so a value-preserving substitution of `ui`'s pre-existing 6px/10px/2px
literals (a real, large cluster — see (d)) can happen without a visual redesign;
a genuinely new gap always rounds to a whole step.

**Box geometry is not on this scale.** Heights, widths, border widths, and
radii (`min-height`, `width`, `border-radius`, …) are a different concern —
several of them are load-bearing cross-component invariants (e.g. the
`min-height: 38px` shared by plain inputs, fx-wrapped fields, multiselects and
expr-fields) that must not be re-derived from a spacing token. `--w6w-radius`
lives in `_tokens.scss`, independent of this file. `lint:tokens` (see (f))
enforces this split mechanically: its property list is spacing/inset/type
roles only, and deliberately excludes `width`, `height`, `min-*`, `max-*`,
`flex-basis`, `border-*` and `border-radius`.

## (c) Breakpoints

```scss
$w6w-bp-sm: 640px !default;
$w6w-bp-md: 900px !default;
$w6w-bp-lg: 1200px !default;
```

These are **Sass variables**, declared in the same `_scale.scss` partial —
**not** CSS custom properties. `@media (min-width: var(--w6w-bp-md))` does not
work in any browser: a media query condition cannot read a custom property,
because custom properties resolve at computed-value time, after media queries
have already been evaluated. Sass variables resolve at compile time, before
the browser ever sees the stylesheet, so they work in a `@media` condition.
`!default` lets a Sass consumer override one without editing the partial:

```scss
@use "@w6w/ui/styles/scale" with ($w6w-bp-md: 960px);
```

**`ui` itself ships no layout media queries, deliberately.** These three
values exist purely so the rest of the codebase stops inventing its own
breakpoint (seven uncoordinated pixel values exist across the four repos
today). The host owns page layout; `ui` owns component internals only.
`ActionTestForm`'s embedded/pop-out split is a host-driven prop, not a
breakpoint, and stays that way — this is a deliberate boundary, not a gap to
fill later.

## (d) Source of truth

The values above are **mirrored, not invented**, from
[`packages/frontend/packages/web/src/styles/global.css:83-130`](../../frontend/packages/web/src/styles/global.css) —
that stylesheet independently arrived at the same 4px spacing base and the
same rem-based type ramp, and it stays the canonical source. `frontend/web`
keeps its own unprefixed `--sp-*` / `--fs-*` names; it has no `@w6w/ui`
dependency, so renaming its tokens to `--w6w-*` would be a lie about a
dependency that doesn't exist.

**Parity is directional: `ui` ⊇ `web`, on the shared key set** (`font-sans`,
`font-mono`, `fs-xs`…`fs-3xl`, `fw-*`, `lh-*`, `sp-1`…`sp-20`). Every one of
those `web` tokens has a byte-identical `--w6w-*` counterpart here. Two named
exceptions, in opposite directions:

- `--fs-hero`'s `clamp()` is **`web`-only** — a marketing-page concern (`ui`
  has no hero) — and is not mirrored here.
- The three half-steps (`--w6w-sp-0-5` / `-1-5` / `-2-5`) are **`ui`-only**
  additions `web` does not have (see (b)).

A parity check written as set *equality* between the two token sets would be
wrong; treat this paragraph, not equality, as the contract.

## (e) How a host overrides a token

Every token is declared inside one `:where(:root) { ... }` block. `:where()`
has **zero specificity**, so *any* host rule — even a bare `:root { ... }` —
wins the cascade without needing `!important`:

```css
:root {
  --w6w-sp-3: 10px; /* every .w6w-* component that used --w6w-sp-3 picks this up */
}
```

**`--w6w-fs-*` tokens are `rem`, i.e. root-relative — not relative to the
element's own or its parent's font-size.** A host that wants its whole
`.w6w-*` component tree to scale down cannot do it by setting `body {
font-size: 14px }` alone (studio's actual base size): `rem` always resolves
against the **root** (`<html>`) font-size, which a `body` rule does not touch.
To actually scale the type ramp, override the `--w6w-fs-*` tokens directly (or
set `font-size` on `:root`/`html`, which every `rem` value — including these
tokens — is relative to).

## (f) Running and updating the gate

```bash
pnpm lint:tokens                      # or: node scripts/lint-tokens.mjs
```

Scans every `.scss` file under `src/` for a hard-coded spacing/type literal
(a `padding`/`margin`/`gap`/inset-family/`font-size` value with a `px`/`rem`/
`em` unit; a bare numeric `font-weight`/`line-height`; a `font-family` value
that isn't `var(--w6w-font-sans)`, `var(--w6w-font-mono)`, or `inherit`) and
compares the count per file against a committed ratchet baseline
(`scripts/lint-tokens.baseline.json`). A genuinely new literal in a new or
modified line is a **regression** (exit 1) — either route it through a
`--w6w-*` token, or, if it truly can't be, mark it with a
`/* lint-tokens-allow: <reason> */` comment on the same line or the line
above. Removing an existing literal (tokenizing it) makes the baseline
**stale** (exit 2); regenerate it:

```bash
node scripts/lint-tokens.mjs --update
git add scripts/lint-tokens.baseline.json
```

The baseline may only shrink over time — `--update` is how a substitution
pass (e.g. the `ui` adoption that follows this doc) commits the smaller count
it earned.

**v1 limitation, named rather than silently dropped:** the gate scans `.scss`
only. It does not see inline `style={{ gap: 12 }}`-style literals in `.tsx`
files — `ui` alone has roughly 48 of those. Closing that gap is tracked in
`FOLLOWUPS.md` (D-g), not assumed away.
