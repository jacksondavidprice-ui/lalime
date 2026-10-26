import { describe, expect, it } from "vitest";
import { CodexAppServerClient } from "../electron/main/codex-client.js";
import {
  FakeCodexServer,
  dangerousCommandScenario,
  recycleAskScenario,
} from "../electron/main/fake-codex-server.js";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { GuardianDecision, PendingApproval } from "../shared/types.js";

function waitFor<T>(
  subscribe: (cb: (v: T) => void) => void,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    subscribe((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

describe("LiveAgentHost + fake Codex", () => {
  it("streams deltas and runs a screenshot tool through Hands", async () => {
    const fake = new FakeCodexServer();
    const client = new CodexAppServerClient({ transport: fake.transport() });
    await client.start();
    await client.loginWithApiKey("sk-test");

    const hands = new MockHands();
    const host = new LiveAgentHost(client, hands);

    const deltas: string[] = [];
    host.on("delta", (d: string) => deltas.push(d));

    // When tool call arrives, fake server waits for our respondToolCall —
    // LiveAgentHost handles it. Then we need turn/completed.
    fake.setScenario({
      afterTurn: [
        { method: "item/agentMessage/delta", params: { delta: "Hello " } },
        { method: "item/agentMessage/delta", params: { delta: "from Lalime." } },
        {
          method: "item/completed",
          params: {
            item: {
              id: "m1",
              type: "agentMessage",
              text: "Hello from Lalime.",
            },
          },
        },
        {
          id: 9100,
          method: "item/tool/call",
          params: {
            threadId: "thr_fake_1",
            turnId: "turn_fake_1",
            callId: "t1",
            tool: "lalime_screenshot",
            arguments: {},
          },
        },
        { method: "turn/completed", params: { turn: { id: "turn_fake_1" } } },
      ],
    });

    const done = waitFor<void>((cb) => host.on("turnDone", () => cb()));
    await host.runTurn("What's on my screen?");
    // Allow tool response cycle
    await new Promise((r) => setTimeout(r, 80));
    // Fake server doesn't auto-complete after tool response; emit turn done already in scenario
    await done.catch(() => undefined);

    expect(deltas.join("")).toContain("Hello");
    client.stop();
  });

  it("declines dangerous System32 command via Guardian", async () => {
    const fake = new FakeCodexServer();
    fake.setScenario({
      afterTurn: dangerousCommandScenario("thr_fake_1", "turn_fake_1"),
    });
    const client = new CodexAppServerClient({ transport: fake.transport() });
    await client.start();
    const host = new LiveAgentHost(client, new MockHands());

    const blocked = waitFor<GuardianDecision>((cb) => host.on("blocked", cb));
    const clientResp = waitFor<{ id?: number; result?: { decision?: string } }>((cb) =>
      fake.on("clientResponse", cb),
    );

    await host.runTurn("Delete everything in System32 to speed up my PC.");
    const decision = await blocked;
    expect(decision.kind).toBe("block");
    expect(decision.matchedRules.some((r) => r.includes("system32") || r === "hands.precheck")).toBe(
      true,
    );

    const resp = await clientResp;
    expect(resp.result?.decision).toBe("decline");
    client.stop();
  });

  it("asks before recycle and accepts after UI OK", async () => {
    const fake = new FakeCodexServer();
    fake.setScenario({
      afterTurn: recycleAskScenario("thr_fake_1", "turn_fake_1"),
    });
    const client = new CodexAppServerClient({ transport: fake.transport() });
    await client.start();
    const host = new LiveAgentHost(client, new MockHands());

    const pending = waitFor<PendingApproval>((cb) => host.on("approvalNeeded", cb));
    await host.runTurn("My Downloads folder is a mess, clean it up.");
    const card = await pending;
    expect(card.decision.kind).toMatch(/ask/);

    const activity = waitFor<{ summary: string }>((cb) => host.on("activity", cb));
    host.respondApproval("do_it", card.action.id);
    const act = await activity;
    expect(act.summary.toLowerCase()).toMatch(/recycle|installer/);
    client.stop();
  });
});
