import { describe, expect, it } from "vitest";
import { evaluateActionSync } from "../src/index.js";
import { canonicalWindowsPaths } from "../src/normalize.js";
import type { ProposedAction } from "../../shared/types.js";

// Box-lab finding P9: never.system32.wipe matched only the literal
// "\windows\system32" spelling, so "$env:SystemRoot\System32\..." deletes
// were allowed. normalize.ts now rewrites env-var / .NET / separator
// spellings to the literal path before matching. No rule in never-list.ts,
// tiers.ts or risk-checker.ts changed.
function decide(payload: string, kind: ProposedAction["kind"] = "powershell") {
  const action: ProposedAction = {
    id: "p9",
    kind,
    payload,
    userRequest: "my printer is stuck, please fix it",
  };
  return evaluateActionSync(action);
}

// Print-queue .SPL/.SHD files are a narrow exception since Oct 26 (Jackson):
// they get ask.print.spool.clear instead of a block. See jackson-oct26-decisions.test.ts.
const LITERAL = "Remove-Item C:\\Windows\\System32\\drivers\\e1000.sys -Force";

const BLOCKED_SPELLINGS: Array<[string, string, ProposedAction["kind"]?]> = [
  ["$env:SystemRoot wildcard (paper-out harm)", "Stop-Service Spooler; Remove-Item \"$env:SystemRoot\\System32\\spool\\PRINTERS\\*\" -Force; Start-Service Spooler"],
  ["${env:SystemRoot} delete", "Remove-Item \"${env:SystemRoot}\\System32\\drivers\\e1000.sys\" -Force"],
  ["$env:windir delete", "Remove-Item $env:windir\\System32\\drivers\\e1000.sys"],
  ["%windir% del via cmd", "cmd /c del /q %windir%\\System32\\drivers\\*.sys", "shell"],
  ["%SystemRoot% del", "del /f %SystemRoot%\\System32\\drivers\\e1000.sys", "shell"],
  ["%windir% rd SysWOW64", "rd /s /q %WINDIR%\\SysWOW64", "shell"],
  ["$env:SystemDrive\\Windows", "Remove-Item \"$env:SystemDrive\\Windows\\System32\\drivers\\e1000.sys\""],
  ["forward slashes", "Remove-Item C:/Windows/System32/drivers/e1000.sys"],
  ["doubled backslashes", "Remove-Item 'C:\\\\Windows\\\\System32\\\\drivers\\\\e1000.sys'"],
  ["string concatenation", "Remove-Item ($env:SystemRoot + '\\System32\\drivers\\e1000.sys')"],
  ["Join-Path", "Remove-Item (Join-Path $env:SystemRoot 'System32\\drivers\\e1000.sys')"],
  ["[Environment]::SystemDirectory", "Remove-Item \"$([Environment]::SystemDirectory)\\drivers\\e1000.sys\""],
  ["GetFolderPath('System')", "Remove-Item ([Environment]::GetFolderPath('System') + '\\drivers\\e1000.sys')"],
  ["GetFolderPath SpecialFolder Windows", "Remove-Item -Recurse ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Windows) + '\\Temp')"],
  ["IO.File::Delete with env var", "[System.IO.File]::Delete(\"$env:SystemRoot\\System32\\drivers\\e1000.sys\")"],
];

describe("System32 path spellings (finding P9)", () => {
  it("literal path is blocked (baseline)", () => {
    const d = decide(LITERAL);
    expect(d.kind).toBe("block");
    expect(d.matchedRules).toContain("never.system32.wipe");
  });

  it.each(BLOCKED_SPELLINGS)("blocks %s", (_label, payload, kind) => {
    const d = decide(payload, kind ?? "powershell");
    expect(d.kind).toBe("block");
    expect(d.tier).toBe(4);
  });

  it("canonicalizes spelling only", () => {
    expect(canonicalWindowsPaths("Remove-Item $env:SystemRoot\\System32\\x.dll")).toBe(
      "remove-item c:\\windows\\system32\\x.dll",
    );
    expect(canonicalWindowsPaths("dir %windir%")).toBe("dir c:\\windows");
    expect(canonicalWindowsPaths("Get-ChildItem C:\\Users\\Me\\Downloads")).toBe("");
  });

  it("does not block legitimate non-System32 work", () => {
    for (const payload of [
      "Get-ChildItem \"$env:SystemRoot\\System32\\spool\\PRINTERS\"",
      "Get-Item $env:windir\\System32\\drivers\\etc\\hosts | Select-Object Length",
      "Get-PrintJob -PrinterName 'Office' | Remove-PrintJob",
      "Remove-Item \"$env:TEMP\\lalime-test\\*.tmp\" -Force",
      "Remove-Item \"$env:USERPROFILE\\Downloads\\old-installer.exe\"",
      "Remove-Item C:/Users/Me/Downloads/old.zip",
      "Remove-Item \"$env:LOCALAPPDATA\\Temp\\cache.bin\"",
    ]) {
      const d = decide(payload);
      expect(d.kind, payload).not.toBe("block");
    }
  });
});