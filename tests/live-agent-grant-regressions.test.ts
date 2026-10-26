import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn-1" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });
const cwd = "C:\\Users\\Example\\Documents";
const narrow = `Set-Content -LiteralPath '${cwd}\\note.txt' -Value 'fixture'`;

async function fixture() {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true, allowScreenCapture: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Update my selected note and inspect the result");
  let sequence = 0;
  const sendCommand = (command = narrow, directory = cwd) => {
    const id = ++sequence;
    client.emit("serverRequest", { id, method: "item/commandExecution/requestApproval", params: { itemId: `command-${id}`, command, cwd: directory } });
    return id;
  };
  const grant = async (command = narrow) => {
    const id = sendCommand(command);
    await vi.waitFor(() => expect(cards).toHaveLength(1));
    expect(cards[0].decision).toMatchObject({ kind: "ask", tier: 2 });
    expect(cards[0].canAllowForTask).toBe(true);
    expect(host.respondApproval("allow_for_task", cards[0].action.id)).toBe(true);
    await vi.waitFor(() => expect(client.respondApproval).toHaveBeenCalledWith(id, "accept"));
    expect(host.getTaskGrants()).toHaveLength(1);
  };
  const screenRead = async () => {
    const id = ++sequence;
    client.emit("serverRequest", { id, method: "item/tool/call", params: { tool: "lalime_list_ui", arguments: { windowTitle: "Editor" } } });
    await vi.waitFor(() => expect(client.respondToolCall).toHaveBeenCalledWith(id, expect.objectContaining({ success: true })));
  };
  return { host, client, cards, sendCommand, grant, screenRead };
}

describe("ordinary command task grants with real Guardian", () => {
  it.each([
    ["a benign command", "Write-Output 'fixture'"],
    ["one non-root file", narrow],
    ["a file read", `Get-Content -LiteralPath '${cwd}\\note.txt'`],
  ])("reuses an identical grant for %s without a second card", async (_label, command) => {
    const f = await fixture();
    await f.grant(command);
    const repeated = f.sendCommand(command);
    await vi.waitFor(() => expect(f.client.respondApproval).toHaveBeenCalledWith(repeated, "accept"));
    expect(f.cards).toHaveLength(1);
  });

  it.each([
    ["another target", narrow.replace("note.txt", "different.txt"), cwd],
    ["another cwd", narrow, "C:\\Users\\Example\\Desktop"],
    ["case and whitespace", `  SET-CONTENT -LiteralPath '${cwd}\\note.txt' -Value 'fixture'`, cwd],
    ["a recursive delete with case and whitespace changes", `  REMOVE-ITEM '${cwd}\\archive' -Recurse -Force`, cwd],
    ["a chained destructive suffix", `${narrow}; Remove-Item '${cwd}\\archive' -Recurse -Force`, cwd],
  ])("requires a new card for %s", async (_label, command, directory) => {
    const f = await fixture();
    await f.grant();
    const changed = f.sendCommand(command, directory);
    await vi.waitFor(() => expect(f.cards).toHaveLength(2));
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(changed, "accept");
    expect(f.cards[1].action.payload).toBe(command);
  });

  it.each(["screen read", "Stop and new turn", "new turn without Stop", "revocation"])("requires fresh consent after %s", async (reset) => {
    const f = await fixture();
    await f.grant();
    if (reset === "screen read") await f.screenRead();
    else if (reset === "revocation") expect(f.host.revokeTaskGrant(f.host.getTaskGrants()[0].id)).toBe(true);
    else {
      if (reset === "Stop and new turn") await f.host.stop();
      f.client.startTurn.mockResolvedValueOnce({ turnId: "turn-2" });
      await f.host.runTurn("Update another note in a new task");
    }
    expect(f.host.getTaskGrants()).toEqual([]);
    const repeated = f.sendCommand();
    await vi.waitFor(() => expect(f.cards).toHaveLength(2));
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(repeated, "accept");
    if (reset === "screen read") {
      expect(f.cards[1].action.fromUntrustedContent).toBe(true);
      expect(f.cards[1].canAllowForTask).toBe(false);
    }
  });

  it.each([
    `Remove-Item -LiteralPath '${cwd}\\note.txt'`,
    `Remove-Item '${cwd}' -Recurse -Force`,
    `Remove-Item '${cwd}' -Rec -Force`,
  ])("keeps permanent deletion ineligible for a grant: %s", async (command) => {
    const f = await fixture();
    const id = f.sendCommand(command);
    await vi.waitFor(() => expect(f.cards).toHaveLength(1));
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(id, "accept");
  });
});
