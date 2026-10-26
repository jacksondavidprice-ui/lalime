import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { ApiAgentClient } from "../electron/main/api-agent-client.js";
it("logs safe diagnostic metadata without exposing response bodies in chat or logs", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher = vi.fn(async () => new Response("PRIVATE_RESPONSE_BODY", { status: 400 }));
  const client = new ApiAgentClient({ providerId: "openai", model: "fixture", apiKey: "UNIT_TEST_PLACEHOLDER" }, fetcher);
  const messages: string[] = []; client.on("item/completed", (event) => messages.push(event.item.text));
  try {
    await client.start(); const thread = await client.startThread(); const done = once(client, "turn/completed");
    await client.startTurn(thread, "Check the connection"); await done;
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).toContain("HTTP 400");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_RESPONSE_BODY|UNIT_TEST_PLACEHOLDER/);
    expect(messages.join()).not.toMatch(/HTTP|400|PRIVATE_RESPONSE_BODY|UNIT_TEST_PLACEHOLDER/);
  } finally { client.stop(); log.mockRestore(); }
});
