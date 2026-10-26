import { once, EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { DEVELOPER_INSTRUCTIONS, LALIME_DYNAMIC_TOOLS } from "../electron/main/agent-prompt.js";
import { ApiAgentClient } from "../electron/main/api-agent-client.js";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";

it("plans multiple plausible causes before tests, then ranks evidence", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/2-4 plausible causes.*lalime_update_plan.*before testing/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/rank.*causes.*evidence/i);
  expect(LALIME_DYNAMIC_TOOLS[0].description).toMatch(/2-4 plausible causes.*before testing/i);
});
it("requires sampled, normalized process evidence before slow-PC changes", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/per-process CPU.*twice/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/elapsed.*logical processor count/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/top process.*command line.*before changing any setting/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/confirmed runaway user process.*power plan/i);
});
it("asks about real files after showing sizes instead of bundling unrelated installers", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/show.*files.*sizes.*ask which.*unless.*named.*files/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/never bulk-recycle unrelated installers.*one card/i);
});
it("uses plain punctuation and preserves one alternative plus manual steps after decline", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/no em or en dashes.*sentence punctuation/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/decline.*one alternative.*manual steps/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/do not retry it or work around it/i);
});
for (const providerId of ["openai", "anthropic"]) {
  it(`sends the shared repair instructions on the ${providerId} API path`, async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(providerId === "anthropic"
      ? { content: [{ type: "text", text: "Checked" }], stop_reason: "end_turn" }
      : { choices: [{ message: { content: "Checked" }, finish_reason: "stop" }] }), { status: 200 }));
    const client = new ApiAgentClient({ providerId, model: "fixture", apiKey: "unit-test-placeholder" }, fetcher);
    const host = new LiveAgentHost(client, new MockHands());
    try {
      await client.start(); const done = once(client, "turn/completed");
      await host.runTurn("My PC is slow"); await done;
      const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      const instructions = providerId === "anthropic" ? body.system : body.messages[0].content;
      expect(instructions).toBe(DEVELOPER_INSTRUCTIONS);
      expect(instructions).toMatch(/2-4 plausible causes/);
    } finally { await host.stop(); client.stop(); }
  });
}
it("shows the real registry backup capability without changing Guardian hold", async () => {
  const client = Object.assign(new EventEmitter(), {
    startThread: vi.fn(async () => "thread"), startTurn: vi.fn(async () => ({ turnId: "turn" })),
    interruptTurn: vi.fn(async () => {}), respondApproval: vi.fn(), respondFileChangeApproval: vi.fn(), respondToolCall: vi.fn(),
  });
  const hands = new MockHands(); const run = vi.spyOn(hands, "runPowerShell");
  const host = new LiveAgentHost(client, hands);
  try {
    await host.runTurn("Change this test app preference"); const cardReady = once(host, "approvalNeeded");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: {
      tool: "lalime_run_powershell", arguments: {
        command: "Set-ItemProperty HKCU:\\Software\\LalimeFixture -Name Enabled -Value 1", why: "Change the test preference",
      },
    } });
    const [card] = await cardReady;
    expect(card.decision).toMatchObject({ kind: "ask_hold", tier: 3, undoable: false });
    expect(card.decision.matchedRules).toContain("ask.registry");
    expect(card.decision.plainEnglish).not.toContain("A backup will be kept first.");
    expect(card.decision.plainEnglish).toMatch(/does not automatically back up.*or provide Undo/i);
    host.respondApproval("not_now", card.action.id);
    expect(run).not.toHaveBeenCalled();
  } finally { await host.stop(); }
});
