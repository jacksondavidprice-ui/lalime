import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { resolvePreloadScript } from "../electron/main/app-paths.js";

describe("sandboxed Electron preload build", () => {
  it("runs the compiled bridge with only Electron's sandbox require", async () => {
    const preload = resolvePreloadScript({ mainModuleDir: path.resolve("dist-electron/electron/main") });
    const code = readFileSync(preload, "utf8");
    const invoke = vi.fn(async () => ({ running: false }));
    const on = vi.fn();
    const removeListener = vi.fn();
    let exposed: Record<string, (...args: any[]) => any> | undefined;
    const require = vi.fn((name: string) => {
      if (name !== "electron") throw new Error(`Sandbox cannot require ${name}`);
      return {
        contextBridge: { exposeInMainWorld: (name: string, api: typeof exposed) => { expect(name).toBe("lalime"); exposed = api; } },
        ipcRenderer: { invoke, on, removeListener },
      };
    });
    vm.runInNewContext(code, { require }, { filename: preload, timeout: 1000 });
    expect(exposed).toBeDefined();
    await exposed!.getSnapshot();
    expect(invoke).toHaveBeenCalledWith("lalime:getSnapshot");
    const callback = vi.fn();
    const unsubscribe = exposed!.subscribe(callback);
    on.mock.calls[0][1]({}, { running: true });
    expect(callback).toHaveBeenCalledWith({ running: true });
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(on.mock.calls[0][0], on.mock.calls[0][1]);
    expect(require.mock.calls.map(([name]) => name)).toEqual(["electron"]);
  });

  it("selects a separate CommonJS file that TypeScript watch cannot overwrite", () => {
    expect(resolvePreloadScript({ mainModuleDir: path.resolve("dist-electron/electron/main") })).toMatch(/index\.cjs$/);
  });

  it("builds the preload in both production entry points", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["build:js"]).toContain("node scripts/build-preload.mjs");
    expect(readFileSync("scripts/build.mjs", "utf8")).toContain("build-preload.mjs");
  });

  it("watches both TypeScript and the preload during development", () => {
    const dev = readFileSync("scripts/dev.mjs", "utf8");
    expect(dev).toContain("buildPreload");
    expect(dev).toMatch(/watch:\s*true/);
    expect(dev).toContain("--watch");
  });
});
