import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });
const folder = "C:\\Users\\Fixture\\Downloads";
const file = `${folder}\\a.tmp`;

async function fixture(command: string) {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Work with the selected temporary file");
  const request = async (id: number) => {
    client.emit("serverRequest", {
      id, method: "item/commandExecution/requestApproval",
      params: { itemId: `command-${id}`, command, cwd: folder },
    });
    await flush();
  };
  await request(1);
  expect(cards).toHaveLength(1);
  return { host, client, cards, request };
}

const deletionCommands = [
  ["wildcard member dispatch", `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -MemberName D*lete`],
  ["deletion inside quoted subexpression", `Write-Output "$(Remove-Item '${file}')"`],
  ["deletion inside array", `@(Remove-Item '${file}')`],
  ["deletion inside calculated property", `Get-Item '${file}' | Select-Object @{n='x';e={ $_.Delete() }}`],
  ["deletion after comment ending in backtick", `Write-Output x # comment\u0060\nRemove-Item '${file}'`],
  ["continued deletion command", `Remove-\u0060\nItem '${file}'`],
  ["robocopy splatted flags", `$p = @('/MIR'); robocopy '${folder}\\a' '${folder}\\b' @p`],
  ["chained BaseObject Delete", `(Get-Item '${file}').PSObject.BaseObject.Delete()`],
  ["pipeline chained BaseObject Delete", `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object { $_.PSObject.BaseObject.Delete() }`],
  ...["\u2013", "\u2014", "\u2015"].map((dash) => [`Unicode dash ${dash}`, `Remove${dash}Item '${file}'`]),
  ["InvokeCommand script dispatch", `$ExecutionContext.InvokeCommand.InvokeScript('Remove-' + 'Item ${file}')`],
  ...["robocopy", "xcopy"].flatMap((command) => ["MIR", "PURGE", "MOV", "MOVE"].map((flag) => [`${command} /${flag}`, `${command} '${folder}\\source' '${folder}\\dest' /${flag}`])),
  ["System.IO.File static Delete", `[System.IO.File]::Delete('${file}')`],
  ["IO.Directory static Delete", `[IO.Directory]::Delete('${folder}\\empty')`],
  ["FileInfo instance Delete", `(New-Object System.IO.FileInfo '${file}').Delete()`],
  ["FileInfo constructor Delete", `[System.IO.FileInfo]::new('${file}').Delete()`],
  ["ForEach-Object member Delete", `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object { $_.Delete() }`],
  ["percent alias member Delete", `Get-ChildItem '${folder}\\*.tmp' | % { $_.Delete() }`],
  ["foreach block member Delete", `foreach ($item in (Get-ChildItem '${folder}\\*.tmp')) { $item.Delete() }`],
  ["quoted member Delete", `(Get-Item '${file}').'Delete'()`],
  ["spaced quoted member Delete", `(Get-Item '${file}'). 'Delete'()`],
  ["module-qualified Remove-Item", `Microsoft.PowerShell.Management\\Remove-Item -LiteralPath '${file}'`],
  ["Remove-ItemProperty", "Remove-ItemProperty -Path 'HKCU:\\Software\\Fixture' -Name 'Temporary'"],
  ["Remove-ItemProperty alias rp", "rp -Path 'HKCU:\\Software\\Fixture' -Name 'Temporary'"],
  ["literal command invocation", `& 'Remove-Item' '${file}'`],
  ["constructed command invocation", `& ('Remove-' + 'Item') '${file}'`],
  ["constructed member invocation", `(Get-Item '${file}').('De' + 'lete')()`],
  ["interpolated executable expression", `Write-Output "$([IO.File]::Delete('${file}'))"`],
  ["ForEach member-name dispatch", `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -MemberName Delete`],
  ["ForEach positional member dispatch", `Get-ChildItem '${folder}\\*.tmp' | % Delete`],
  ["static Delete on a type variable", `$fileType = [IO.File]; $fileType::Delete('${file}')`],
  ["ForEach computed member dispatch", `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -MemberName ('De' + 'lete')`],
  ["ForEach abbreviated dynamic member", `$member = 'Delete'; Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -Member $member`],
  ["ForEach colon-bound member", `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -MemberName:Delete`],
  ["ForEach colon-bound dynamic member", `$member = 'Delete'; Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -Member:$member`],
  ["collection ForEach member dispatch", `(Get-ChildItem '${folder}\\*.tmp').ForEach('Delete')`],
  ["ForEach positional dynamic member after common parameter", `$member = 'Delete'; Get-ChildItem '${folder}\\*.tmp' | ForEach-Object -ErrorAction Stop $member`],
  ["fragmented deletion command name", `Remove-'Item' '${file}'`],
  ...["rm", "ri", "del", "erase", "rd", "rmdir"].map((alias) => [alias, `${alias} '${file}'`]),
] as const;

describe("delete commands never receive reusable task grants", () => {
  it.each(deletionCommands)("does not grant %s", async (_label, command) => {
    const f = await fixture(command);
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
    await flush();
    expect(f.host.getTaskGrants()).toEqual([]);
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(1, "accept");
  });
});

const ordinaryCommands = [
  ...["Invoke-Item", "ii", "explorer"].map((command) => [`${command} local document`, `${command} '${folder}\\guide.pdf'`]),
  ["Invoke-Item named path", `Invoke-Item -LiteralPath '${folder}\\guide.pdf'`],
  ["profile subexpression in a string", 'Write-Output "$($env:USERPROFILE)\\Documents"'],
  ["checked command subexpression", 'Write-Output "$(Get-Date)"'],
  ["line continuation", `Get-Content -LiteralPath \u0060\r\n '${file}'`],
  ["literal array and pipeline", "@('a','b') | % { Write-Output $_ }"],
  ["splat for a read command", `$p = @{LiteralPath='${file}'}; Get-Content @p`],
  ["literal here-string", `Set-Content -LiteralPath '${file}' -Value @'\nRemove-Item is literal text\n'@`],
  ["calculated property", `Get-Item '${file}' | Select-Object @{n='Name';e={$_.Name}}`],
  ["open document", `Start-Process '${folder}\\guide.pdf'`],
  ["open document alias", `start '${folder}\\notes.txt'`],
  ["smart quotes within an unquoted path", `Get-Content ${folder}\\report\u2019s.txt`],
  ["nonexecuted delete comment on move", `Move-Item '${file}' '${folder}\\b.tmp' # not Remove-Item`],
  ["robocopy without deletion flags", `robocopy '${folder}\\source' '${folder}\\dest' /E`],
  ["a filename containing rm", `Get-Content -LiteralPath '${folder}\\rm.txt'`],
  ["an unquoted filename containing rm", `Get-Content ${folder}\\rm.txt`],
  ["a filename containing a deletion verb", `Get-Content ${folder}\\Remove-Item.txt`],
  ["literal deletion command text", "Write-Output 'Remove-Item and Delete are words in this message'"],
  ["literal method-call text", `Write-Output "[System.IO.File]::Delete('${file}')"`],
  ["a line comment containing deletion", `Write-Output fixture # Remove-Item '${file}'; [System.IO.File]::Delete('${file}')`],
  ["a block comment containing deletion", `Write-Output <# Remove-Item '${file}'; $_.Delete() #> fixture`],
  ["ordinary output", "Write-Output fixture"],
] as const;

describe("non-executed delete words do not prevent ordinary grants", () => {
  it.each(ordinaryCommands)("reuses an exact grant for %s", async (_label, command) => {
    const f = await fixture(command);
    expect(f.cards[0].canAllowForTask).toBe(true);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledWith(1, "accept");
    await f.request(2);
    expect(f.client.respondApproval).toHaveBeenCalledWith(2, "accept");
    expect(f.cards).toHaveLength(1);
  });
});

describe("existing content-edit grant policy is preserved", () => {
  it.each([
    ["Clear-Content", `Clear-Content -LiteralPath '${file}'`],
    ["empty Set-Content", `Set-Content -LiteralPath '${file}' -Value ''`],
  ])("retains the existing exact-grant behavior for %s", async (_label, command) => {
    const f = await fixture(command);
    expect(f.cards[0].canAllowForTask).toBe(true);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true);
    await flush();
    await f.request(2);
    expect(f.client.respondApproval).toHaveBeenCalledWith(2, "accept");
    expect(f.cards).toHaveLength(1);
  });
});

describe("ambiguous launch targets keep individual consent", () => {
  it.each([
    "Start-Process '\\/server/share/guide.pdf'",
    "Invoke-Item '/\\server/share/guide.pdf'",
    ...["Invoke-Item", "ii", "explorer"].flatMap((command) => ["exe", "ps1", "bat", "cmd", "lnk", "url"].map((extension) => `${command} '${folder}\\setup.${extension}'`)),
    ...["Start-Process", "Invoke-Item", "ii", "explorer"].flatMap((command) => ["\\\\server\\share\\guide.pdf", "//server/share/guide.pdf", "file:///C:/guide.pdf", "http://example.test/guide.pdf", "https://example.test/guide.pdf"].map((target) => `${command} '${target}'`)),
    ...["/JOB:config.rcj", "/SAVE:config.rcj", "/NOSD", "/NODD"].map((option) => `robocopy '${folder}\\source' '${folder}\\target' ${option}`),
    "start notepad x.txt",
    `Start-Process '${folder}\\app.exe'`,
    `Start-Process '${folder}\\script.ps1'`,
    `Start-Process '${folder}\\script.bat'`,
    `Start-Process '${folder}\\script.cmd'`,
    `Start-Process '${folder}\\guide.pdf' -ArgumentList 'extra'`,
    "Start-Process $target",
    "Start-Process 'custom-protocol:payload.pdf'",
    `Start-Process '${folder}\\script.exe:payload.pdf'`,
  ])("does not grant %s", async (command) => {
    const f = await fixture(command);
    expect(f.cards[0].canAllowForTask).toBe(false);
  });
});

it("explains the grant length limit without calling ordinary syntax unsupported", async () => {
  const f = await fixture(`Set-Content '${file}' -Value '${"x".repeat(200_000)}'`);
  expect(f.cards[0].canAllowForTask).toBe(false);
  expect((f.cards[0] as { grantUnavailableReason?: string }).grantUnavailableReason).toMatch(/too long/i);
  expect(f.cards[0].grantUnavailableReason).toBe("This command is too long to check for Allow-for-task. You can still approve it once.");
});
