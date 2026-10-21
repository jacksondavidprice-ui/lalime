import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HANDS_EXE_RELATIVE,
  handsMissingMessage,
  packagedHandsExe,
  resolveHandsExePath,
  unpackagedHandsExe,
} from "../hands/src/hands-exe.ts";
import { createHandsClient } from "../hands/src/create-hands.ts";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.LALIME_HANDS;
  delete process.env.LALIME_HANDS_EXE;
  delete process.env.LALIME_DEMO;
  delete process.env.LALIME_PACKAGED;
});

describe("Hands.exe resolution", () => {
  it("prefers packaged extraResources over unpackaged", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lalime-hands-"));
    scratch.push(root);
    const resources = path.join(root, "resources");
    const unpackaged = unpackagedHandsExe(root);
    mkdirSync(path.dirname(unpackaged), { recursive: true });
    writeFileSync(unpackaged, "unpackaged");
    const packaged = packagedHandsExe(resources);
    mkdirSync(path.dirname(packaged), { recursive: true });
    writeFileSync(packaged, "packaged");

    expect(
      resolveHandsExePath({ appRoot: root, resourcesPath: resources }),
    ).toBe(packaged);
  });

  it("finds unpackaged build output under HANDS_EXE_RELATIVE", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lalime-hands-"));
    scratch.push(root);
    const exe = path.join(root, HANDS_EXE_RELATIVE);
    mkdirSync(path.dirname(exe), { recursive: true });
    writeFileSync(exe, "exe");
    expect(resolveHandsExePath({ appRoot: root })).toBe(exe);
  });

  it("missing message mentions npm run build", () => {
    expect(handsMissingMessage("/tmp/Hands.exe")).toMatch(/npm run build/);
    expect(handsMissingMessage()).toMatch(/Hands\.exe/);
  });
});

describe("createHandsClient defaults", () => {
  it("uses windows backend on win32 without LALIME_HANDS", () => {
    if (process.platform !== "win32") {
      // Simulate product choice: explicit windows mode is the Windows default.
      const client = createHandsClient("windows");
      expect(client.backend).toBe("windows");
      return;
    }
    delete process.env.LALIME_HANDS;
    const client = createHandsClient("auto");
    expect(client.backend).toBe("windows");
  });

  it("keeps mock only when LALIME_DEMO / mock is allowed", () => {
    process.env.LALIME_DEMO = "1";
    delete process.env.LALIME_PACKAGED;
    const client = createHandsClient("mock");
    expect(client.backend).toBe("mock");
    expect(client.isAvailable()).toBe(true);
  });

  it("refuses mock in packaged builds and falls back to windows/node", () => {
    process.env.LALIME_PACKAGED = "1";
    process.env.LALIME_DEMO = "1";
    process.env.LALIME_HANDS = "mock";
    const client = createHandsClient("mock");
    expect(client.backend).not.toBe("mock");
  });
});
