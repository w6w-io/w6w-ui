import type { Meta, StoryObj } from "@storybook/react-vite";
import { SAMPLE_APPS, fakeApi } from "../.storybook/fixtures.ts";
import { StepBuilderModal } from "./StepBuilderModal.tsx";
import { W6WUIProvider } from "./provider.tsx";

/**
 * `StepBuilderModal`'s home tab ("Ready to use") calls `listConnections`,
 * `listFunctions` AND `listWorkflows` unconditionally on every mount
 * (`useReadyToUse`, not just when the Functions/Workflows tab is open), so
 * every story here — not only `Functions`/`Workflows` — needs the fixture's
 * default (non-empty) `fakeApi()`.
 */
const meta = {
  title: "Components/StepBuilderModal",
  component: StepBuilderModal,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <W6WUIProvider api={fakeApi()}>
        <Story />
      </W6WUIProvider>
    ),
  ],
  args: {
    onClose: () => {},
    onAdd: () => undefined,
  },
} satisfies Meta<typeof StepBuilderModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default homepage tab: connected apps + Functions + Workflows. */
export const Connected: Story = {
  args: { initialTab: "connected" },
};

export const Functions: Story = {
  args: { initialTab: "functions" },
};

export const Workflows: Story = {
  args: { initialTab: "workflows" },
};

/** Graph-only tabs (Triggers/Controls/Utilities/Data) hidden. */
export const AppsOnly: Story = {
  args: { appsOnly: true },
};

/** Stops at "a connection is chosen" — no Action, no Configure/Test. */
export const ConnectionOnly: Story = {
  args: { connectionOnly: true, initialApp: SAMPLE_APPS[0] },
};

export const Light: Story = {
  args: { theme: "light" },
};

export const Dark: Story = {
  args: { theme: "dark" },
};
