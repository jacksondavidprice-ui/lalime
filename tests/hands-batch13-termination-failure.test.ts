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
function processFixture() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
  });
}

it.each(["stop-false", "stop-throw", "error-false", "error-throw"])("keeps lifecycle control after %s", async (mode) => {
  const child = processFixture();
  if (mode.endsWith("false")) child.kill.mockReturnValue(false);
  else child.kill.mockImplementation(() => { throw new Error("Fixture termination denied"); });
  hooks.spawn.mockReset().mockReturnValue(child);
  const hands = new WindowsHandsBridge();
  const pending = hands.runPowerShell("Get-Date", "Read");
  expect(() => mode.startsWith("stop") ? hands.stop() : child.stdin.emit("error", new Error("Fixture transport failure"))).not.toThrow();
  expect(child.stdin.destroyed).toBe(true);
  expect((await pending).ok).toBe(false);
  hands.resume();
  expect((await hands.runPowerShell("Get-Date", "Still stopping")).ok).toBe(false);
  expect(hooks.spawn).toHaveBeenCalledTimes(1);
  child.emit("exit", 1);
  const next = processFixture(); hooks.spawn.mockReturnValue(next);
  const resumed = hands.runPowerShell("Get-Date", "Resumed");
  expect(hooks.spawn).toHaveBeenCalledTimes(2);
  const request = JSON.parse(next.stdin.read().toString());
  next.stdout.write(JSON.stringify({ id: request.id, ok: true, output: "OK" }) + "\n");
  expect((await resumed).ok).toBe(true);
  hands.stop();
});
