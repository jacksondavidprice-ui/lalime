import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runBuild(dotnetExit: number, failOn = "restore") {
  const root = mkdtempSync(path.join(tmpdir(), "lalime-build-test-"));
  roots.push(root);
  const scripts = path.join(root, "scripts");
  const output = path.join(root, "hands/windows/Hands/bin/Release/net8.0-windows");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(output, { recursive: true });
  // A previous binary must not hide a failed build.
  writeFileSync(path.join(output, "Hands.exe"), "stale test artifact");
  copyFileSync("scripts/build-hands-windows.ps1", path.join(scripts, "build-hands-windows.ps1"));
  const harness = path.join(root, "run.ps1");
  writeFileSync(harness, `
function global:dotnet {
  Add-Content -LiteralPath (Join-Path $PSScriptRoot 'calls.txt') -Value ($args -join ' ')
  $global:LASTEXITCODE = if ($args[0] -eq '${failOn}') { ${dotnetExit} } else { 0 }
}
& (Join-Path $PSScriptRoot 'scripts/build-hands-windows.ps1')
`);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness], {
    encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  if (result.error) throw result.error;
  let calls: string;
  try { calls = readFileSync(path.join(root, "calls.txt"), "utf8"); }
  catch { throw new Error(`Build harness did not run: ${result.stderr}`); }
  return { result, calls };
}

describe.skipIf(process.platform !== "win32")("Windows helper packaging", () => {
  it("fails when dotnet restore fails even if an older binary exists", () => {
    const { result, calls } = runBuild(37);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(calls).not.toContain("publish");
  });

  it("publishes the runtime with the helper for machines without .NET", () => {
    const { result, calls } = runBuild(0);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(calls).toMatch(/publish .*--self-contained true/);
  });

  it("fails when dotnet publish fails even if an older binary exists", () => {
    const { result } = runBuild(38, "publish");
    expect(result.status).not.toBe(0);
  });

  it("rebuilds before publishing so a prior framework-dependent build cannot leak into packaging", () => {
    const { result, calls } = runBuild(0);
    expect(result.status).toBe(0);
    const lines = calls.trim().split(/\r?\n/);
    expect(lines[1]).toMatch(/^build .* -t:Rebuild .*--self-contained true/);
    expect(lines[2]).toMatch(/^publish .*--no-build/);
  });

  it("does not publish if the required native rebuild fails", () => {
    const { result, calls } = runBuild(41, "build");
    expect(result.status).not.toBe(0);
    expect(calls).not.toContain("publish");
  });

  it.each(["ci", "run", "builder", "none"])("handles installer command result: %s", (failOn) => {
    const root = mkdtempSync(path.join(tmpdir(), "lalime-installer-test-"));
    roots.push(root);
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "release"));
    const output = path.join(root, "hands/windows/Hands/bin/Release/net8.0-windows");
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, "Hands.exe"), "stale test artifact");
    copyFileSync("scripts/build-windows-installer.ps1", path.join(root, "scripts/build-windows-installer.ps1"));
    const harness = path.join(root, "run.ps1");
    writeFileSync(harness, `
function global:npm {
  Write-Output ('npm invoked: ' + ($args -join ' '))
  $global:LASTEXITCODE = if ($args[0] -eq '${failOn}') { 39 } else { 0 }
}
function global:npx {
  Write-Output 'builder invoked'
  $global:LASTEXITCODE = if ('${failOn}' -eq 'builder') { 40 } else { 0 }
}
& (Join-Path $PSScriptRoot 'scripts/build-windows-installer.ps1')
`);
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness], {
      encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain("npm invoked: ci");
    if (failOn === "none") {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("builder invoked");
      expect(result.stdout).toContain("Done.");
    } else {
      expect(result.status, result.stderr + result.stdout).not.toBe(0);
      const message = { ci: "Dependency installation failed", run: "Application build failed", builder: "Installer packaging failed" }[failOn];
      expect(result.stderr).toContain(message);
      expect(result.stdout).not.toContain("Done.");
      if (failOn !== "ci") expect(result.stdout).toContain("npm invoked: run build");
      if (failOn !== "builder") expect(result.stdout).not.toContain("builder invoked");
      else expect(result.stdout).toContain("builder invoked");
    }
  });

  it("does not report a successful Windows build when the .NET SDK is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lalime-sdk-test-"));
    roots.push(root);
    const result = spawnSync(process.execPath, [path.resolve("scripts/build-hands.mjs")], {
      env: { ...process.env, PATH: root, Path: root }, encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain(".NET SDK not found");
    expect(result.status).not.toBe(0);
  });
});
