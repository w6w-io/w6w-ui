import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppIcon } from "./AppIcon.tsx";

/** Inline SVGs, never network URLs — a light-mode dark disc and a dark-mode light disc. */
const LIGHT_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%23111827'/%3E%3C/svg%3E";
const DARK_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%23f9fafb'/%3E%3C/svg%3E";

const meta = {
  title: "Components/AppIcon",
  component: AppIcon,
} satisfies Meta<typeof AppIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { src: LIGHT_SVG },
};

/** `theme="light"` with distinct `src`/`srcDark` — renders `src`. */
export const Light: Story = {
  args: { theme: "light", src: LIGHT_SVG, srcDark: DARK_SVG },
};

/** `theme="dark"` with distinct `src`/`srcDark` — renders `srcDark`. */
export const Dark: Story = {
  args: { theme: "dark", src: LIGHT_SVG, srcDark: DARK_SVG },
};

/** No `src` at all — falls back to an initials tile from `name` + `brandColor`. */
export const Fallback: Story = {
  args: { name: "SendGrid", brandColor: "#1a82e2" },
};
