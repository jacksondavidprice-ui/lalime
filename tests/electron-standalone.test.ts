import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRendererLoad } from "../electron/main/renderer-load.ts";

describe("Electron standalone load (blank-window guard)", () => {
  it("uses dist file by default (not Vite URL)", () => {
    const target = resolveRendererLoad({
      env: {},
      distIndexHtml: "/tmp/lalime/dist/index.html",
    });
    expect(target).toEqual({
      type: "file",
      path: "/tmp/lalime/dist/index.html",
    });
  });

  it("uses Vite URL only when LALIME_DEV is set", () => {
    expect(
      resolveRendererLoad({
        env: { LALIME_DEV: "1" },
        distIndexHtml: "/tmp/lalime/dist/index.html",
      }),
    ).toEqual({ type: "url", url: "http://127.0.0.1:43123" });

    expect(
      resolveRendererLoad({
        env: { LALIME_DEV: "true", LALIME_DEV_URL: "http://127.0.0.1:9999" },
        distIndexHtml: "/tmp/x",
      }),
    ).toEqual({ type: "url", url: "http://127.0.0.1:9999" });
  });

  it("does not treat unpackaged alone as dev in main entry", () => {
    const main = readFileSync(resolve("electron/main/index.ts"), "utf8");
    const load = readFileSync(resolve("electron/main/renderer-load.ts"), "utf8");
    expect(main).not.toMatch(/isDev\s*=\s*!app\.isPackaged/);
    expect(main).toMatch(/resolveRendererLoad/);
    expect(main).toMatch(/resolveRendererIndexHtml/);
    expect(load).toMatch(/LALIME_DEV/);
  });

  it("vite config uses relative base for file:// assets", () => {
    const src = readFileSync(resolve("vite.config.ts"), "utf8");
    expect(src).toMatch(/base:\s*["']\.\/["']/);
  });

  it("index.html does not load Google Fonts", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });

  it("built dist/index.html uses relative asset URLs when present", () => {
    const distHtml = resolve("dist/index.html");
    if (!existsSync(distHtml)) {
      // Build may not have run yet in a clean checkout; source guards above still apply.
      expect(true).toBe(true);
      return;
    }
    const html = readFileSync(distHtml, "utf8");
    expect(html).not.toMatch(/(href|src)="\/assets\//);
    expect(html).toMatch(/(href|src)="\.\/assets\//);
  });

  it("dev script sets LALIME_DEV for hot reload", () => {
    const src = readFileSync(resolve("scripts/dev.mjs"), "utf8");
    expect(src).toMatch(/LALIME_DEV:\s*["']1["']/);
  });
});
