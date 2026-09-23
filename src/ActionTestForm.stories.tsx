import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  SAMPLE_ACTIONS,
  SAMPLE_APPS,
  SAMPLE_CONNECTIONS,
  fakeApi,
} from "../.storybook/fixtures.ts";
import { ActionTestForm } from "./ActionTestForm.tsx";
import { W6WUIProvider } from "./provider.tsx";

const meta = {
  title: "Components/ActionTestForm",
  component: ActionTestForm,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <W6WUIProvider api={fakeApi()}>
        <Story />
      </W6WUIProvider>
    ),
  ],
  args: {
    appId: SAMPLE_APPS[0].id,
    actions: SAMPLE_ACTIONS,
    connectionId: SAMPLE_CONNECTIONS[0].id,
  },
} satisfies Meta<typeof ActionTestForm>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Non-embedded — renders its own `<Modal>` pop-out chrome. */
export const Default: Story = {};

/** Fills a host-owned container (studio's `ConnectionTesterModal`) instead of
 *  rendering its own modal + pop-out toggle. */
export const Embedded: Story = {
  args: { embedded: true },
};

export const Light: Story = {
  args: { theme: "light" },
};

export const Dark: Story = {
  args: { theme: "dark" },
};
