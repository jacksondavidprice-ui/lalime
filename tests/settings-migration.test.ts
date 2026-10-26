import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, validateSettings } from "../shared/settings.js";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.directory } }));
import { loadSettings, saveSettings } from "../electron/main/settings-store.js";
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lime-settings-migration-")); });
afterEach(() => { rmSync(state.directory, { recursive: true, force: true }); });
it("has no tool-step or elapsed-request settings", () => {
  expect(DEFAULT_SETTINGS).not.toHaveProperty("maxToolCalls");
  expect(DEFAULT_SETTINGS).not.toHaveProperty("requestTimeoutMs");
});
it.each([12, 25, -1, "legacy"])("drops old caps without discarding saved preferences (%s)", (maxToolCalls) => {
  writeFileSync(path.join(state.directory, "settings.json"), JSON.stringify({ providerId: "anthropic", model: "chosen-model", instructions: "Keep preferences", maxToolCalls, requestTimeoutMs: 10, temperature: 0.3 }));
  const migrated = loadSettings();
  expect(migrated).toMatchObject({ providerId: "anthropic", model: "chosen-model", instructions: "Keep preferences", temperature: 0.3 });
  expect(migrated).not.toHaveProperty("maxToolCalls"); expect(migrated).not.toHaveProperty("requestTimeoutMs");
  saveSettings(migrated);
  const saved = JSON.parse(readFileSync(path.join(state.directory, "settings.json"), "utf8"));
  expect(saved).not.toHaveProperty("maxToolCalls"); expect(saved).not.toHaveProperty("requestTimeoutMs");
});
it("drops old fields from current settings but still rejects unknown credentials", () => {
  const next = validateSettings({ model: "selected" }, { ...DEFAULT_SETTINGS, maxToolCalls: 25, requestTimeoutMs: 60000 });
  expect(next.model).toBe("selected");
  expect(next).not.toHaveProperty("maxToolCalls"); expect(next).not.toHaveProperty("requestTimeoutMs");
  expect(() => validateSettings({ apiKey: "placeholder" })).toThrow(/unknown/i);
});
