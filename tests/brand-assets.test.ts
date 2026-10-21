import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Lalime brand assets", () => {
  it("ships optimized web mark, not the 8MB master, in renderer paths", () => {
    const web = resolve("src/assets/logo-mark.png");
    const pub = resolve("public/logo-mark.png");
    expect(existsSync(web)).toBe(true);
    expect(existsSync(pub)).toBe(true);
    expect(statSync(web).size).toBeLessThan(500_000);
    expect(statSync(pub).size).toBeLessThan(500_000);
  });

  it("provides Electron/installer icons", () => {
    expect(existsSync(resolve("build/icon.png"))).toBe(true);
    expect(existsSync(resolve("build/icon.ico"))).toBe(true);
    expect(existsSync(resolve("public/favicon.ico"))).toBe(true);
  });

  it("Logo component uses the real mark image", () => {
    const src = readFileSync(resolve("src/components/Logo.tsx"), "utf8");
    expect(src).toMatch(/logo-mark\.png/);
    expect(src).not.toMatch(/viewBox="0 0 24 24"/);
  });

  it("index.html references favicon", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    expect(html).toMatch(/favicon\.ico/);
  });
});
