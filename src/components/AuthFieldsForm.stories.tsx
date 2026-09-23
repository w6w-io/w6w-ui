import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AuthField } from "../types.ts";
import { AuthFieldsForm } from "./AuthFieldsForm.tsx";

const FIELDS: AuthField[] = [
  { key: "apiKey", label: "API Key", type: "secret", required: true },
  { key: "domain", label: "Domain", type: "string", hint: "Your account subdomain." },
  { key: "sandbox", label: "Use sandbox", type: "boolean", default: false },
];

const VALUES: Record<string, unknown> = {
  apiKey: "sk_live_example",
  domain: "acme",
  sandbox: false,
};

const meta = {
  title: "Components/AuthFieldsForm",
  component: AuthFieldsForm,
  args: { fields: FIELDS, values: VALUES, onChange: () => {} },
} satisfies Meta<typeof AuthFieldsForm>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No enum/disabled axis on this component — one field per declared type
 *  (secret, string, boolean) covers its whole render surface. */
export const Default: Story = {};
