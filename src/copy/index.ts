import en from "./en.json";

export type CopyKey = keyof typeof en;

const strings: Record<CopyKey, string> = en;

/** Committed static copy (Deliberate Lite rewrite). No runtime API key. */
export function t(key: CopyKey): string {
  return strings[key];
}

export const copy = strings;
