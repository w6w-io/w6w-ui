import type { Meta, StoryObj } from "@storybook/react-vite";
import { Modal } from "./Modal.tsx";

// jsdom (this package's `node --test` story-mount smoke probe) has no
// `HTMLDialogElement.prototype.showModal`/`close` — `Modal`'s mount effect
// calls `showModal()` unconditionally and would otherwise throw there. Real
// browsers (Storybook, production) already implement both, so this is a
// guarded no-op outside that probe. Same pattern this package's own
// `src/__tests__/*.test.ts` files apply locally for the identical gap (e.g.
// `StepBuilderModal.connection-only.test.ts`).
const dialogProto = (typeof window === "undefined" ? undefined : window.HTMLDialogElement)
  ?.prototype as unknown as Record<string, unknown> | undefined;
if (dialogProto && typeof dialogProto.showModal !== "function") {
  dialogProto.showModal = function showModal(this: { open: boolean }) {
    this.open = true;
  };
  dialogProto.close = function close(this: { open: boolean }) {
    this.open = false;
  };
}

const meta = {
  title: "Components/Modal",
  component: Modal,
  argTypes: {
    size: {
      control: "select",
      options: ["default", "wide", "xl", "full", "fullscreen"],
    },
  },
  args: {
    title: "Connection settings",
    onClose: () => {},
    children: <p className="w6w-muted w6w-small">Modal body content.</p>,
  },
} satisfies Meta<typeof Modal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { size: "default" },
};

/** Fits a sidebar + content layout. */
export const Wide: Story = {
  args: { size: "wide" },
};

/** A large work surface, e.g. the app picker. */
export const Xl: Story = {
  args: { size: "xl" },
};

/** A near-fullscreen work surface, e.g. the expression editor. */
export const Full: Story = {
  args: { size: "full" },
};

/**
 * Edge-to-edge with no visible backdrop, so outside-click dismissal is
 * unreachable — `headerRight` carries a visible close affordance instead.
 */
export const Fullscreen: Story = {
  args: {
    size: "fullscreen",
    headerRight: (
      <button type="button" className="w6w-btn w6w-btn-ghost">
        Close
      </button>
    ),
  },
};
