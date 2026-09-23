import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyableText } from "./CopyableText.tsx";

const VALUE = "wf_01H8QK3M9V2R7T5N6PABCDXYZ";

const meta = {
  title: "Components/CopyableText",
  component: CopyableText,
  args: { value: VALUE, chars: 12 },
} satisfies Meta<typeof CopyableText>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Marker leads — keeps the trailing `chars` characters of `value`. */
export const CropStart: Story = {
  args: { crop: "start" },
};

/** Marker trails — keeps the leading `chars` characters of `value`. */
export const CropEnd: Story = {
  args: { crop: "end" },
};

/** Marker sits between head and tail halves of `chars`. */
export const CropMiddle: Story = {
  args: { crop: "middle" },
};
