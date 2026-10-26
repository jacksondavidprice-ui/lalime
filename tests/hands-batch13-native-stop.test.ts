import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
const executable = process.env.LALIME_NATIVE_TEST_EXE;
describe.skipIf(process.platform !== "win32" || !executable)("native parent lifetime", () => {
  it("exits when its host pipe closes during a command", async () => {
    const child = spawn(executable!, ["--stdio"], { windowsHide: true });
    try {
      const exit = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
      child.stdin.end(JSON.stringify({ id: "stop-fixture", method: "powershell.run", params: { command: "Start-Sleep -Seconds 60" } }) + "\n");
      const stopped = await Promise.race([exit, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))]);
      expect(stopped).toBe(true);
    } finally { child.kill(); }
  });
});
