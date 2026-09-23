import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParamsForm } from "./ParamsForm.tsx";
import type { ActionParam } from "./types.ts";

/** A mixed set — a required string, a number, a boolean and a select — enough
 *  to exercise every scalar widget `ParamField` dispatches to. */
const PARAMS: ActionParam[] = [
  { key: "name", label: "Name", type: "string", required: true },
  { key: "count", label: "Count", type: "number", default: 1 },
  { key: "enabled", label: "Enabled", type: "boolean", default: false },
  {
    key: "method",
    label: "Method",
    type: "select",
    options: [
      { value: "GET", label: "GET" },
      { value: "POST", label: "POST" },
    ],
    default: "GET",
  },
];

const VALUES: Record<string, unknown> = {
  name: "Ada Lovelace",
  count: 3,
  enabled: true,
  method: "POST",
};

const meta = {
  title: "Components/ParamsForm",
  component: ParamsForm,
  argTypes: {
    readOnly: { control: "boolean" },
  },
  args: {
    params: PARAMS,
    values: VALUES,
    onChange: () => {},
  },
} satisfies Meta<typeof ParamsForm>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A required string, a number, a boolean and a select, all with values set. */
export const Default: Story = {};

/** Every widget renders disabled/non-editable. */
export const ReadOnly: Story = {
  args: { readOnly: true },
};

/** No declared params — the "This action takes no parameters." fallback. */
export const Empty: Story = {
  args: { params: [], values: {} },
};
