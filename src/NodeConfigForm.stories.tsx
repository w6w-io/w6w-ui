import type { Meta, StoryObj } from "@storybook/react-vite";
import { type NodeConfig, NodeConfigForm } from "./NodeConfigForm.tsx";

const BASE: NodeConfig = { notes: "Sends the welcome email." };

const WITH_RETRY: NodeConfig = {
  ...BASE,
  retry: { maxAttempts: 3, delayMs: 1000, backoff: "exponential" },
};

const meta = {
  title: "Components/NodeConfigForm",
  component: NodeConfigForm,
  args: { config: BASE, onChange: () => {} },
} satisfies Meta<typeof NodeConfigForm>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Retry off, "Stop the run" on error, a note — the graph-host default. */
export const Default: Story = {};

/** Every control renders disabled/non-editable. */
export const ReadOnly: Story = {
  args: { readOnly: true },
};

/** `config.retry` set — the attempts/delay/backoff row shows. */
export const WithRetry: Story = {
  args: { config: WITH_RETRY },
};

/** A graph-less host (a Function/Endpoint) — no canvas, so no outgoing error
 *  edge; `continue-record` drops out of the "On error" select. */
export const NoGraph: Story = {
  args: { hasGraph: false },
};

/** A node that cannot fail on its own (a trigger) — retry + "On error" drop,
 *  Notes stays. */
export const NoFailureHandling: Story = {
  args: { failureHandling: false },
};
