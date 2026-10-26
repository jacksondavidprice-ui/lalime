import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const hooks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: hooks.spawn }));
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), existsSync: () => true }));
vi.mock("../hands/src/hands-exe.js", () => ({
  resolveHandsExePath: () => "C:\\fixture\\Hands.exe", handsMissingMessage: () => "Missing",
  packagedHandsExe: () => "C:\\fixture\\Hands.exe", unpackagedHandsExe: () => "C:\\fixture\\Hands.exe",
}));
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";
it("kills a still-running native process before losing it on a transport error", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  hooks.spawn.mockReturnValue(child);
  const hands = new WindowsHandsBridge();
  const pending = hands.runPowerShell("Get-Date", "Read");
  child.stdin.emit("error", new Error("Fixture broken pipe"));
  expect(child.kill).toHaveBeenCalledOnce();
  expect((await pending).ok).toBe(false);
});
