import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const electron = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => electron.directory },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));
import { SessionController } from "../electron/main/session.js";
import { MockHands } from "../hands/mock/index.js";

afterEach(() => { if (electron.directory) rmSync(electron.directory, { recursive: true, force: true }); });
function session() {
  electron.directory = mkdtempSync(path.join(os.tmpdir(), "lime-settings-"));
  return new SessionController(new MockHands());
}

describe("private and bounded settings", () => {
  it("uses provider defaults unless temperature is explicitly set", () => {
    const controller = session();
    expect(controller.getSnapshot().settings?.temperature).toBeNull();
    expect(controller.updateSettings({ temperature: 0.4 }).ok).toBe(true);
    expect(controller.updateSettings({ temperature: null }).ok).toBe(true);
    expect(controller.getSnapshot().settings?.temperature).toBeNull();
  });
  it("starts with computer control and screen sharing disabled", () => {
    const snapshot = session().getSnapshot();
    expect(snapshot.settings).toMatchObject({ allowComputerControl: false, allowScreenCapture: false });
  });
  it("drops a saved tool limit without dropping other settings", () => {
    session();
    writeFileSync(path.join(electron.directory, "settings.json"), JSON.stringify({ maxToolCalls: 12 }));
    expect(new SessionController(new MockHands()).getSnapshot().settings).not.toHaveProperty("maxToolCalls");
  });
  it("persists validated preferences without accepting credential fields", () => {
    const controller = session();
    expect(controller.updateSettings({ model: "my-model", instructions: "Use short answers." }).ok).toBe(true);
    const restored = new SessionController(new MockHands());
    expect(restored.getSnapshot().settings).toMatchObject({ model: "my-model" });
    expect(controller.updateSettings({ apiKey: "private-test-value" }).ok).toBe(false);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("private-test-value");
  });
  it("rejects invalid limits atomically", () => {
    const controller = session();
    const before = controller.getSnapshot().settings;
    expect(controller.updateSettings({ model: "changed", maxTokens: -1 }).ok).toBe(false);
    expect(controller.getSnapshot().settings).toEqual(before);
  });
});
