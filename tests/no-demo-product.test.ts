import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("product path has no user-facing demo mode", () => {
  it("Onboarding has no Start demo CTA", () => {
    const src = readFileSync(resolve("src/pages/Onboarding.tsx"), "utf8");
    expect(src).not.toMatch(/start-demo/);
    expect(src).not.toMatch(/Start demo/);
    expect(src).toMatch(/sign-in-chatgpt/);
    expect(src).toMatch(/Sign in with ChatGPT/);
  });

  it("ChatHome has no Use demo mode control", () => {
    const src = readFileSync(resolve("src/pages/ChatHome.tsx"), "utf8");
    expect(src).not.toMatch(/Use demo mode/);
    expect(src).not.toMatch(/signInDemo/);
    expect(src).toMatch(/sign-in-gate|Sign in to continue/);
  });

  it("packaged startup clears LALIME_DEMO", () => {
    const src = readFileSync(resolve("electron/main/index.ts"), "utf8");
    expect(src).toMatch(/LALIME_PACKAGED/);
    expect(src).toMatch(/delete process\.env\.LALIME_DEMO/);
  });

  it("README documents live-only product path", () => {
    const src = readFileSync(resolve("README.md"), "utf8");
    expect(src).toMatch(/no demo mode/i);
    expect(src).toMatch(/codex login/);
  });
});
