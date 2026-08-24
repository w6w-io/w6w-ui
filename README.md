# @w6w/ui

React components for [w6w](https://github.com/w6w-io), a workflow platform. Ships components used by the reference studio and available for any partner app that talks to a w6w server.

## Install

```sh
npm install @w6w/ui
```

## Usage

The components are **pure presentation** — you pass in data and handlers, so you can wire them to whatever API client and state management you already use.

```tsx
import { AddConnectionModal } from "@w6w/ui";
import "@w6w/ui/styles.css";

<AddConnectionModal
  apps={apps}
  getAppAuth={(appId) => api.getAppAuth(appId)}
  createConnection={(appId, body) => api.createConnection(appId, body)}
  startOAuthFlow={(appId, authKey, body) => api.startAppOAuthFlow(appId, authKey, body)}
  onClose={() => setModalOpen(false)}
  onCreated={() => refetch()}
/>
```

One component breaks the "pure presentation" rule above on purpose: `Copyable` performs a real
browser side effect — it writes to `navigator.clipboard`. Decorate any value-displaying control
(an `<input>`, a `<textarea>`, or a `<CodeBlock>`) with an in-box copy affordance; in read-only mode
a click anywhere in the box copies too, not just the icon.

```tsx
import { CodeBlock, Copyable } from "@w6w/ui";

<Copyable value={apiKey} readOnly>
  <input readOnly value={apiKey} />
</Copyable>

<CodeBlock code={curlSnippet} language="bash" copyable />
```

### Entrypoints

Three, so you only resolve what you use. This matters more than bundle size: the root index
imports `@w6w/expr` and CodeMirror, and a bundler resolves before it tree-shakes, so a consumer
without those in its tree fails to *build*, not merely to slim down.

| Import | Contains | Stylesheet |
|--------|----------|------------|
| `@w6w/ui` | everything except the flow editor | `@w6w/ui/styles.css` (69 KB) |
| `@w6w/ui/flow` | `WorkflowFlowEditor` — pulls in `@xyflow/react` | `@w6w/ui/styles.css` |
| `@w6w/ui/code` | `CodeBlock` + `Copyable` — needs only React and `prism-react-renderer` | `@w6w/ui/code.css` (13 KB) |

`code.css` is a strict subset of `styles.css`, so importing both is harmless — the rules are
byte-identical. Reach for `@w6w/ui/code` when you want the highlighter in something that is not a
full w6w console; the marketing site (`packages/frontend`) renders its homepage snippets that way,
at build time, shipping no React at all.

```tsx
import { CodeBlock } from "@w6w/ui/code";
import "@w6w/ui/code.css";
```

## Theming

`styles.css` defines defaults for CSS custom properties under the `--w6w-*` namespace (`--w6w-panel`, `--w6w-border`, `--w6w-text`, `--w6w-muted`, `--w6w-accent`, `--w6w-danger`, `--w6w-radius`). Override them at `:root` (or any parent) to theme the components.

```css
:root {
  --w6w-panel: #ffffff;
  --w6w-accent: #6b46c1;
}
```

The same `--w6w-*` namespace also carries a spacing and typography scale — the `--w6w-sp-*` / `--w6w-fs-*` / `--w6w-font-*` families (plus `--w6w-fw-*` weights and `--w6w-lh-*` line-heights), overridable the same way. See [`docs/design-system.md`](docs/design-system.md) for the full ramp, the half-step rule, and how to run the `lint:tokens` gate that keeps new code on it.

### Light/dark mode

Every color token above ships in both a light and a dark variant; without any
override, `@w6w/ui` picks between them by following the visitor's OS
`prefers-color-scheme` — which is **independent of whatever theme your own
app is using**. If you're embedding these components inside a host app that
has its own theme, pass it explicitly:

```tsx
<W6WUIProvider api={api} theme="light">
  <YourApp />
</W6WUIProvider>
```

Omit it and `@w6w/ui` may render in a different mode than the page around
it. See [`docs/theming.md`](docs/theming.md) for the full resolution order
and why this trips up embedders specifically (not studio, which manages
`data-theme` itself).

### Where the styles come from

The stylesheet is authored in **Sass**: `src/styles.scss` is the entry point and `src/styles/*.scss`
holds one partial per component family. `src/styles.css` is compiled from those (`pnpm build:css`)
and committed, so `import "@w6w/ui/styles.css"` above needs no Sass toolchain on your side — that
stays the supported way in.

If you *do* build with Sass, you can import the source instead and get the partials as
`@use`-able modules:

```scss
@use "@w6w/ui/styles.scss";   // the whole stylesheet
@use "@w6w/ui/styles/health"; // or one family — see src/styles/ for the list
```

Editing `src/styles.css` by hand has no effect — it is regenerated, and `pnpm check:css` fails when
it has drifted from the Sass sources. Two things stay fixed on purpose: `--w6w-*` remain **CSS**
custom properties (Sass variables would compile away before you could override them at runtime), and
`.w6w-*` class names are part of the public surface, which is why this ships as one global
stylesheet rather than CSS Modules.

## Storybook

```sh
pnpm storybook         # dev server on :6006
pnpm build-storybook   # static build in storybook-static/ (gitignored)
```

Stories live **beside their component** (`src/CodeBlock.stories.tsx`), never in a separate
`stories/` tree, so one cannot drift from the other; `.storybook/main.ts` globs
`../src/**/*.stories.tsx` and nothing else. There are deliberately no scaffolded Button/Header/Page
examples — every entry in the sidebar is a real component of this library. Only `CodeBlock` is
covered so far.

The toolbar's **Theme** switch sets `data-theme` on the canvas, which is the same signal the
components and `styles.scss` read, so a story is exercising the real theming contract. The preview
imports `src/styles.scss` (the authored source) rather than the compiled CSS, so editing a partial
under `src/styles/` hot-reloads.

Stories are excluded from the published tarball (`files`) and from the `.d.ts` emit.

## License

**FSL-1.1-ALv2** — the [Functional Source License](LICENSE), which converts to Apache 2.0 two years
after each version is released.

In plain terms: build whatever you like on these components — plugins, apps, integrations, internal
tools, client work, commercial products. The one carve-out is **Competing Use**: you may not use them
to offer a product or service that substitutes for w6w or for something we build with them.

`@w6w/expr` and `@w6w/types`, which this package depends on, stay **MIT** — the expression grammar
and the shared model are deliberately permissive so anything can read and write w6w's formats.
