import type { Meta, StoryObj } from "@storybook/react-vite";
import { PropertyEntryForm } from "./PropertyEntryForm.tsx";
import type { ActionParam } from "./types.ts";

const PARAMS: ActionParam[] = [
  { key: "to", label: "To", type: "string", required: true },
  { key: "subject", label: "Subject", type: "string" },
];

const VALUES: Record<string, unknown> = { to: "ada@example.com", subject: "Welcome" };

const meta = {
  title: "Components/PropertyEntryForm",
  component: PropertyEntryForm,
  args: {
    params: PARAMS,
    values: VALUES,
    onChange: () => {},
  },
} satisfies Meta<typeof PropertyEntryForm>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The fields view — {@link ParamsForm} reused as-is, per-field `ƒx` included. */
export const PropsView: Story = {
  args: { initialView: "props" },
};

/** The raw-JSON view over the same `values` object. */
export const CodeView: Story = {
  args: { initialView: "code" },
};

/** Both views render disabled/non-editable. */
export const ReadOnly: Story = {
  args: { readOnly: true },
};

/** No declared params (a webhook trigger, an action with no schema) — the
 *  toggle hides and the raw-JSON view is the only view, labeled "Payload". */
export const RawJsonOnly: Story = {
  args: { params: [], values: { event: "order.created", amount: 4200 } },
};
