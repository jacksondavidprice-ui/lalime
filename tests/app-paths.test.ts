import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  isBrokenRelativeDistPath,
  resolveAppRoot,
  resolveHandsExePath,
  resolvePreloadScript,
  resolveRendererIndexHtml,
  resolveWindowIcon,
} from "../electron/main/app-paths.ts";

const require = createRequire(import.meta.url);

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeUnpackagedTree(): { root: string; mainDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lalime-paths-"));
  scratch.push(root);
  const mainDir = path.join(root, "dist-electron", "electron", "main");
  mkdirSync(mainDir, { recursive: true });
  mkdirSync(path.join(root, "dist-electron", "electron", "preload"), { recursive: true });
  mkdirSync(path.join(root, "dist"), { recursive: true });
  mkdirSync(path.join(root, "build"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "lalime", main: "dist-electron/electron/main/index.js" }),
  );
  writeFileSync(path.join(root, "dist", "index.html"), "<html></html>");
  writeFileSync(path.join(root, "build", "icon.png"), "png");
  writeFileSync(path.join(mainDir, "index.js"), "");
  writeFileSync(
    path.join(root, "dist-electron", "electron", "preload", "index.cjs"),
    "",
  );
  return { root, mainDir };
}

describe("app-paths (blank-window / Windows ../../ bug)", () => {
  it("resolves project root from compiled main layout, not dist-electron/", () => {
    const { root, mainDir } = fakeUnpackagedTree();
    const resolved = resolveAppRoot({ mainModuleDir: mainDir, isPackaged: false });
    expect(path.resolve(resolved)).toBe(path.resolve(root));

    const naiveDist = path.resolve(mainDir, "../../dist/index.html");
    const correctDist = resolveRendererIndexHtml({ mainModuleDir: mainDir });
    expect(naiveDist).not.toBe(correctDist);
    expect(existsSync(naiveDist)).toBe(false);
    expect(existsSync(correctDist)).toBe(true);
    expect(isBrokenRelativeDistPath(mainDir)).toBe(true);
  });

  it("uses app.getAppPath() when packaged", () => {
    const { root, mainDir } = fakeUnpackagedTree();
    const asarRoot = path.join(root, "resources", "app.asar");
    mkdirSync(path.join(asarRoot, "dist"), { recursive: true });
    writeFileSync(
      path.join(asarRoot, "package.json"),
      JSON.stringify({ name: "lalime", main: "dist-electron/electron/main/index.js" }),
    );
    writeFileSync(path.join(asarRoot, "dist", "index.html"), "<html>packaged</html>");

    const ctx = {
      mainModuleDir: path.join(asarRoot, "dist-electron", "electron", "main"),
      isPackaged: true,
      appPath: asarRoot,
    };
    mkdirSync(ctx.mainModuleDir, { recursive: true });
    expect(resolveAppRoot(ctx)).toBe(asarRoot);
    expect(resolveRendererIndexHtml(ctx)).toBe(path.join(asarRoot, "dist", "index.html"));
    expect(existsSync(resolveRendererIndexHtml(ctx))).toBe(true);
  });

  it("resolves preload as sibling of main", () => {
    const { root, mainDir } = fakeUnpackagedTree();
    const preload = resolvePreloadScript({ mainModuleDir: mainDir });
    expect(preload).toBe(
      path.join(root, "dist-electron", "electron", "preload", "index.cjs"),
    );
    expect(existsSync(preload)).toBe(true);
  });

  it("resolves window icon under build/", () => {
    const { root, mainDir } = fakeUnpackagedTree();
    const icon = resolveWindowIcon({ mainModuleDir: mainDir });
    expect(icon).toBe(path.join(root, "build", "icon.png"));
    expect(existsSync(icon)).toBe(true);
  });

  it("prefers packaged Hands.exe via resourcesPath (app-paths)", () => {
    const { root, mainDir } = fakeUnpackagedTree();
    const resources = mkdtempSync(path.join(tmpdir(), "lalime-res-"));
    scratch.push(resources);
    const packagedExe = path.join(resources, "hands", "Hands.exe");
    mkdirSync(path.dirname(packagedExe), { recursive: true });
    writeFileSync(packagedExe, "exe");
    // Also plant unpackaged so we prove packaged wins.
    const unpackaged = path.join(
      root,
      "hands/windows/Hands/bin/Release/net8.0-windows/Hands.exe",
    );
    mkdirSync(path.dirname(unpackaged), { recursive: true });
    writeFileSync(unpackaged, "unpackaged");

    expect(
      resolveHandsExePath({
        mainModuleDir: mainDir,
        resourcesPath: resources,
      }),
    ).toBe(packagedExe);
  });

  it("matches the real compiled output layout after npm run build", () => {
    const mainDir = resolve("dist-electron/electron/main");
    const preload = resolve("dist-electron/electron/preload/index.cjs");
    const distHtml = resolve("dist/index.html");
    const icon = resolve("build/icon.png");

    expect(existsSync(path.join(mainDir, "index.js"))).toBe(true);
    expect(existsSync(preload)).toBe(true);
    expect(existsSync(distHtml)).toBe(true);
    expect(existsSync(icon)).toBe(true);

    // Document the bug Jackson hit: ../../ lands in dist-electron/
    expect(existsSync(path.join(mainDir, "../../dist/index.html"))).toBe(false);
    expect(isBrokenRelativeDistPath(mainDir)).toBe(true);

    const ctx = { mainModuleDir: mainDir, isPackaged: false };
    expect(path.resolve(resolveAppRoot(ctx))).toBe(resolve("."));
    expect(path.resolve(resolveRendererIndexHtml(ctx))).toBe(distHtml);
    expect(path.resolve(resolvePreloadScript(ctx))).toBe(preload);
    expect(path.resolve(resolveWindowIcon(ctx))).toBe(icon);
    expect(existsSync(resolveRendererIndexHtml(ctx))).toBe(true);
    expect(existsSync(resolvePreloadScript(ctx))).toBe(true);
    expect(existsSync(resolveWindowIcon(ctx))).toBe(true);
  });

  it("main entry no longer hard-codes ../../dist or ../../build", () => {
    const src = readFileSync(resolve("electron/main/index.ts"), "utf8");
    expect(src).toMatch(/resolveRendererIndexHtml/);
    expect(src).toMatch(/resolveWindowIcon/);
    expect(src).toMatch(/resolvePreloadScript/);
    expect(src).not.toMatch(/__dirname,\s*["']\.\.\/\.\.\/dist/);
    expect(src).not.toMatch(/__dirname,\s*["']\.\.\/\.\.\/build/);
  });

  it("electron-builder packs build/icon.png into the asar", () => {
    const yml = readFileSync(resolve("electron-builder.yml"), "utf8");
    expect(yml).toMatch(/build\/icon\.png/);
  });

  it("packaged linux-unpacked asar contains renderer + icon when built", () => {
    const asarPath = resolve("release/linux-unpacked/resources/app.asar");
    if (!existsSync(asarPath)) {
      // Optional artifact from electron-builder --dir; unit layout tests still cover packaging logic.
      expect(true).toBe(true);
      return;
    }
    const asar = require("@electron/asar") as { listPackage: (p: string) => string[] };
    const files = asar.listPackage(asarPath);
    expect(files.some((f) => f.includes("dist/index.html"))).toBe(true);
    expect(files.some((f) => f.includes("build/icon.png"))).toBe(true);
    expect(files.some((f) => f.includes("dist-electron/electron/main/app-paths.js"))).toBe(true);

    const ctx = {
      mainModuleDir: path.join(asarPath, "dist-electron", "electron", "main"),
      isPackaged: true,
      appPath: asarPath,
    };
    expect(resolveRendererIndexHtml(ctx)).toBe(path.join(asarPath, "dist", "index.html"));
    expect(resolveWindowIcon(ctx)).toBe(path.join(asarPath, "build", "icon.png"));
  });
});
