/**
 * Build Hands.exe when running on Windows with the .NET SDK available.
 * No-op (exit 0) on other platforms so Linux CI stays green.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ps1 = path.join(root, "scripts", "build-hands-windows.ps1");
const exe = path.join(
  root,
  "hands",
  "windows",
  "Hands",
  "bin",
  "Release",
  "net8.0-windows",
  "Hands.exe",
);

function hasDotnet() {
  const r = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

if (process.platform !== "win32") {
  console.log("build-hands: skip (not Windows)");
  process.exit(0);
}

if (!hasDotnet()) {
  console.warn(
    "build-hands: .NET SDK not found. Install the .NET 8 SDK or newer and re-run npm run build. A Windows build requires a current Hands.exe.",
  );
  process.exit(1);
}

console.log("build-hands: building Hands.exe…");
const shell = existsSync(ps1) ? "powershell.exe" : null;
const result = spawnSync(
  shell ?? "pwsh",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
  { cwd: root, stdio: "inherit", shell: false },
);

if (result.status !== 0) {
  console.error("build-hands: Hands build failed");
  process.exit(result.status ?? 1);
}

if (!existsSync(exe)) {
  console.error(`build-hands: expected ${exe}`);
  process.exit(1);
}

console.log(`build-hands: OK ${exe}`);
