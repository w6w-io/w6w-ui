import type { Meta, StoryObj } from "@storybook/react-vite";
import { HealthStatusPill } from "./HealthStatusPill.tsx";

const meta = {
  title: "Components/HealthStatusPill",
  component: HealthStatusPill,
  argTypes: {
    state: { control: "select", options: ["ok", "degraded", "down", "unknown"] },
  },
  args: { state: "ok" },
} satisfies Meta<typeof HealthStatusPill>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ok: Story = {
  args: { state: "ok" },
};

export const Degraded: Story = {
  args: { state: "degraded" },
};

export const Down: Story = {
  args: { state: "down" },
};

export const Unknown: Story = {
  args: { state: "unknown" },
};
