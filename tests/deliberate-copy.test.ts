import { describe, expect, it } from "vitest";
import copy from "../src/copy/en.json";
import briefs from "../src/copy/source.json";

const entries = Object.entries(copy);
const labels = entries.filter(([key]) => /(?:\.title|Heading|\.eyebrow)$/.test(key) || key.startsWith("chips."));

describe("Deliberate renderer copy", () => {
  it("keeps a brief for every visible copy slot", () => {
    expect(Object.keys(copy).sort()).toEqual(Object.keys(briefs).sort());
  });

  it("uses headings and starter buttons without sentence-ending periods", () => {
    expect(labels.filter(([, text]) => /\.$/.test(text)).map(([key]) => key)).toEqual([]);
  });

  it("avoids promotional filler and stock openings", () => {
    const unwanted = /\b(?:seamless(?:ly)?|effortless(?:ly)?|powerful|robust|unlock|elevate|leverage|delve|supercharge)\b|^let['’]s\b|\bnot just\b.+\bbut\b|\bdon['’]t worry\b|\byou['’]re all set\b/i;
    expect(entries.filter(([, text]) => unwanted.test(text)).map(([key]) => key)).toEqual([]);
  });

  it("uses dashes only for numeric ranges, and at most one exclamation mark", () => {
    const sentenceDashes = entries.filter(([, text]) => /[—–]|\s--\s/.test(text.replace(/\d[–—]\d/g, "")));
    expect(sentenceDashes.map(([key]) => key)).toEqual([]);
    expect(entries.reduce((count, [, text]) => count + (text.match(/!/g)?.length ?? 0), 0)).toBeLessThanOrEqual(1);
  });

  it("keeps the safety qualifications that limit Undo, Stop, and task allowances", () => {
    expect(copy["stopped.body"]).toContain("may still finish");
    expect(copy["stopped.body"]).toContain("does not undo earlier changes");
    expect(copy["approval.skipNote"]).toContain("may continue");
    expect(copy["approval.allowCommandScope"]).toContain("this exact command");
    expect(copy["approval.allowCommandScope"]).toContain("until this task ends");
    expect(copy["approval.prepareHint"]).toContain("Nothing is approved automatically");
    expect(copy["empty.reassurance"]).toContain("changes that Lalime can restore");
    expect(copy["changes.unverified"]).toContain("not verified");
  });
});
