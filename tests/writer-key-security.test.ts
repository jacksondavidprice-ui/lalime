import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.directory }, safeStorage: { isEncryptionAvailable: () => false } }));
import { loadWriterKey } from "../electron/main/writer-key.js";
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lime-key-")); });
afterEach(() => rmSync(state.directory, { recursive: true, force: true }));
it("never interprets an existing encrypted file as plaintext when encryption is unavailable", () => {
  const file = path.join(state.directory, "anthropic-key.bin");
  writeFileSync(file, "encrypted-test-bytes");
  expect(loadWriterKey()).toBeNull();
  expect(readFileSync(file, "utf8")).toBe("encrypted-test-bytes");
});
