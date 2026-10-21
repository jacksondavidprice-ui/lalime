import type { ProposedAction } from "../../shared/types.js";

/**
 * Collapse policy tokens (Lime / LAPCR idea): NFKC, lowercase, strip quotes,
 * backticks, brackets and separators so obfuscated matches still hit.
 */
export function collapsePolicyTokens(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, "")
    .replace(/[\[\]{}()<>]/g, "")
    .replace(/[\\/_.,;:!|+\-*=]+/g, "")
    .replace(/\s+/g, "");
}

/** Lowercase, collapse whitespace, join payload + paths for rule matching. */
export function normalizeActionText(action: ProposedAction): string {
  const parts = [action.payload, ...(action.paths ?? []), action.summary ?? ""];
  return parts
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip common PowerShell obfuscation wrappers for a second pass. */
export function deobfuscateLite(text: string): string {
  return text
    .replace(/`/g, "")
    .replace(/\$env:comspec/gi, "cmd")
    .replace(/\+\s*/g, "")
    .replace(/\[char\]\d+/gi, "X")
    .replace(/\$\(/g, " ")
    .replace(/&\s*\{/g, " ")
    .replace(/invoke-expression/gi, "iex")
    .replace(/\.invoke\(/gi, " ");
}
