import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";

const executable = process.env.LALIME_NATIVE_TEST_EXE;
describe.skipIf(process.platform !== "win32" || !executable)("native elevation protocol", () => {
  it("rejects an incomplete worker capability instead of starting an unbound worker", async () => {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(executable!, ["--elevated-worker", "invalid-pipe"], { windowsHide: true });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
    expect(result.code).not.toBe(0);
    expect(result.output).not.toContain("pass --stdio");
  });
});
