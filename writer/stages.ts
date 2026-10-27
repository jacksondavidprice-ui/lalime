import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonSchema } from "./edits.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadPrompt(name: string): string {
  return readFileSync(path.join(HERE, "prompts", name), "utf8").trim();
}

export function buildWriterSystemPrompt(): string {
  return [
    loadPrompt("lalime-audience.md"),
    "",
    loadPrompt("writing-rules.txt"),
    "",
    loadPrompt("direct-prose.md"),
    "",
    loadPrompt("explain.md"),
  ].join("\n");
}

export const approvalLineSchema: JsonSchema = {
  type: "object",
  properties: {
    whatHappens: { type: "string" },
    undo: { type: "string" },
  },
  required: ["whatHappens", "undo"],
  additionalProperties: false,
};

export const stageInstructions = {
  reply:
    "Write the reply the person will read. Use only the facts JSON. Do not invent actions. Return plain text only — no title, no JSON wrapper.",
  approvalLine:
    "Guardian already decided. Add one short 'what happens if you say yes' line and a one-line undo note. Do not change the decision. Keep exact file or app names from the facts. Return JSON only.",
} as const;
