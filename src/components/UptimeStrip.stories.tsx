import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UptimeDay } from "./UptimeStrip.tsx";
import { UptimeStrip } from "./UptimeStrip.tsx";

const DAYS: UptimeDay[] = [
  { day: "2026-09-16", state: "ok" },
  { day: "2026-09-17", state: "ok" },
  { day: "2026-09-18", state: "degraded" },
  { day: "2026-09-19", state: "down" },
  { day: "2026-09-20", state: "ok" },
  { day: "2026-09-21", state: "unknown" },
  { day: "2026-09-22", state: "ok" },
];

const meta = {
  title: "Components/UptimeStrip",
  component: UptimeStrip,
  args: { days: DAYS },
} satisfies Meta<typeof UptimeStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A mix of all four day states across a week. */
export const Populated: Story = {};

/**
 * Renders nothing — no days to show. The wrapper div gives the story mount
 * smoke probe something to see even though the component itself returns
 * `null` (same idiom `ApiCallsPanel.stories.tsx`'s `Empty` uses).
 */
export const Empty: Story = {
  args: { days: [] },
  decorators: [
    (Story) => (
      <div data-testid="uptime-strip-empty">
        <Story />
      </div>
    ),
  ],
};
