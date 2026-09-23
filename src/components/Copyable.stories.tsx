import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copyable } from "./Copyable.tsx";

const VALUE = "w6w_sk_live_4f2c9a1e8b7d3c6a";

const meta = {
  title: "Components/Copyable",
  component: Copyable,
  args: {
    value: VALUE,
    children: <code>{VALUE}</code>,
  },
} satisfies Meta<typeof Copyable>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Icon-only affordance — a click on the button copies `value`. */
export const Default: Story = {};

/** A click anywhere in the box copies too, not just the button. */
export const ReadOnly: Story = {
  args: { readOnly: true },
};
