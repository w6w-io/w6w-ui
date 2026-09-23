# Contributing to @w6w/ui

Thanks for taking a look. This repo is source-available under
[FSL-1.1-ALv2](LICENSE) (see the README's [License](README.md#license) section for what that means
in practice) — contributions are welcome under the same terms.

## Setup

```sh
git clone https://github.com/w6w-io/w6w-ui.git
cd w6w-ui
pnpm install
```

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile the Sass stylesheet, typecheck, and build the package (`build:css && tsc -b && vite build`) |
| `pnpm typecheck` | `tsc -b --noEmit` |
| `pnpm test` | Run the unit test suite |
| `pnpm lint` | `biome check .` |
| `pnpm lint:tokens` | Check new styles stay on the `--w6w-*` spacing/type scale (see [`docs/design-system.md`](docs/design-system.md)) |
| `pnpm coverage:stories` | Check that every exported component has a co-located `*.stories.tsx` file |
| `pnpm format` | `biome format --write .` |
| `pnpm storybook` | Dev server on `:6006` |
| `pnpm build-storybook` | Static Storybook build in `storybook-static/` (gitignored) |

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm coverage:stories` before
opening a PR — all five are expected to pass.

## Adding or changing a component

- **Every exported component ships with a co-located story**: `src/Foo.tsx` needs
  `src/Foo.stories.tsx` right beside it (never a separate `stories/` tree — see the README's
  [Storybook](README.md#storybook) section). `pnpm coverage:stories` enforces this; a new export
  with no story fails the check.
- Stories are excluded from the published package (`files` in `package.json`) and from the type
  emit — they're a dev-only artifact, so don't worry about their footprint.
- Public exports live in `src/index.ts`, `src/flow.ts` or `src/code.ts` — add your export to the
  entrypoint that matches its dependency weight (see the README's
  [Entrypoints](README.md#entrypoints) section for why there are three).

## Naming

- Components are `PascalCase`; hooks are `useCamelCase`; plain helper functions are `camelCase`.
- CSS custom properties stay under the `--w6w-*` namespace; public class names stay under `.w6w-*`
  (see the README's [Where the styles come from](README.md#where-the-styles-come-from) section).
- `W6W` in prose (docs, comments, commit messages); `w6w` in code, package names, and URLs.

## Sending a PR

1. Fork the repo and branch from `main`.
2. Make your change, keeping it focused.
3. Add or update a [`CHANGELOG.md`](CHANGELOG.md) entry under `## [Unreleased]`.
4. Open the PR against [`w6w-io/w6w-ui`](https://github.com/w6w-io/w6w-ui), not your fork.

## Reporting a security issue

Don't open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
