export interface AppSettings {
  providerId: string;
  model: string;
  baseUrl: string;
  instructions: string;
  maxToolCalls: number;
  maxTokens: number;
  requestTimeoutMs: number;
  temperature: number | null;
  allowScreenCapture: boolean;
  allowComputerControl: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: "chatgpt", model: "", baseUrl: "", instructions: "",
  maxToolCalls: 12, maxTokens: 4096, requestTimeoutMs: 60000, temperature: null,
  allowScreenCapture: false, allowComputerControl: false,
};

export function validateSettings(value: unknown, current = DEFAULT_SETTINGS): AppSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be an object.");
  const input = value as Record<string, unknown>;
  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, name)) throw new Error("Unknown setting.");
  }
  const next = { ...current, ...input } as AppSettings;
  for (const name of ["providerId", "model", "baseUrl", "instructions"] as const) {
    if (typeof next[name] !== "string" || next[name].length > (name === "instructions" ? 8000 : 2048)) throw new Error("Invalid setting text.");
    next[name] = next[name].trim();
  }
  for (const [name, min, max] of [["maxToolCalls", 1, 50], ["maxTokens", 256, 32768], ["requestTimeoutMs", 5000, 180000]] as const) {
    if (!Number.isInteger(next[name]) || next[name] < min || next[name] > max) throw new Error(`Invalid ${name}.`);
  }
  if (next.temperature !== null && (typeof next.temperature !== "number" || !Number.isFinite(next.temperature) || next.temperature < 0 || next.temperature > 1)) throw new Error("Temperature must be between 0 and 1, or use the provider default.");
  if (typeof next.allowScreenCapture !== "boolean" || typeof next.allowComputerControl !== "boolean") throw new Error("Permissions must be true or false.");
  return next;
}
