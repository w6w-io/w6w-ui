# Light/dark mode — the embedding contract

Color tokens (`--w6w-panel`, `--w6w-accent`, etc.) are covered in the
[README](../README.md#theming); the spacing/type scale is
[`design-system.md`](design-system.md). This doc is specifically about
**which mode** (light vs dark) those tokens resolve to, and how a host
embedding `@w6w/ui` inside its own app controls that — added 2026-08-24
after a real embedding bug (see "The trap" below).

## The default, standalone

`styles.css` ships a complete light AND dark palette. With nothing else set,
it resolves like this, in order:

1. `data-theme="light"` or `data-theme="dark"` on **any ancestor** element —
   `styles.css`'s rules for this are written with `:where(...)` (zero
   specificity), so this always wins over the OS default below without
   needing `!important`.
2. Otherwise, the visitor's OS `prefers-color-scheme`.

This is the right default for `@w6w/ui`'s own app (studio) — it manages
`data-theme` on `<html>` itself (a `ThemeToggle` control, `ThemeContext.tsx`),
so it's always in the "ancestor set it" branch above, on purpose.

The same two-step order is also what the **JS-side** theme-aware components
(`AppIcon`, `CodeEditor`, `JsonEditor`, `WorkflowFlowEditor` — via
`useEffectiveTheme` in `src/theme.ts`) resolve, so a component's rendered
markup and its own internal light/dark branches (e.g. `AppIcon`'s
`src`/`srcDark` choice) never disagree with each other.

## The trap

A host that embeds `@w6w/ui` components inside its **own** page — not
studio, a different app entirely — very likely has its own theme system
already, and very likely does **not** set `data-theme` anywhere (why would
it? nothing told it to). In that case `@w6w/ui` falls straight through to
step 2 above: the visitor's OS preference, **independent of whatever theme
the host's own page is using**.

Concretely: a visitor with a dark-mode OS setting, on an otherwise
light-themed host page, gets `@w6w/ui` components — icon swatches, modals,
buttons — rendered in `@w6w/ui`'s own dark palette, sitting inside the
host's light page. This is exactly the bug that prompted this doc (cohost's
dashboard, 2026-08-24): a screenshot showed black icon-swatch backgrounds
against an otherwise light page, and the root cause was precisely this — no
`data-theme` anywhere in cohost's tree, an OS dark preference, and `@w6w/ui`
quietly doing what its own default says to do.

## The fix: `<W6WUIProvider theme>`

`W6WUIProvider` (`src/provider.tsx`) — the provider every host wraps its
`@w6w/ui`-consuming subtree in anyway, to supply the `W6WApi` client — now
takes an optional `theme` prop:

```tsx
import { W6WUIProvider } from "@w6w/ui";

<W6WUIProvider api={api} theme={hostThemeMode /* "light" | "dark" */}>
  <YourApp />
</W6WUIProvider>
```

Passing it does two things at once, so the CSS and the JS-side components
can never drift from each other:

- Wraps `children` in a `data-theme={theme}` DOM node (`display: contents`,
  invisible to layout) — every `styles.css` rule picks this up via ordinary
  CSS custom-property inheritance, no matter how deep the actual component
  renders.
- Provides the same value through a `ProvidedThemeCtx` (`src/theme.ts`) that
  `useEffectiveTheme` now checks **before** falling back to `data-theme` on
  `<html>` / OS preference — so `AppIcon` and friends read it too, not just
  the stylesheet.

Full resolution order, most to least specific:

1. An explicit `theme` prop on the individual component itself (`AppIcon
   theme="dark"`, etc.) — unchanged, still wins over everything.
2. `<W6WUIProvider theme>` — **new**.
3. `data-theme` on `<html>` (or any ancestor, for the CSS half).
4. The OS `prefers-color-scheme`.

Omitting `theme` on `W6WUIProvider` keeps the exact old behavior (steps 3–4
only) — this is additive, not a breaking change. Studio itself does not pass
it, since it already owns `data-theme` on `<html>` directly.

## Recommendation for embedders

If your app has its own resolved theme (light-only, dark-only, or a toggle),
pass it to `<W6WUIProvider theme={...}>`. Don't rely on your host page
happening to also set `data-theme` on `<html>` — that works, but it's an
implicit coupling to `@w6w/ui`'s internals your own app has no reason to know
about; the explicit prop is the supported contract.
