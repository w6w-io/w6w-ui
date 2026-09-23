/**
 * Storybook manager (chrome) branding for `@w6w/ui` (D-4) — the sidebar
 * header and toolbar, not the story canvas (`preview.tsx` themes that).
 *
 * Palette values are sourced from `packages/branding/tokens/tokens.json`
 * (`BRAND.md` §3), never invented ad hoc: `#3355E6` is `color.accent.light`.
 */
import { addons } from "storybook/manager-api";
import { create } from "storybook/theming/create";

addons.setConfig({
  theme: create({
    base: "light",
    brandTitle: "@w6w/ui",
    brandUrl: "https://w6w.io",
    brandImage:
      "https://raw.githubusercontent.com/w6w-io/w6w-branding/main/logo/svg/w6w-lockup.svg",
    colorPrimary: "#3355E6",
    colorSecondary: "#3355E6",
  }),
});
