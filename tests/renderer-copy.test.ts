import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(dir, entry.name)) : entry.name.endsWith(".tsx") ? [join(dir, entry.name)] : []);
}
const literals = files("src").flatMap(file => {
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) values.push(node.text.trim());
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return values.filter(Boolean).map(text => ({ file, text }));
});

it("renderer copy avoids stock reassurance and promotional filler", () => {
  const banned = /\b(?:seamless(?:ly)?|effortless|powerful|robust|unlock|elevate|leverage|delve)\b|^let['’]s\b|not just .+but|a little help goes a long way|make yourself at home|a little help, step by step|you can follow the work here/i;
  expect(literals.filter(({ text }) => banned.test(text))).toEqual([]);
});

it("renderer copy reserves en dashes for number ranges", () => {
  expect(literals.filter(({ text }) => /[—–]/.test(text.replace(/\d–\d/g, "")))).toEqual([]);
});

it("copy failure button names the error and retry without sentence punctuation", () => {
  const source = readFileSync("src/components/chat/CopyButton.tsx", "utf8");
  expect(source).toContain('"Copy failed, try again"');
  expect(source).not.toContain('"Copy failed. Try again."');
});
