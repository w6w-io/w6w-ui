import type { Meta, StoryObj } from "@storybook/react-vite";
import { JsonEditor } from "./JsonEditor.tsx";

const SAMPLE = JSON.stringify(
  { id: "fn_01H8", key: "send-customer-email", enabled: true },
  null,
  2,
);

/** Missing comma between the two lines — the gutter's lint marker shows. */
const INVALID = '{\n  "id": "fn_01H8"\n  "enabled": true\n}';

const meta = {
  title: "Components/JsonEditor",
  component: JsonEditor,
  argTypes: {
    theme: { control: "select", options: ["light", "dark"] },
    readOnly: { control: "boolean" },
    copyable: { control: "boolean" },
  },
  args: { value: SAMPLE, onChange: () => {} },
} satisfies Meta<typeof JsonEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Light: Story = {
  args: { theme: "light" },
};

export const Dark: Story = {
  args: { theme: "dark" },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
};

/** The in-box copy-to-clipboard button, sibling to the CodeMirror mount. */
export const Copyable: Story = {
  args: { copyable: true },
};

/** Malformed JSON — CodeMirror's lint gutter marks the error. */
export const InvalidJson: Story = {
  args: { value: INVALID },
};
