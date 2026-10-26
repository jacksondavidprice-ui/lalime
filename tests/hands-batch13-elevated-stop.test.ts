import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const executable = process.env.LALIME_NATIVE_TEST_EXE;
const harness = process.env.LALIME_BROKER_TEST_EXE;

async function until(check: () => Promise<boolean> | boolean): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe.skipIf(process.platform !== "win32" || !executable || !harness)("one-command broker cancellation", () => {
  it("ends the worker and its running shell when the pipe-owning parent exits", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "lalime-broker-stop-"));
    const pidFile = path.join(folder, "shell-pid.txt");
    const parent = spawn(harness!, ["--wait-parent", executable!, pidFile], { windowsHide: true });
    let output = "";
    parent.stdout.on("data", (chunk) => { output += chunk; });
    try {
      let shellPid = 0;
      expect(await until(async () => {
        try { shellPid = Number(await readFile(pidFile, "utf8")); return shellPid > 0 && /WORKER \d+/.test(output); }
        catch { return false; }
      })).toBe(true);
      const workerPid = Number(output.match(/WORKER (\d+)/)![1]);
      expect(alive(workerPid)).toBe(true);
      expect(alive(shellPid)).toBe(true);
      parent.kill();
      expect(await until(() => !alive(workerPid) && !alive(shellPid))).toBe(true);
    } finally { parent.kill(); }
  }, 12_000);
});
