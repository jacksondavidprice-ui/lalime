import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";

class Client extends EventEmitter {
  async startThread() { return "thread"; }
  async startTurn() { return { turnId: "turn" }; }
  async interruptTurn() {}
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
describe("provider transport termination", () => {
  it.each(["exit", "transportError"])("ends an active turn safely on %s", async (event) => {
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands());
    const error = vi.fn();
    const done = vi.fn();
    host.on("error", error);
    host.on("turnDone", done);
    await host.runTurn("Help");
    client.emit("serverRequest", { id: 1, method: "item/fileChange/requestApproval", params: { reason: "Edit file" } });
    await flush();
    client.emit(event, new Error("private transport credential detail"));
    client.emit(event === "exit" ? "transportError" : "exit", 1);
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/connection|disconnected/i);
    expect(error.mock.calls[0][0]).not.toContain("private transport");
    expect(client.respondFileChangeApproval).toHaveBeenCalledExactlyOnceWith(1, "decline");
    expect(done).not.toHaveBeenCalled();
  });

  it("reports closure through status when no error listener is installed", async () => {
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands());
    const status = vi.fn();
    host.on("status", status);
    await host.runTurn("Help");
    expect(() => client.emit("transportError", new Error("private detail"))).not.toThrow();
    expect(status.mock.calls.at(-1)?.[0]).toMatch(/connection|disconnected/i);
  });

  it("marks an externally interrupted plan skipped and does not emit success", async () => {
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands());
    const error = vi.fn();
    const done = vi.fn();
    const plan = vi.fn();
    host.on("error", error);
    host.on("turnDone", done);
    host.on("plan", plan);
    await host.runTurn("Help");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_update_plan", arguments: { steps: [{ label: "Check state", status: "running" }] } } });
    await flush();
    client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "interrupted" } });
    expect(plan.mock.calls.at(-1)?.[0][0].status).toBe("skipped");
    expect(error.mock.calls[0][0]).toMatch(/interrupted/i);
    expect(done).not.toHaveBeenCalled();
  });

  it("does not throw on a failed turn without an error listener", async () => {
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands());
    const status = vi.fn();
    host.on("status", status);
    await host.runTurn("Help");
    expect(() => client.emit("turn/completed", { turn: { id: "turn", status: "failed" } })).not.toThrow();
    expect(status.mock.calls.at(-1)?.[0]).toMatch(/problem talking to the AI service/i);
  });
});
