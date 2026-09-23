import type { Meta, StoryObj } from "@storybook/react-vite";
import { RepoSyncIndicator } from "./RepoSyncIndicator.tsx";

const meta = {
  title: "Components/RepoSyncIndicator",
  component: RepoSyncIndicator,
  args: {
    branch: "main",
    onSyncNow: () => {},
  },
} satisfies Meta<typeof RepoSyncIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Synced: Story = {
  args: { shortSha: "a1b2c3d", lastSyncLabel: "3/9/2026, 12:16:29 PM" },
};

/** No sha, no last-sync time — the repo has never synced. */
export const NeverSynced: Story = {
  args: { shortSha: null, lastSyncLabel: null },
};

export const Syncing: Story = {
  args: { shortSha: "a1b2c3d", lastSyncLabel: "3/9/2026, 12:16:29 PM", syncing: true },
};
