import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";

const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });

const reads = [
  { tool: "lalime_screenshot", method: "screenshot", result: { ok: true, output: "PRIVATE_SCREEN_FIXTURE", imageDataUrl: "data:image/png;base64,PRIVATE_IMAGE_FIXTURE" } },
  { tool: "lalime_list_windows", method: "listWindows", result: { ok: true, windows: [{ title: "PRIVATE_WINDOW_FIXTURE" }] } },
  { tool: "lalime_list_ui", method: "listUiElements", result: { ok: true, elements: [{ name: "PRIVATE_CONTROL_FIXTURE" }] } },
] as const;

it.each(reads)("withholds $tool data when its deferred read finishes after Stop", async ({ tool, method, result }) => {
  const f = await fixture(method);
  f.send(tool);
  expect(f.read).toHaveBeenCalledOnce();
  await f.host.stop();
  f.finish(result);
  await flush();
  expect(f.client.respondToolCall).toHaveBeenCalledExactlyOnceWith(1, expect.objectContaining({ success: false }));
  expect(JSON.stringify(f.client.respondToolCall.mock.calls)).not.toContain("PRIVATE_");
  const response = f.client.respondToolCall.mock.calls[0][1];
  expect(response.contentItems.every((item: { type: string }) => item.type !== "inputImage")).toBe(true);
});

it.each(reads)("withholds $tool data from an old read after another task starts", async ({ tool, method, result }) => {
  const f = await fixture(method);
  f.send(tool);
  expect(f.read).toHaveBeenCalledOnce();
  await f.host.stop();
  f.client.startTurn.mockResolvedValueOnce({ turnId: "next-turn" });
  await f.host.runTurn("A separate task");
  f.finish(result);
  await flush();
  expect(f.client.respondToolCall).toHaveBeenCalledExactlyOnceWith(1, expect.objectContaining({ success: false }));
  expect(JSON.stringify(f.client.respondToolCall.mock.calls)).not.toContain("PRIVATE_");
});

async function fixture(method: typeof reads[number]["method"]) {
  class Client extends EventEmitter {
    startThread = vi.fn(async () => "thread");
    startTurn = vi.fn(async () => ({ turnId: "turn" }));
    interruptTurn = vi.fn(async () => {});
    respondApproval = vi.fn();
    respondFileChangeApproval = vi.fn();
    respondToolCall = vi.fn();
  }
  const client = new Client();
  const hands = new MockHands();
  let finish!: (value: unknown) => void;
  const read = vi.spyOn(hands, method).mockImplementation(() => new Promise((resolve) => { finish = resolve; }) as never);
  const host = new LiveAgentHost(client, hands, { allowScreenCapture: true, allowComputerControl: true });
  hosts.push(host);
  await host.runTurn("Read my screen");
  const send = (tool: string) => client.emit("serverRequest", {
    id: 1, method: "item/tool/call", params: { threadId: "thread", turnId: "turn", tool, arguments: { windowTitle: "Editor" } },
  });
  return { client, host, read, send, finish: (value: unknown) => finish(value) };
}
