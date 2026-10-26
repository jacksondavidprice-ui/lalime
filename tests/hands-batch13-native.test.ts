import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import readline from "node:readline";

const executable = process.env.LALIME_NATIVE_TEST_EXE;
function nativeRequest(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable!, ["--stdio"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const deadline = setTimeout(() => { child.kill(); reject(new Error("Native fixture exceeded its test deadline.")); }, 40_000);
    const lines = readline.createInterface({ input: child.stdout });
    child.on("error", reject);
    child.on("exit", () => { clearTimeout(deadline); lines.close(); });
    lines.once("line", (line) => { clearTimeout(deadline); child.kill(); resolve(JSON.parse(line)); });
    child.stdin.write(JSON.stringify({ id: "fixture", method, params }) + "\n");
  });
}

describe.skipIf(process.platform !== "win32" || !executable)("isolated native Hands behavior", () => {
  it("lets a harmless command complete after the former 20-second deadline", async () => {
    const result = await nativeRequest("powershell.run", { command: "Start-Sleep -Seconds 22; Write-Output 'long-command-complete'", summary: "Fixture" });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("long-command-complete");
  }, 40_000);

  it("bounds returned output while continuing to drain the child", async () => {
    const result = await nativeRequest("powershell.run", { command: "Write-Output ('x' * 100000)", summary: "Output fixture" });
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(65_600);
    expect(result.output).toContain("truncated");
  });

  it("refuses an absent named UI window instead of returning desktop text", async () => {
    const result = await nativeRequest("uia.list", { windowTitle: "Lalime definitely absent fixture window 47fd" });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/not found|ambiguous/i);
  });

  it("recognizes set-value and rejects an unbound target", async () => {
    const result = await nativeRequest("uia.setValue", { name: "", value: "50", windowTitle: "" });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/window title and element name are required/i);
    expect(result.output).not.toMatch(/unknown method/i);
  });
});
