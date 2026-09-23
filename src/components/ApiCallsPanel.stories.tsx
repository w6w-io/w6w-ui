import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ApiCallRecord } from "../types.ts";
import { ApiCallsPanel } from "./ApiCallsPanel.tsx";

const CALLS: ApiCallRecord[] = [
  {
    host: "api.sendgrid.com",
    method: "POST",
    url: "https://api.sendgrid.com/v3/mail/send",
    status: 202,
    requestHeaders: { "content-type": "application/json" },
    requestBody: JSON.stringify({ to: "ada@example.com", subject: "Welcome" }),
    responseHeaders: { "x-message-id": "abc123" },
    durationMs: 214,
  },
  {
    host: "api.sendgrid.com",
    method: "GET",
    url: "https://api.sendgrid.com/v3/stats",
    status: 0,
    requestHeaders: {},
    error: "socket hang up",
    durationMs: 5012,
  },
];

const meta = {
  title: "Components/ApiCallsPanel",
  component: ApiCallsPanel,
  args: { calls: CALLS },
} satisfies Meta<typeof ApiCallsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Renders nothing at all — no calls captured for this run. The wrapper div
 * gives the story mount smoke probe something to see even though the
 * component itself returns `null` (same idiom `CodeBlock.stories.tsx`'s
 * `CustomPalette` uses a per-story `decorators` override for, just for a
 * different reason).
 */
export const Empty: Story = {
  args: { calls: [] },
  decorators: [
    (Story) => (
      <div data-testid="api-calls-panel-empty">
        <Story />
      </div>
    ),
  ],
};

export const Populated: Story = {};

/** Every call's `<details>` starts open, for a host that already scoped the list to one target. */
export const DefaultOpen: Story = {
  args: { defaultOpen: true },
};

/** `title: false` suppresses the section header entirely — the host owns its own heading. */
export const NoTitle: Story = {
  args: { title: false },
};
