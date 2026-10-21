import { describe, expect, it } from "vitest";
import { applyEdits, validate, type JsonSchema } from "./edits.js";

const schema: JsonSchema = {
  type: "object",
  properties: {
    whatHappens: { type: "string" },
    undo: { type: "string" },
  },
  required: ["whatHappens", "undo"],
  additionalProperties: false,
};

describe("edits", () => {
  it("validates exact object shapes", () => {
    expect(validate({ whatHappens: "a", undo: "b" }, schema)).toBe(true);
    expect(validate({ whatHappens: "a" }, schema)).toBe(false);
    expect(validate({ whatHappens: "a", undo: "b", extra: true }, schema)).toBe(false);
  });

  it("applies unique exact-span edits", () => {
    const draft = "The Downloads folder is messy. I sorted it.";
    const next = applyEdits(draft, [
      { before: "is messy", after: "was messy" },
      { before: "I sorted it.", after: "I sorted the old installers." },
    ]);
    expect(next).toBe("The Downloads folder was messy. I sorted the old installers.");
  });

  it("rejects ambiguous or overlapping edits", () => {
    expect(() => applyEdits("aa aa", [{ before: "aa", after: "b" }])).toThrow(/unique/);
    expect(() =>
      applyEdits("abcdef", [
        { before: "abc", after: "X" },
        { before: "cde", after: "Y" },
      ]),
    ).toThrow(/overlap/);
  });
});
