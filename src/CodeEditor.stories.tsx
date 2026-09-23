import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeEditor } from "./CodeEditor.tsx";

const JS_SNIPPET = "function greet(name) {\n  return `Hello, ${name}!`;\n}";
const PY_SNIPPET = 'def greet(name):\n    return f"Hello, {name}!"';

const meta = {
  title: "Components/CodeEditor",
  component: CodeEditor,
  argTypes: {
    language: { control: "select", options: ["javascript", "python"] },
    theme: { control: "select", options: ["light", "dark"] },
    readOnly: { control: "boolean" },
  },
  args: { value: JS_SNIPPET, language: "javascript", onChange: () => {} },
} satisfies Meta<typeof CodeEditor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const JavaScript: Story = {};

export const Python: Story = {
  args: { value: PY_SNIPPET, language: "python" },
};

export const Light: Story = {
  args: { theme: "light" },
};

export const Dark: Story = {
  args: { theme: "dark" },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
};
