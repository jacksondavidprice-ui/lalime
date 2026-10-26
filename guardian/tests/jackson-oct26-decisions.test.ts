import { describe, expect, it } from "vitest";
import { evaluateActionSync } from "../src/index.js";
import type { ProposedAction } from "../../shared/types.js";

// Jackson's policy decisions of Oct 26, 2026 (P8, P10, P11, Defender, UI tiers).
function decide(payload: string, kind: ProposedAction["kind"] = "powershell", extra: Partial<ProposedAction> = {}) {
  return evaluateActionSync({ id: "oct26", kind, payload, userRequest: "please fix my PC", ...extra });
}

describe("P8: print-queue job files are a narrow ask, not a block", () => {
  it.each([
    "Remove-Item C:\\Windows\\System32\\spool\\PRINTERS\\JOB0077.SPL -Force",
    "Remove-Item \"$env:SystemRoot\\System32\\spool\\PRINTERS\\JOB0077.SPL\",\"$env:SystemRoot\\System32\\spool\\PRINTERS\\JOB0077.SHD\" -Force",
    "Stop-Service Spooler; Remove-Item \"$env:SystemRoot\\System32\\spool\\PRINTERS\\*.SPL\",\"$env:SystemRoot\\System32\\spool\\PRINTERS\\*.SHD\" -Force; Start-Service Spooler",
  ])("asks with a lost-job warning: %s", (payload) => {
    const d = decide(payload);
    expect(d.kind).not.toBe("block");
    expect(d.matchedRules).toContain("ask.print.spool.clear");
    expect(d.plainEnglish).toMatch(/print job still waiting will be lost/);
    expect(d.undoable).toBe(false);
  });

  it("works through cmd del with %windir%", () => {
    const d = decide("cmd /c del /q %windir%\\System32\\spool\\PRINTERS\\*.SPL", "shell");
    expect(d.kind).not.toBe("block");
    expect(d.matchedRules).toContain("ask.print.spool.clear");
  });

  it.each([
    "Remove-Item \"$env:SystemRoot\\System32\\spool\\PRINTERS\\*\" -Force",
    "Remove-Item C:\\Windows\\System32\\spool\\PRINTERS -Recurse -Force",
    "Remove-Item C:\\Windows\\System32\\spool\\drivers\\x64\\3\\unidrv.dll",
    "Remove-Item C:\\Windows\\System32\\spool\\PRINTERS\\..\\..\\config\\x.spl",
    "Remove-Item C:\\Windows\\System32\\spool\\PRINTERS\\a.spl, C:\\Windows\\System32\\drivers\\e1000.sys",
    "Remove-Item C:\\Windows\\System32\\spool\\PRINTERS\\a.spl.dll",
  ])("still blocks anything beyond job files: %s", (payload) => {
    const d = decide(payload);
    expect(d.kind).toBe("block");
    expect(d.matchedRules).toContain("never.system32.wipe");
  });
});

describe("P10: moves and renames of system files are blocked", () => {
  it.each<[string, ProposedAction["kind"]?]>([
    ["Move-Item C:\\Windows\\System32\\drivers\\e1000.sys C:\\Users\\Me\\Desktop"],
    ["Move-Item $env:SystemRoot\\System32\\drivers\\e1000.sys -Destination $env:TEMP"],
    ["Rename-Item C:\\Windows\\System32\\drivers\\e1000.sys e1000.old"],
    ["mv C:\\Windows\\SysWOW64\\x.dll C:\\temp"],
    ["move %windir%\\System32\\x.dll C:\\temp", "shell"],
    ["ren C:\\Windows\\System32\\x.dll x.bak", "shell"],
    ["robocopy C:\\Windows\\System32\\drivers C:\\backup /MOVE", "shell"],
    ["robocopy C:\\empty C:\\Windows\\System32 /MIR", "shell"],
    ["xcopy C:\\Windows\\System32\\drivers C:\\backup /E", "shell"],
    ["[System.IO.File]::Move('C:\\Windows\\System32\\x.dll', 'C:\\temp\\x.dll')"],
  ])("blocks %s", (payload, kind) => {
    const d = decide(payload, kind ?? "powershell");
    expect(d.kind).toBe("block");
    expect(d.matchedRules).toContain("never.system32.wipe");
  });

  it("allows read-only and copy-out-by-robocopy-without-move", () => {
    expect(decide("robocopy C:\\Windows\\System32\\drivers C:\\backup /E", "shell").kind).not.toBe("block");
    expect(decide("Move-Item C:\\Users\\Me\\Downloads\\a.zip C:\\Users\\Me\\Desktop").kind).not.toBe("block");
  });
});

describe("P11: permanent delete asks first and is never undoable", () => {
  it.each([
    "Remove-Item 'C:\\Program Files\\Backblaze' -Recurse -Force",
    "Remove-Item \"$env:TEMP\\old.log\"",
    "cmd /c rd /s /q \"C:\\Program Files (x86)\\OldApp\"",
    "[System.IO.Directory]::Delete('C:\\ProgramData\\OldApp', $true)",
    "Get-ChildItem C:\\Users\\Me\\Downloads\\*.tmp | ForEach-Object { $_.Delete() }",
  ])("tier-3 hold for %s", (payload) => {
    const d = decide(payload);
    expect(d.kind).toBe("ask_hold");
    expect(d.tier).toBe(3);
    expect(d.matchedRules).toContain("ask.permanent.delete");
    expect(d.plainEnglish).toMatch(/cannot be restored/);
    expect(d.undoable).toBe(false);
  });

  it("file_delete actions are not undoable", () => {
    const d = decide("delete:C:\\Users\\Me\\a.txt", "file_delete", { paths: ["C:\\Users\\Me\\a.txt"] });
    expect(d.kind).toBe("ask_hold");
    expect(d.undoable).toBe(false);
  });

  it("Recycle Bin moves stay undoable at tier 2", () => {
    const d = decide("recycle:C:\\Users\\Me\\Downloads\\a.zip", "file_move", { paths: ["C:\\Users\\Me\\Downloads\\a.zip"] });
    expect(d.kind).toBe("ask");
    expect(d.undoable).toBe(true);
  });

  it("Clear-RecycleBin is not labelled undoable", () => {
    const d = decide("Clear-RecycleBin -Force");
    expect(d.matchedRules).toContain("ask.recycle.bin.empty");
    expect(d.matchedRules).not.toContain("ask.recycle.bin.move");
    expect(d.undoable).toBe(false);
    expect(d.tier).toBe(3);
  });
});

describe("Defender is an ask; firewall, UAC and Update stay blocked", () => {
  it("re-enabling Defender is not raised to a hold", () => {
    expect(decide("Set-MpPreference -DisableRealtimeMonitoring $false").matchedRules).not.toContain("ask.defender.change");
    expect(decide("Get-MpPreference | Select-Object DisableRealtimeMonitoring").matchedRules).not.toContain("ask.defender.change");
  });
  it.each([
    "netsh advfirewall set allprofiles state off",
    "Set-NetFirewallProfile -Enabled False",
    "Set-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System -Name EnableLUA -Value 0",
    "Stop-Service wuauserv",
  ])("blocks %s", (payload) => {
    expect(decide(payload).matchedRules).toContain("never.defender.disable");
  });
});

describe("UI steps are tier 1 (Jackson: typing and settings stay tier 1)", () => {
  it.each<ProposedAction["kind"]>(["ui_click", "ui_type", "open_settings"])("%s", (kind) => {
    const d = decide(kind === "open_settings" ? "ms-settings:printers" : "click:OK", kind);
    expect(d.tier).toBe(1);
    expect(d.kind).toBe("allow_with_journal");
  });
});

describe("delete words that do not run are not permanent deletes", () => {
  it.each([
    "Get-Content C:\\Users\\Me\\rm.txt",
    "Get-Content C:\\Users\\Me\\Remove-Item.txt",
    "Write-Output 'Remove-Item and Delete are words'",
    "Write-Output \"[System.IO.File]::Delete('C:\\x')\"",
    "Write-Output fixture # Remove-Item 'C:\\x'; [System.IO.File]::Delete('C:\\x')",
    "Write-Output <# Remove-Item 'C:\\x'; $_.Delete() #> fixture",
  ])("%s", (payload) => {
    expect(decide(payload).matchedRules).not.toContain("ask.permanent.delete");
  });
  it.each([
    "Re`move-Item C:\\Users\\Me\\a.txt",
    "Get-ChildItem *.tmp | ri",
    "$null = Remove-Item C:\\Users\\Me\\a.txt",
    "powershell -Command \"Remove-Item C:\\Users\\Me\\a.txt\"",
    "(Get-Item C:\\Users\\Me\\a.txt).Delete()",
  ])("still catches %s", (payload) => {
    expect(decide(payload).matchedRules).toContain("ask.permanent.delete");
  });
});

describe("consequential UI steps still get a card (pt49u: fewer risky steps from weaker models)", () => {
  it.each<[ProposedAction["kind"], string]>([
    ["ui_click", "{\"operation\":\"click\",\"name\":\"Uninstall\",\"windowTitle\":\"Apps\"}"],
    ["ui_click", "{\"operation\":\"click\",\"name\":\"Yes\",\"windowTitle\":\"Reset this PC\"}"],
    ["ui_click", "{\"operation\":\"click\",\"name\":\"Turn off\",\"windowTitle\":\"Windows Security\"}"],
    ["ui_type", "{\"operation\":\"type\",\"text\":\"Get-Date\",\"windowTitle\":\"Windows PowerShell\"}"],
    ["ui_type", "{\"operation\":\"type\",\"text\":\"cmd\",\"windowTitle\":\"Run\"}"],
  ])("%s %s", (kind, payload) => {
    const d = decide(payload, kind);
    expect(d.kind).toBe("ask");
    expect(d.tier).toBe(2);
    expect(d.undoable).toBe(false);
  });
  it.each<[ProposedAction["kind"], string]>([
    ["ui_click", "{\"operation\":\"click\",\"name\":\"Next\",\"windowTitle\":\"Printers & scanners\"}"],
    ["ui_type", "{\"operation\":\"type\",\"text\":\"hello\",\"windowTitle\":\"Notepad\"}"],
  ])("ordinary %s %s stays tier 1", (kind, payload) => {
    expect(decide(payload, kind).tier).toBe(1);
  });
});

describe("clicks in Windows security windows get a card even when the control is just a toggle", () => {
  it.each([
    "{\"operation\":\"click\",\"name\":\"Off\",\"windowTitle\":\"Windows Security\"}",
    "{\"operation\":\"click\",\"name\":\"Real-time protection\",\"windowTitle\":\"Settings\"}",
    "{\"operation\":\"click\",\"name\":\"On\",\"windowTitle\":\"Virus & threat protection settings\"}",
    "{\"operation\":\"click\",\"name\":\"Allow an app through firewall\",\"windowTitle\":\"Windows Defender Firewall\"}",
    "{\"operation\":\"click\",\"name\":\"Stop\",\"windowTitle\":\"Services\"}",
    "{\"operation\":\"click\",\"name\":\"Pause for 1 week\",\"windowTitle\":\"Windows Update\"}",
  ])("%s", (payload) => {
    const d = decide(payload, "ui_click");
    expect(d.kind).toBe("ask");
    expect(d.tier).toBe(2);
    expect(d.undoable).toBe(false);
    expect(d.matchedRules).toContain("ask.ui.security.window");
  });
  it("an ordinary Settings toggle stays tier 1", () => {
    expect(decide("{\"operation\":\"click\",\"name\":\"Night light\",\"windowTitle\":\"Settings\"}", "ui_click").tier).toBe(1);
  });
});
