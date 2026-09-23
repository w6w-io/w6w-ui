import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ExprValue, SecretValue } from "../types.ts";
import { ExpressionInput } from "./ExpressionInput.tsx";

const EXPR_VALUE: ExprValue = {
  type: "expr",
  parts: [
    { kind: "text", value: "Hi " },
    { kind: "var", ref: "firstName" },
  ],
};

/** An at-rest sealed secret — ciphertext, never decrypted client-side. */
const SECRET_VALUE: SecretValue = {
  type: "secret",
  ciphertext: "U2FsdGVkX19leGFtcGxlY2lwaGVydGV4dA==",
  iv: "ZXhhbXBsZWl2MTIzNA==",
};

const meta = {
  title: "Components/ExpressionInput",
  component: ExpressionInput,
  args: { value: "Hello, world", onChange: () => {} },
} satisfies Meta<typeof ExpressionInput>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A plain string value — the segmented editor with one text chunk. */
export const Default: Story = {};

/** An `ExprValue` envelope — a text segment plus a `var` chip. */
export const Expression: Story = {
  args: { value: EXPR_VALUE },
};

/** A sealed `SecretValue` — a single masked chip; ciphertext is never shown. */
export const Secret: Story = {
  args: { value: SECRET_VALUE, masked: true },
};

/** `masked` on a still-plain value — dots instead of characters, sealed on blur. */
export const Masked: Story = {
  args: { value: "unsealed-secret-text", masked: true },
};

/** `multiline` — Enter inserts a literal line break instead of being swallowed. */
export const Multiline: Story = {
  args: { value: "Line one\nLine two", multiline: true },
};

/** Non-editable — the field renders but accepts no input. */
export const ReadOnly: Story = {
  args: { readOnly: true },
};
