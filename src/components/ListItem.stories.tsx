import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListItem } from "./ListItem.tsx";

const meta = {
  title: "Components/ListItem",
  component: ListItem,
  args: {
    title: "sendgrid",
    subtitle: "Transactional email",
  },
} satisfies Meta<typeof ListItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Highlights the row as selected/current. */
export const Active: Story = {
  args: { active: true },
};

export const WithIconAndTrailing: Story = {
  args: {
    icon: <span aria-hidden="true">🟢</span>,
    trailing: <span className="w6w-muted w6w-small">v3</span>,
  },
};
