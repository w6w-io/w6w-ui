import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExpressionInput } from "./ExpressionInput.tsx";
import { ExpressionOptionsProvider } from "./ExpressionOptions.tsx";

/**
 * `ExpressionOptionsProvider` renders no chrome of its own — it contributes
 * var/secret/step scope to every `ExpressionInput` below it. The child here
 * is an `ExpressionInput` (`useExpressionOptions()`'s one real consumer), so
 * the story proves the scope actually reaches it (open the insert menu).
 */
const meta = {
  title: "Components/ExpressionOptionsProvider",
  component: ExpressionOptionsProvider,
  args: {
    value: {
      vars: ["from_email", "api_key"],
      secrets: ["stripe_secret_key"],
      hasTrigger: true,
    },
    children: (
      <ExpressionInput
        value=""
        onChange={() => {}}
        placeholder="Type, or insert a var/secret ref…"
        aria-label="Sample expression field"
      />
    ),
  },
} satisfies Meta<typeof ExpressionOptionsProvider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
