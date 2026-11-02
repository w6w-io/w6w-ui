import {
  evaluate,
  expressionReferences,
  formatReadableExpression,
  parseReadableExpression,
} from "@w6w/expr";
import type { ExprPart } from "../types.ts";
import type { ExpressionOptions } from "./ExpressionOptions.tsx";
import {
  parseRootAnchoredTemplate,
  renderResult,
  serializeTemplate,
} from "./expression-template.ts";

const ROOTS = new Set([
  "nodes",
  "steps",
  "state",
  "var",
  "vars",
  "const",
  "inputs",
  "output",
  "trigger",
  "foreach",
  "documents",
]);
const OPERATOR = /[=<>]|!=|&&|\|\||\?\?/;
const hasOperator = (source: string) => OPERATOR.test(source) || /^\s*\(*\s*!/.test(source);
const hasComparisonRefs = (expr: unknown) => expressionReferences(expr).some(hasOperator);

function resolveAuthorRef(ref: string, options: ExpressionOptions): string {
  const [first, ...rest] = ref.split(".");
  if (first === "secrets")
    throw new Error("Secrets can be inserted into text, but cannot be used in comparisons.");
  if (ROOTS.has(first)) return ref;
  const candidates = [
    ...(options.steps?.some((step) => step.id === first) ? [`nodes.${first}.output`] : []),
    ...(options.vars?.includes(first) ? [`var.${first}`] : []),
    ...(options.constants?.includes(first) ? [`const.${first}`] : []),
  ];
  if (candidates.length > 1)
    throw new Error(`“${first}” is ambiguous. Select the field from the sources.`);
  if (candidates.length === 0)
    throw new Error(`Unknown field “${first}”. Select a source, or put text values in quotes.`);
  return [candidates[0], ...rest].join(".");
}

/** Compile an entire condition, including picker chips followed by typed operators. Plain
 * text/templates stay unchanged. The persisted value uses the existing JSONLogic wire format. */
export function compileAuthoredParts(
  original: ExprPart[],
  options: ExpressionOptions,
): { parts: ExprPart[]; error: string | null } {
  const unchanged = { parts: original, error: null };
  const parts = original.flatMap((part) =>
    part.kind === "text" ? parseRootAnchoredTemplate(part.value ?? "") : [part],
  );
  if (parts.some((part) => part.kind === "render")) return unchanged;
  // Already compiled: keep its exact AST (including legacy operators outside this syntax).
  if (parts.length === 1 && parts[0].kind === "expr" && !hasComparisonRefs(parts[0].expr))
    return { parts, error: null };
  let source = parts
    .map((part) => {
      if (part.kind === "text") return part.value ?? "";
      if (part.kind === "secret") return `{{ secrets.${part.ref ?? ""} }}`;
      if (part.kind === "expr") {
        // The older marker parser may have treated comparisons in a fallback chain
        // as variable names. Recover its infix text before compiling the condition.
        if (hasComparisonRefs(part.expr)) {
          const marker = serializeTemplate([part]);
          if (!marker.startsWith("{{ =")) return `(${marker.slice(2, -2).trim()})`;
        }
        const readable = formatReadableExpression(part.expr);
        return readable === null ? serializeTemplate([part]) : `(${readable})`;
      }
      // Repair old chips that accidentally stored the whole comparison as a field path.
      return hasOperator(part.ref ?? "") ? (part.ref ?? "") : `{{ ${part.ref ?? ""} }}`;
    })
    .join("")
    .trim();
  if (!hasOperator(source)) return unchanged;
  const wrapped = /^\{\{([^{}]+)\}\}$/.exec(source);
  if (wrapped && hasOperator(wrapped[1])) source = wrapped[1].trim();
  const start = source.replace(/^[\s(!]+/, "");
  const first = /^(?:\{\{\s*)?([A-Za-z_$][\w$-]*)/.exec(start)?.[1];
  const knownStart =
    start.startsWith("{{") ||
    (first !== undefined &&
      (ROOTS.has(first) ||
        first === "secrets" ||
        options.steps?.some((step) => step.id === first) ||
        options.vars?.includes(first) ||
        options.constants?.includes(first)));
  // Do not reinterpret ordinary prose/HTML that contains a reference and punctuation.
  if (!knownStart && !/^(?:["']|-?\d|true\b|false\b|null\b)/.test(start)) return unchanged;
  if (knownStart && !/^\s*\(*\s*!/.test(source)) {
    const operand = /^(?:\{\{[^{}]+\}\}|[A-Za-z_$][\w$-]*(?:\.[\w$-]+)*)/.exec(start)?.[0];
    if (operand) {
      const after = start.slice(operand.length).replace(/^[\s)]+/, "");
      // A selected field can also start a URL or a text template. Only a directly
      // following operator begins a condition; later punctuation is ordinary text.
      if (!/^(?:[=<>(]|!=|&&|\|\||\?\?)/.test(after) || /^<\/?[A-Za-z][^>]*>/.test(after))
        return unchanged;
    }
  }
  try {
    const expr = parseReadableExpression(source, (ref) => resolveAuthorRef(ref, options));
    return { parts: [{ kind: "expr", expr }], error: null };
  } catch (error) {
    return { parts, error: error instanceof Error ? error.message : "Check the expression." };
  }
}

/** Sample fields include those inside comparisons, not just standalone reference chips. */
export function authoredReferences(parts: ExprPart[]): string[] {
  return [
    ...new Set(
      parts.flatMap((part) =>
        part.kind === "expr"
          ? expressionReferences(part.expr)
          : (part.kind === "var" || part.kind === "render") && part.ref
            ? [part.ref]
            : [],
      ),
    ),
  ];
}

function canonical(ref: string): string {
  return ref.replace(/^(?:vars|state)(?=\.|$)/, "var").replace(/^steps(?=\.|$)/, "nodes");
}

function sampleRoot(samples: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  // Parents first, then explicit leaf samples override them. Copy each path before writing;
  // never mutate the host's test outputs. Secrets never enter the evaluator's sample scope.
  for (const [ref, value] of Object.entries(samples).sort(
    ([a], [b]) => a.split(".").length - b.split(".").length,
  )) {
    const keys = canonical(ref).split(".");
    if (
      !ROOTS.has(keys[0]) ||
      keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key))
    )
      continue;
    let target = root;
    for (const key of keys.slice(0, -1)) {
      const previous = target[key];
      const next = previous && typeof previous === "object" ? { ...previous } : {};
      target[key] = next;
      target = next;
    }
    target[keys[keys.length - 1]] = value;
  }
  root.steps = root.nodes;
  root.vars = root.var;
  root.state = root.var;
  return root;
}

/** Evaluate supported conditions with the same evaluator as workflow execution. Other legacy
 * expression forms keep their existing template preview. Explicit samples preserve JSON types. */
export function previewAuthoredParts(
  parts: ExprPart[],
  seeds: Record<string, unknown> = {},
  overrides: Record<string, string> = {},
): string {
  const samples = { ...seeds };
  for (const [ref, text] of Object.entries(overrides)) {
    try {
      samples[ref] = JSON.parse(text);
    } catch {
      samples[ref] = text;
    }
  }
  const root = sampleRoot(samples);
  const textSamples = Object.fromEntries(
    Object.entries(samples).map(([ref, value]) => [
      ref,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
  return parts
    .map((part) => {
      if (part.kind !== "expr" || formatReadableExpression(part.expr) === null)
        return renderResult([part], textSamples);
      const refs = expressionReferences(part.expr);
      if (refs.some((ref) => !ref || ref.split(".")[0] === "secrets")) return "••••";
      const value = evaluate(part.expr, root);
      return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    })
    .join("");
}
