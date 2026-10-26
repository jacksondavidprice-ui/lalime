/**
 * Fail the suite if credential-like secrets appear in tracked source.
 * Placeholders (sk-…, sk-test, sk-...) are allowed.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const FORBIDDEN = [
  {
    name: "OpenAI live API key",
    // Real keys look like sk-proj-… or sk-… with a long token — not ellipsis placeholders.
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    allow: [
      /sk-test\b/,
      /sk-\u2026/,
      /sk-\.\.\./,
      /sk-\u2026/,
      /placeholder/i,
      // Anthropic keys are covered by the dedicated rule below.
      /^sk-ant-/,
    ],
  },
  {
    name: "Anthropic live API key",
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    allow: [
      /sk-ant-\u2026/,
      /sk-ant-\.\.\./,
      /sk-ant-test\b/,
      /placeholder/i,
      // Documented shape checks / fake fixtures that are not real credentials.
      /sk-ant-api03-test-key-not-real/,
      /sk-ant-fake-for-unit-tests-only/,
    ],
  },
  {
    name: "AWS access key id",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    allow: [],
  },
  {
    name: "Generic private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    allow: [],
  },
];

function listedFiles(): string[] {
  const out = execSync("git ls-files --cached --others --exclude-standard", { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !f.startsWith("docs/screenshots/"))
    .filter((f) => !f.startsWith("brand/"))
    .filter((f) => !f.startsWith("public/"))
    .filter((f) => !f.startsWith("build/"))
    .filter((f) => !f.endsWith(".png") && !f.endsWith(".ico") && !f.endsWith(".woff2"));
}

describe("secret scan", () => {
  it("finds no credentials in tracked or new source files", () => {
    const hits: string[] = [];
    for (const file of listedFiles()) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const rule of FORBIDDEN) {
        rule.re.lastIndex = 0;
        const matches = text.match(rule.re) ?? [];
        for (const m of matches) {
          if (rule.allow.some((a) => a.test(m))) continue;
          // Allow documented examples in .env.example comments
          if (file.endsWith(".env.example") && m.includes("sk-")) continue;
          hits.push(`${file}: ${rule.name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("gitignore keeps .env out of the tree", () => {
    const gi = readFileSync(".gitignore", "utf8");
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\.\*$/m);
  });
});
