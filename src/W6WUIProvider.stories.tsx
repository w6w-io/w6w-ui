import type { Meta, StoryObj } from "@storybook/react-vite";
import { fakeApi } from "../.storybook/fixtures.ts";
import { W6WUIProvider } from "./provider.tsx";

/**
 * `W6WUIProvider` renders no chrome of its own — it just provides the API
 * client (and, when `theme` is set, forces `@w6w/ui`'s theme via a
 * `data-theme` wrapper). So each story is a placeholder child under a
 * different `theme`, the provider's own enum prop — the thing this story
 * actually exercises.
 */
const meta = {
  title: "Components/W6WUIProvider",
  component: W6WUIProvider,
  args: {
    api: fakeApi(),
    children: (
      <p className="w6w-muted w6w-small">
        Content rendered under <code>W6WUIProvider</code>.
      </p>
    ),
  },
  argTypes: {
    theme: { control: "select", options: ["light", "dark"] },
  },
} satisfies Meta<typeof W6WUIProvider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Light: Story = {
  args: { theme: "light" },
};

export const Dark: Story = {
  args: { theme: "dark" },
};
