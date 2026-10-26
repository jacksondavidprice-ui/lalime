import type { CodexAppServerClient } from "./codex-client.js";

/** A separate, tool-free thread. Its text never enters the user's conversation. */
export async function checkCodexConnection(client: CodexAppServerClient, model: string | undefined, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const threadId = await client.startThread({ model, dynamicTools: [], developerInstructions: "This is a connection check. Reply with OK only. Do not use tools or act on the computer." });
  signal.throwIfAborted();
  let turnId: string | undefined;
  let starting = true;
  let receivedText = false;
  const early: Array<() => void> = [];
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const matches = (p: { threadId?: string; turnId?: string; turn?: { id?: string } }) =>
    (!p.threadId || p.threadId === threadId) && (!turnId || !(p.turnId ?? p.turn?.id) || (p.turnId ?? p.turn?.id) === turnId);
  const deliver = (fn: () => void) => { if (starting) early.push(fn); else fn(); };
  const message = (p: { threadId?: string; turnId?: string; item?: { type?: string; text?: string }; delta?: string }) => deliver(() => {
    if (matches(p) && ((p.item?.type === "agentMessage" && p.item.text?.trim()) || p.delta?.trim())) receivedText = true;
  });
  const completed = (p: { threadId?: string; turn?: { id?: string; status?: string } }) => deliver(() => {
    if (!matches(p)) return;
    if (p.turn?.status === "completed" && receivedText) resolve();
    else reject(new Error("The model did not complete the connection check."));
  });
  const failed = () => reject(new Error("The model connection closed during its check."));
  const abort = () => { void client.interruptTurn(threadId, turnId).catch(() => {}); reject(new Error("Connection check cancelled.")); };
  const request = (p: { id: string | number; method: string }) => {
    try {
    if (p.method === "item/commandExecution/requestApproval") client.respondApproval(p.id, "decline");
    else if (p.method === "item/fileChange/requestApproval") client.respondFileChangeApproval(p.id, "decline");
    else if (p.method === "item/tool/call") client.respondToolCall(p.id, { success: false, contentItems: [{ type: "inputText", text: "Tools are unavailable during a connection check. Reply with text only." }] });
    } catch { failed(); }
  };
  client.on("item/completed", message);
  client.on("item/agentMessage/delta", message);
  client.on("turn/completed", completed);
  client.on("transportError", failed);
  client.on("exit", failed);
  client.on("serverRequest", request);
  signal.addEventListener("abort", abort, { once: true });
  try {
    // Await both startup and completion so failures during startup are observed.
    const started = client.startTurn(threadId, "Reply OK to verify this model connection.").then((result) => {
      turnId = result.turnId; starting = false;
      for (const notify of early.splice(0)) notify();
      signal.throwIfAborted();
    });
    await Promise.all([started, done]);
  } catch (error) {
    void client.interruptTurn(threadId, turnId).catch(() => {});
    throw error;
  } finally {
    client.off("item/completed", message); client.off("item/agentMessage/delta", message);
    client.off("turn/completed", completed); client.off("transportError", failed);
    client.off("exit", failed); client.off("serverRequest", request);
    signal.removeEventListener("abort", abort);
  }
}
