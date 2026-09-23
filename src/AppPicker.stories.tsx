import type { Meta, StoryObj } from "@storybook/react-vite";
import { SAMPLE_APPS, fakeApi, neverResolves } from "../.storybook/fixtures.ts";
import { AppPicker } from "./AppPicker.tsx";
import { W6WUIProvider } from "./provider.tsx";

const meta = {
  title: "Components/AppPicker",
  component: AppPicker,
  decorators: [
    (Story) => (
      <W6WUIProvider api={fakeApi()}>
        <Story />
      </W6WUIProvider>
    ),
  ],
  args: {
    onSelectApp: () => {},
  },
} satisfies Meta<typeof AppPicker>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No `apps` prop — the legacy eager `listApps()` fetch path (`listAppsPage`
 *  is omitted from the shared fixture, so this is always the path taken). */
export const Default: Story = {};

/** Caller already holds the list — the `apps` prop suppresses the fetch. */
export const Preloaded: Story = {
  args: { apps: SAMPLE_APPS },
};

/** An empty, resolved catalog with a custom empty message. */
export const Empty: Story = {
  args: { apps: [], emptyMessage: "No apps registered yet." },
};

/** `listApps` never resolves — the "Loading apps…" state. */
export const Loading: Story = {
  decorators: [
    (Story) => (
      <W6WUIProvider api={fakeApi({ listApps: () => neverResolves() })}>
        <Story />
      </W6WUIProvider>
    ),
  ],
};

/** `listApps` rejects. */
export const LoadError: Story = {
  decorators: [
    (Story) => (
      <W6WUIProvider
        api={fakeApi({ listApps: () => Promise.reject(new Error("Failed to load apps.")) })}
      >
        <Story />
      </W6WUIProvider>
    ),
  ],
};

export const Light: Story = {
  args: { theme: "light" },
};

export const Dark: Story = {
  args: { theme: "dark" },
};
