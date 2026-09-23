import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepStatusPill } from "./StepStatusPill.tsx";

const meta = {
  title: "Components/StepStatusPill",
  component: StepStatusPill,
  argTypes: {
    state: {
      control: "select",
      options: ["pending", "running", "succeeded", "failed", "skipped"],
    },
  },
  args: { state: "pending" },
} satisfies Meta<typeof StepStatusPill>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  args: { state: "pending" },
};

export const Running: Story = {
  args: { state: "running" },
};

export const Succeeded: Story = {
  args: { state: "succeeded" },
};

export const Failed: Story = {
  args: { state: "failed" },
};

export const Skipped: Story = {
  args: { state: "skipped" },
};
