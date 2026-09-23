import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmModal } from "./ConfirmModal.tsx";

// jsdom (this package's `node --test` story-mount smoke probe) has no
// `HTMLDialogElement.prototype.showModal`/`close` — the `Modal` this wraps
// calls `showModal()` unconditionally in a mount effect and would otherwise
// throw there. Real browsers (Storybook, production) already implement
// both, so this is a guarded no-op outside that probe. Same pattern this
// package's own `src/__tests__/*.test.ts` files apply locally for the
// identical gap (e.g. `StepBuilderModal.connection-only.test.ts`).
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
  title: "Components/ConfirmModal",
  component: ConfirmModal,
  argTypes: {
    destructive: { control: "boolean" },
  },
  args: {
    title: "Delete connection",
    message: "This can't be undone.",
    onConfirm: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof ConfirmModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** `destructive` defaults to `true` — this dialog gates dangerous actions. */
export const Destructive: Story = {
  args: { destructive: true },
};

export const NonDestructive: Story = {
  args: {
    destructive: false,
    title: "Leave without saving?",
    message: "Your edits are still here.",
  },
};

/** `children` carries consequence copy a plain string can't, e.g. a warning line. */
export const WithConsequences: Story = {
  args: {
    children: (
      <p className="w6w-error w6w-small">
        3 workflows reference this connection and will stop running.
      </p>
    ),
  },
};
