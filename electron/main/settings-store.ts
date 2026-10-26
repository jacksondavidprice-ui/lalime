import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, validateSettings, type AppSettings } from "../../shared/settings.js";

export function loadSettings(): AppSettings {
  try {
    const settings = validateSettings(JSON.parse(readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8")));
    return settings;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: AppSettings): void {
  const directory = app.getPath("userData");
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, "settings.json");
  writeFileSync(`${destination}.tmp`, JSON.stringify(validateSettings(settings), null, 2), { mode: 0o600 });
  renameSync(`${destination}.tmp`, destination);
}
