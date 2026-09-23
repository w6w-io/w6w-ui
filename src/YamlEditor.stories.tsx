import type { Meta, StoryObj } from "@storybook/react-vite";
import { YamlEditor } from "./YamlEditor.tsx";

const SAMPLE = "services:\n  api:\n    image: denoland/deno:2.1.4 # pinned\n    ports: [8000]";

const meta = {
  title: "Components/YamlEditor",
  component: YamlEditor,
  argTypes: {
    theme: { control: "select", options: ["light", "dark"] },
    readOnly: { control: "boolean" },
    copyable: { control: "boolean" },
  },
  args: { value: SAMPLE, onChange: () => {} },
} satisfies Meta<typeof YamlEditor>;

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
