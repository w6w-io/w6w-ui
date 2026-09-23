import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HistoryWindow, VendorIncidentBar } from "./HistoryTimeline.tsx";
import { HistoryTimeline } from "./HistoryTimeline.tsx";
import type { UptimeDay } from "./UptimeStrip.tsx";

const WINDOW: HistoryWindow = { from: "2026-09-16", to: "2026-09-22" };

const DAYS: UptimeDay[] = [
  { day: "2026-09-16", state: "ok" },
  { day: "2026-09-17", state: "ok" },
  { day: "2026-09-18", state: "degraded" },
  { day: "2026-09-19", state: "down" },
  { day: "2026-09-20", state: "ok" },
  { day: "2026-09-21", state: "ok" },
  { day: "2026-09-22", state: "ok" },
];

const INCIDENTS: VendorIncidentBar[] = [
  {
    id: "inc_1",
    title: "Elevated error rates",
    state: "degraded",
    startedAt: "2026-09-18T09:00:00Z",
    resolvedAt: "2026-09-18T11:30:00Z",
    components: ["API"],
  },
  {
    id: "inc_2",
    title: "Partial outage",
    state: "down",
    startedAt: "2026-09-19T02:00:00Z",
    resolvedAt: "2026-09-19T04:00:00Z",
  },
];

// Fixed clock so the open-incident clip math never depends on wall-clock time.
const NOW_MS = Date.parse("2026-09-22T23:59:59Z");

const meta = {
  title: "Components/HistoryTimeline",
  component: HistoryTimeline,
  args: { window: WINDOW, days: DAYS, nowMs: NOW_MS },
} satisfies Meta<typeof HistoryTimeline>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithIncidents: Story = {
  args: { incidents: INCIDENTS },
};

/** `incidents` left `undefined` — this vendor publishes no incident history at all. */
export const NoIncidentHistory: Story = {
  args: { incidents: undefined },
};
