/** Exact-span edit apply + lightweight JSON schema validate (ported from Deliberate). */

export type JsonSchema =
  | { type: "string"; enum?: string[] }
  | { type: "boolean" }
  | { type: "integer"; minimum?: number }
  | { type: "array"; items: JsonSchema; minItems?: number }
  | {
      type: "object";
      properties: Record<string, JsonSchema>;
      required: string[];
      additionalProperties: false;
    }
  | { anyOf: JsonSchema[] };

export interface ExactEdit {
  before: string;
  after: string;
}

export function validate(value: unknown, schema: JsonSchema): boolean {
  if ("anyOf" in schema) return schema.anyOf.some((option) => validate(value, option));
  if (schema.type === "integer") {
    return (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= (schema.minimum ?? -Infinity)
    );
  }
  if (schema.type === "string") {
    return typeof value === "string" && (!schema.enum || schema.enum.includes(value));
  }
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array") {
    return (
      Array.isArray(value) &&
      value.length >= (schema.minItems ?? 0) &&
      value.every((item) => validate(item, schema.items))
    );
  }
  if (schema.type !== "object" || value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== schema.required.length) return false;
  return schema.required.every(
    (key) => Object.hasOwn(obj, key) && validate(obj[key], schema.properties[key]!),
  );
}

export function applyEdits(draft: string, edits: ExactEdit[]): string {
  const spans = edits.map((edit) => {
    const start = draft.indexOf(edit.before);
    if (!edit.before || start < 0 || draft.indexOf(edit.before, start + 1) !== -1) {
      throw new Error("Review edit must identify a unique exact span.");
    }
    return { start, end: start + edit.before.length, after: edit.after };
  }).sort((a, b) => a.start - b.start);
  if (spans.some((span, i) => i > 0 && span.start < spans[i - 1]!.end)) {
    throw new Error("Review edits overlap.");
  }
  let next = draft;
  for (const span of [...spans].reverse()) {
    next = next.slice(0, span.start) + span.after + next.slice(span.end);
  }
  if (!next.trim()) throw new Error("Review removed the complete draft.");
  return next;
}
