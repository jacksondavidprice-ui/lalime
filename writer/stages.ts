import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonSchema } from "./edits.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadPrompt(name: string): string {
  return readFileSync(path.join(HERE, "prompts", name), "utf8").trim();
}

export const DELIBERATE_MODEL = "claude-opus-5-5";
export const DELIBERATE_MODEL_FAST = "claude-sonnet-5-5";

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

export const readDocumentSchema: JsonSchema = {
  type: "object",
  properties: {
    plainReading: { type: "string" },
    assessment: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          category: { type: "string", enum: ["grammar", "meaning", "flow", "rhetoric"] },
          problem: { type: "string" },
        },
        required: ["quote", "category", "problem"],
        additionalProperties: false,
      },
    },
  },
  required: ["plainReading", "assessment", "issues"],
  additionalProperties: false,
};

export const verifyClaritySchema: JsonSchema = {
  type: "object",
  properties: {
    meaningPreserved: { type: "boolean" },
    clarityImproved: { type: "boolean" },
    voicePreserved: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["meaningPreserved", "clarityImproved", "voicePreserved", "reason"],
  additionalProperties: false,
};

export const reviewEditsSchema: JsonSchema = {
  type: "object",
  properties: {
    assessment: { type: "string" },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          before: { type: "string" },
          after: { type: "string" },
        },
        required: ["before", "after"],
        additionalProperties: false,
      },
    },
  },
  required: ["assessment", "edits"],
  additionalProperties: false,
};

export const stageInstructions = {
  reply:
    "Write the reply the person will read. Use only the facts JSON. Do not invent actions. Return plain text only — no title, no JSON wrapper.",
  approvalLine:
    "Guardian already decided. Add one short 'what happens if you say yes' line and a one-line undo note. Do not change the decision. Keep exact file or app names from the facts. Return JSON only.",
  read_document:
    "Produce a plainReading that restates the draft in ordinary spoken English. Quote each hard span and explain the friction. Return JSON only.",
  review_document:
    "Propose exact-span edits that fix the listed issues. Each before must be a unique exact span from the draft. Return JSON only.",
  verify_clarity:
    "Compare originalDraft with candidateDraft. Set meaningPreserved, clarityImproved, and voicePreserved honestly. Return JSON only.",
} as const;
