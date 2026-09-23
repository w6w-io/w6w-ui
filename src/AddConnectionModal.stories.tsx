import type { Meta, StoryObj } from "@storybook/react-vite";
import { SAMPLE_APPS, fakeApi, neverResolves } from "../.storybook/fixtures.ts";
import { AddConnectionModal } from "./AddConnectionModal.tsx";
import { W6WUIProvider } from "./provider.tsx";

/**
 * Stories the API-key credential path only (building-blocks §1.4): the OAuth
 * branch opens a real `window.open` popup and awaits a `postMessage` — out of
 * scope here, per the dispatch. `getAppAuth` rejection renders `.w6w-error`
 * via `AddConnectionModal.tsx`'s own `setError((e as Error).message)`.
 */
const meta = {
  title: "Components/AddConnectionModal",
  component: AddConnectionModal,
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
    onCreated: () => {},
  },
} satisfies Meta<typeof AddConnectionModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Step one: the shared searchable app picker. */
export const Default: Story = {};

/** Opened for a specific app — skips the picker, straight to the API-key form. */
export const InitialApp: Story = {
  args: { initialAppId: SAMPLE_APPS[0].id },
};

/** `getAppAuth` never resolves — the "Loading auth methods…" state. */
export const Loading: Story = {
  args: { initialAppId: SAMPLE_APPS[0].id },
  decorators: [
    (Story) => (
      <W6WUIProvider api={fakeApi({ getAppAuth: () => neverResolves() })}>
        <Story />
      </W6WUIProvider>
    ),
  ],
};

/** `getAppAuth` rejects — the error renders as `.w6w-error`. */
export const AuthLoadError: Story = {
  args: { initialAppId: SAMPLE_APPS[0].id },
  decorators: [
    (Story) => (
      <W6WUIProvider
        api={fakeApi({
          getAppAuth: () => Promise.reject(new Error("Failed to load auth methods.")),
        })}
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
