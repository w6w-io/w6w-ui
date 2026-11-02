import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ExpressionEditorModal } from "../../src/components/ExpressionEditorModal.tsx";
import { ExpressionInput } from "../../src/components/ExpressionInput.tsx";
import type { ExprValue } from "../../src/types.ts";

const ref = "nodes.order_merge.output.order.context.source";
const options = {
  steps: [{
    id: "order_merge",
    outputs: [{ key: "order.context.source", path: true }],
  }],
  vars: ["source"],
  sampleValues: { [ref]: "eventbrite", "var.source": "eventbrite" },
};
const fixture = new URLSearchParams(location.search).get("v");
const initial = fixture === "broken" ? `{{ ${ref} == 'eventbrite' }}` : "";

function App() {
  const [value, setValue] = useState<string | ExprValue>(initial);
  const [open, setOpen] = useState(fixture !== "inline");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open expression
      </button>
      <output data-testid="saved">{JSON.stringify(value)}</output>
      {fixture === "inline" && (
        <ExpressionInput
          value={value}
          options={options}
          onChange={(next) => {
            if (typeof next === "string" || next.type === "expr") {
              setValue(next);
            }
          }}
          aria-label="inline expression"
        />
      )}
      {open && (
        <ExpressionEditorModal
          value={value}
          options={options}
          onSave={setValue}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
