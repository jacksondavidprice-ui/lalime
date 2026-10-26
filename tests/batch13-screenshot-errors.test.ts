import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const hooks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: hooks.spawn }));
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), existsSync: () => true }));
vi.mock("../hands/src/hands-exe.js", () => ({
  resolveHandsExePath: () => "C:\\fixture\\Hands.exe", handsMissingMessage: () => "Missing Hands",
  packagedHandsExe: () => "C:\\fixture\\Hands.exe", unpackagedHandsExe: () => "C:\\fixture\\Hands.exe",
}));
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
  });
  hooks.spawn.mockReset().mockReturnValue(child);
});
async function capture(response: Record<string, unknown>) {
  const pending = new WindowsHandsBridge().screenshot();
  const request = JSON.parse(child.stdin.read().toString());
  expect(request.method).toBe("screen.capture");
  child.stdout.write(JSON.stringify({ id: request.id, ...response }) + "\n");
  return pending;
}

describe("screen capture failure details", () => {
  it("keeps the native failure reason and gives the model an alternative", async () => {
    const result = await capture({ ok: false, output: "Access is denied." });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Windows screen capture failed: Access is denied.");
    expect(result.output).toContain("lalime_list_ui");
    expect(result.imageDataUrl).toBeUndefined();
  });

  it("explains a failed native capture without diagnostic text", async () => {
    const result = await capture({ ok: false, output: "" });
    expect(result.output).toContain("Windows did not provide a reason");
    expect(result.output).toContain("No screenshot was returned");
  });

  it("does not report success if the native capture contains no image", async () => {
    const result = await capture({ ok: true, output: "screenshot captured" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("returned no image");
  });

  it("keeps a successful screenshot as image data with short text", async () => {
    const result = await capture({ ok: true, output: "screenshot captured", imageDataUrl: "data:image/png;base64,fixture" });
    expect(result.ok).toBe(true);
    expect(result.imageDataUrl).toBe("data:image/png;base64,fixture");
    expect(result.output).toBe("screenshot captured");
  });

  it("preserves Stop instead of suggesting a retry", async () => {
    const result = await capture({ ok: false, output: "Stopped by user." });
    expect(result.output).toBe("Stopped by user.");
  });
});
