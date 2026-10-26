// Native protocol regressions. This script only uses temporary files and harmless commands.
// Build Hands first. Run: node scripts/qa-hands-native.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableArgument = process.argv.find((arg) => arg.startsWith("--hands-exe="));
const exe = executableArgument
  ? path.resolve(executableArgument.slice("--hands-exe=".length))
  : path.join(root, "hands/windows/Hands/bin/Release/net8.0-windows/Hands.exe");
const scratch = mkdtempSync(path.join(tmpdir(), "lalime-hands-native-"));
let failures = 0;

function helper() {
  const proc = spawn(exe, ["--stdio"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  const rl = readline.createInterface({ input: proc.stdout });
  let fault;
  proc.on("error", (error) => { fault = error; });
  proc.stderr.resume();
  rl.on("line", (line) => lines.push(JSON.parse(line)));
  return {
    proc,
    send(value) { proc.stdin.write(JSON.stringify(value) + "\n"); },
    async response(timeout = 5000) {
      const end = Date.now() + timeout;
      while (!lines.length && Date.now() < end && !fault) await delay(20);
      if (fault) throw fault;
      assert.ok(lines.length, `No native response within ${timeout} ms`);
      return lines.shift();
    },
    async close() {
      rl.close();
      if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) return;
      // Terminate only this owned helper. Its Windows job contains its workers.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Native QA helper did not exit during cleanup")), 3000);
        proc.once("close", () => { clearTimeout(timer); resolve(); });
        proc.once("error", (error) => { clearTimeout(timer); reject(error); });
        if (!proc.kill()) { clearTimeout(timer); reject(new Error("Native QA helper termination failed")); }
      });
    },
  };
}

async function test(name, fn) {
  const h = helper();
  try { await fn(h); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
  finally {
    try { await h.close(); }
    catch (error) { failures++; console.error(`FAIL ${name} cleanup: ${error.message}`); }
  }
}

await test("PowerShell output has no invented undo token", async (h) => {
  h.send({ id: "ps", method: "powershell.run", params: { command: "Write-Output 'native-ok'" } });
  const result = await h.response();
  assert.equal(result.ok, true);
  assert.match(result.output, /native-ok/);
  assert.equal(result.journalId, undefined);
});

await test("missing recycle path fails without an undo token", async (h) => {
  h.send({ id: "missing", method: "files.recycle", params: { paths: [path.join(scratch, "never-created.txt")] } });
  const result = await h.response();
  assert.equal(result.ok, false);
  assert.equal(result.journalId, undefined);
});

await test("exception keeps request id and next request works", async (h) => {
  h.send({ id: "bad-params", method: "powershell.astCheck", params: null });
  const result = await h.response();
  assert.equal(result.id, "bad-params");
  assert.equal(result.ok, false);
  h.send({ id: "next", method: "powershell.astCheck", params: { command: "Write-Output 'ok'" } });
  assert.equal((await h.response()).id, "next");
});

await test("stdout and stderr drain concurrently", async (h) => {
  h.send({ id: "streams", method: "powershell.run", params: {
    command: "[Console]::Error.Write(('e' * 131072)); Write-Output 'streams-ok'",
  } });
  const result = await h.response();
  assert.equal(result.ok, true);
  assert.match(result.output, /streams-ok/);
});

await test("PowerShell deadline returns before bridge timeout", async (h) => {
  h.send({ id: "deadline", method: "powershell.run", params: { command: "Start-Sleep -Seconds 40" } });
  const result = await h.response(25000);
  assert.equal(result.ok, false);
  assert.match(result.output, /timed out/i);
});

await test("helper termination kills its PowerShell child", async (h) => {
  const pidPath = path.join(scratch, "child-pid.txt");
  h.send({ id: "child", method: "powershell.run", params: {
    command: `[IO.File]::WriteAllText('${pidPath.replaceAll("'", "''")}', [string]$PID); Start-Sleep -Seconds 40`,
  } });
  const end = Date.now() + 5000;
  while (!existsSync(pidPath) && Date.now() < end) await delay(20);
  assert.ok(existsSync(pidPath), "Test child did not start");
  const pid = Number(readFileSync(pidPath, "utf8"));
  assert.ok(Number.isInteger(pid) && pid > 0);
  try {
    h.proc.kill();
    const end = Date.now() + 2000;
    let alive = true;
    while (alive && Date.now() < end) {
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) await delay(20);
    }
    assert.equal(alive, false, "PowerShell survived helper termination");
  } finally {
    // This PID was written by the scratch-test command, not selected from host processes.
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  }
});

await test("completed PowerShell action cannot leave a background child", async (h) => {
  const pidPath = path.join(scratch, "background-child-pid.txt");
  let pid;
  try {
    h.send({ id: "background", method: "powershell.run", params: {
      command: `$child = Start-Process powershell.exe -ArgumentList '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 40' -WindowStyle Hidden -PassThru; [IO.File]::WriteAllText('${pidPath.replaceAll("'", "''")}', [string]$child.Id); Write-Output 'launcher-done'`,
    } });
    await h.response();
    assert.ok(existsSync(pidPath), "Launcher did not record the scratch-test child");
    pid = Number(readFileSync(pidPath, "utf8"));
    assert.ok(Number.isInteger(pid) && pid > 0);
    const end = Date.now() + 2000;
    let alive = true;
    while (alive && Date.now() < end) {
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) await delay(20);
    }
    assert.equal(alive, false, "Background PowerShell survived its completed action");
  } finally {
    if (!pid && existsSync(pidPath)) pid = Number(readFileSync(pidPath, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
    }
  }
});

console.log(`${7 - failures}/7 native checks passed`);
process.exitCode = failures ? 1 : 0;
