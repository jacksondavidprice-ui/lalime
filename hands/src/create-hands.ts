import { MockHands } from "../mock/index.js";
import { NodeHands } from "./node-hands.js";
import type { HandsClient } from "./types.js";
import { WindowsHandsBridge } from "./windows-bridge.js";

export type HandsMode = "auto" | "mock" | "node" | "windows";

function isPackagedBuild(): boolean {
  return ["1", "true", "yes"].includes(
    (process.env.LALIME_PACKAGED ?? "").trim().toLowerCase(),
  );
}

/** Mock Hands only for unpackaged CI / LALIME_DEMO — never in packaged builds. */
function allowMockHands(): boolean {
  if (isPackagedBuild()) return false;
  if ((process.env.LALIME_HANDS ?? "").toLowerCase() === "mock") return true;
  const demo = (process.env.LALIME_DEMO ?? "").trim().toLowerCase();
  if (demo === "1" || demo === "true" || demo === "yes") return true;
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "test") return true;
  if ((process.env.VITEST ?? "").trim() === "true") return true;
  return false;
}

/**
 * Pick a Hands backend.
 * - On Windows product path: always Windows Hands.exe (no LALIME_HANDS needed).
 * - Mock only behind LALIME_DEMO / LALIME_HANDS=mock / test (never packaged).
 * - Node Hands for Linux/macOS (or explicit LALIME_HANDS=node).
 */
export function createHandsClient(mode: HandsMode = "auto"): HandsClient {
  const explicit = (process.env.LALIME_HANDS ?? "").toLowerCase();

  if (explicit === "mock" || mode === "mock") {
    if (allowMockHands()) return new MockHands();
    // Packaged / product: ignore mock request.
    return process.platform === "win32" ? new WindowsHandsBridge() : new NodeHands();
  }

  if (explicit === "node" || mode === "node") return new NodeHands();
  if (explicit === "windows" || mode === "windows") return new WindowsHandsBridge();

  // auto — Windows always gets real Hands (full computer control by default).
  if (process.platform === "win32") {
    return new WindowsHandsBridge();
  }

  if (allowMockHands()) return new MockHands();
  return new NodeHands();
}
