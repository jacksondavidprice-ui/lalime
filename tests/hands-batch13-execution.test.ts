import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const hooks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: hooks.spawn, execFile: hooks.execFile }));
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), existsSync: () => true }));
vi.mock("../hands/src/hands-exe.js", () => ({
  resolveHandsExePath: () => "C:\\fixture\\Hands.exe", handsMissingMessage: () => "Missing Hands",
  packagedHandsExe: () => "C:\\fixture\\Hands.exe", unpackagedHandsExe: () => "C:\\fixture\\Hands.exe",
}));
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";
import { NodeHands } from "../hands/src/node-hands.js";

function child() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
  });
}
let processFixture: ReturnType<typeof child>;
beforeEach(() => {
  processFixture = child(); hooks.spawn.mockReset().mockReturnValue(processFixture);
  hooks.execFile.mockReset().mockImplementation((_exe, _args, _options, callback) => { callback(null, "OK", ""); return {}; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Windows command lifecycle", () => {
  it("keeps a long command pending until its real result arrives", async () => {
    vi.useFakeTimers();
    const hands = new WindowsHandsBridge();
    let result: unknown;
    const pending = hands.runPowerShell("Start-Sleep 120", "Wait").then((value) => { result = value; });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(result).toBeUndefined();
    processFixture.stdout.write(JSON.stringify({ id: "1", ok: true, output: "Complete" }) + "\n");
    await pending;
    expect(result).toEqual(expect.objectContaining({ ok: true, output: "Complete" }));
  });

  it("settles every pending request immediately on Stop", async () => {
    const hands = new WindowsHandsBridge();
    const one = hands.runPowerShell("Get-Date", "One");
    const two = hands.precheckPowerShell("Get-Date");
    let settled = 0;
    one.then(() => settled++); two.then(() => settled++);
    hands.stop();
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(2);
    expect(await one).toEqual(expect.objectContaining({ ok: false, output: "Stopped by user." }));
    expect(processFixture.kill).toHaveBeenCalledOnce();
  });

  it("settles requests when the native process exits without a result", async () => {
    const hands = new WindowsHandsBridge();
    let result: unknown;
    hands.runPowerShell("Get-Date", "Read").then((value) => { result = value; });
    processFixture.emit("exit", 1);
    await Promise.resolve(); await Promise.resolve();
    expect(result).toEqual(expect.objectContaining({ ok: false }));
  });

  it("binds admin to this command without elevating the persistent sidecar", async () => {
    const hands = new WindowsHandsBridge();
    void hands.runPowerShell("Get-Date", "Read", { admin: true });
    const request = JSON.parse(processFixture.stdin.read().toString());
    expect(request.params).toEqual({ command: "Get-Date", summary: "Read", admin: true });
    expect(hooks.spawn).toHaveBeenCalledWith("C:\\fixture\\Hands.exe", ["--stdio"], expect.any(Object));
    processFixture.stdout.write(JSON.stringify({ id: request.id, ok: true, output: "OK" }) + "\n");
  });

  it("does not let an old process exit invalidate a resumed process", async () => {
    const hands = new WindowsHandsBridge();
    void hands.runPowerShell("Get-Date", "Old");
    hands.stop(); hands.resume();
    const next = child(); hooks.spawn.mockReturnValue(next);
    void hands.runPowerShell("Get-Date", "New");
    processFixture.emit("exit", 1);
    void hands.precheckPowerShell("Get-Date");
    expect(hooks.spawn).toHaveBeenCalledTimes(2);
    hands.stop();
  });

  it("forwards exact set-value data to the native UIA method", async () => {
    const hands = new WindowsHandsBridge();
    expect(hands.setElementValue).toBeTypeOf("function");
    const pending = hands.setElementValue!("Brightness", "50", "Settings");
    const request = JSON.parse(processFixture.stdin.read().toString());
    expect(request).toMatchObject({ method: "uia.setValue", params: { name: "Brightness", value: "50", windowTitle: "Settings" } });
    processFixture.stdout.write(JSON.stringify({ id: request.id, ok: true, output: "Set value" }) + "\n");
    expect((await pending).ok).toBe(true);
  });
});

describe.runIf(process.platform === "win32")("Node command cancellation", () => {
  it("uses explicit cancellation instead of a command timeout", async () => {
    hooks.execFile.mockImplementation((_exe, _args, options, callback) => { callback(null, "OK", ""); return {}; });
    expect((await new NodeHands().runPowerShell("Get-Date", "Read")).ok).toBe(true);
    const options = hooks.execFile.mock.calls[0][2];
    expect(options.timeout).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a running command on Stop and returns a plain stopped result", async () => {
    hooks.execFile.mockImplementation((_exe, _args, options, callback) => {
      options.signal?.addEventListener("abort", () => callback(Object.assign(new Error("aborted"), { name: "AbortError" })));
      return {};
    });
    const hands = new NodeHands();
    const pending = hands.runPowerShell("Get-Date", "Read");
    await Promise.resolve(); await Promise.resolve();
    hands.stop();
    expect(hooks.execFile.mock.calls[0][2].signal?.aborted).toBe(true);
    expect(await pending).toEqual({ ok: false, output: "Stopped by user." });
  });

  it("refuses admin when the native one-command broker is unavailable", async () => {
    const result = await new NodeHands().runPowerShell("Get-Date", "Read", { admin: true });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/native.*Hands|Hands.*required/i);
    expect(hooks.execFile).not.toHaveBeenCalled();
  });
});
