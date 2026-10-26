import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => state.directory }, shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false } }));
import { SessionController } from "../electron/main/session.js";
import { MockHands } from "../hands/mock/index.js";

let server: Server;
let controller: SessionController;
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lime-provider-")); });
afterEach(async () => {
  controller?.dispose();
  if (server) await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  rmSync(state.directory, { recursive: true, force: true });
});

describe("complete session over a local HTTP provider", () => {
  it("asks for the displayed action, executes once, and keeps context for a second message", async () => {
    const requests: any[] = [];
    server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const parsedBody = JSON.parse(body);
      if (parsedBody.max_tokens === 128 && !parsedBody.tools) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }));
        return;
      }
      requests.push(parsedBody);
      const message = requests.length === 1
        ? { role: "assistant", content: null, tool_calls: [{ id: "tool-1", type: "function", function: { name: "lalime_open_settings", arguments: JSON.stringify({ uri: "ms-settings:display" }) } }] }
        : { role: "assistant", content: requests.length === 2 ? "Display settings are open." : "We opened Display settings." };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const hands = new MockHands();
    const open = vi.spyOn(hands, "openSettings");
    controller = new SessionController(hands);
    expect(controller.updateSettings({ providerId: "custom", model: "test-model", baseUrl: `http://127.0.0.1:${address.port}/v1`, allowComputerControl: true }).ok).toBe(true);
    expect((await controller.connectProvider()).ok).toBe(true);
    await controller.sendMessage("Open Display settings");
    await vi.waitFor(() => expect(controller.getSnapshot().pendingApproval).not.toBeNull());
    expect(open).not.toHaveBeenCalled();
    const approval = controller.getSnapshot().pendingApproval!;
    await controller.respondApproval("do_it", "stale-action");
    expect(open).not.toHaveBeenCalled();
    await controller.respondApproval("do_it", approval.action.id);
    await vi.waitFor(() => expect(controller.getSnapshot().running).toBe(false));
    expect(open).toHaveBeenCalledExactlyOnceWith("ms-settings:display");
    expect(controller.getSnapshot().messages.at(-1)?.content).toBe("Display settings are open.");
    await controller.sendMessage("What did we do?");
    await vi.waitFor(() => expect(controller.getSnapshot().running).toBe(false));
    expect(controller.getSnapshot().messages.at(-1)?.content).toBe("We opened Display settings.");
    expect(requests[2].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: "Open Display settings" })]));
    expect(requests[0]).not.toHaveProperty("temperature");
  });

  it("cannot reconnect after an immediate disconnect", async () => {
    controller = new SessionController(new MockHands());
    controller.updateSettings({ providerId: "ollama", model: "test-model" });
    const connection = controller.connectProvider();
    controller.disconnect();
    await connection;
    expect(controller.getSnapshot().auth.state).toBe("signed_out");
  });
});
