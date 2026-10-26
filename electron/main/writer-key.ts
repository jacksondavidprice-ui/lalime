/**
 * BYO Anthropic key storage via Electron safeStorage (main process only).
 */

import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { keyHint, looksLikeAnthropicKey } from "../../writer/anthropic-client.js";

let memoryKey: string | null = null;
let lastError: string | undefined;

function keyPath(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "anthropic-key.bin");
}

export type WriterKeyStatus = {
  enabled: boolean;
  keyHint: string | null;
  encryptedAtRest: boolean;
  lastError?: string;
};

export function getWriterKeyStatus(): WriterKeyStatus {
  const key = loadWriterKey();
  return {
    enabled: Boolean(key),
    keyHint: key ? keyHint(key) : null,
    encryptedAtRest: safeStorage.isEncryptionAvailable() && existsSync(keyPath()),
    lastError,
  };
}

export function setWriterLastError(message?: string): void {
  lastError = message;
}

export function loadWriterKey(): string | null {
  if (memoryKey) return memoryKey;
  const file = keyPath();
  if (!existsSync(file)) return null;
  try {
    const buf = readFileSync(file);
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    memoryKey = safeStorage.decryptString(buf);
    return memoryKey;
  } catch {
    return null;
  }
}

export function saveWriterKey(raw: string): { ok: boolean; message?: string; status: WriterKeyStatus } {
  const key = raw.trim();
  if (!looksLikeAnthropicKey(key)) {
    return {
      ok: false,
      message: "That does not look like an Anthropic API key. It should start with sk-ant-.",
      status: getWriterKeyStatus(),
    };
  }
  memoryKey = key;
  lastError = undefined;
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key);
    writeFileSync(keyPath(), encrypted, { mode: 0o600 });
  } else {
    // Session-only when OS encryption is unavailable.
    try {
      unlinkSync(keyPath());
    } catch {
      // ignore
    }
  }
  return { ok: true, status: getWriterKeyStatus() };
}

export function clearWriterKey(): WriterKeyStatus {
  memoryKey = null;
  lastError = undefined;
  try {
    unlinkSync(keyPath());
  } catch {
    // ignore
  }
  return getWriterKeyStatus();
}
