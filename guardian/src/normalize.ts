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

/**
 * Equivalent-spelling canonicalization (host-side, no policy change).
 *
 * The never-list matches canonical cmdlet spellings. PowerShell has other
 * ordinary ways to do the same thing (method calls, CIM methods, sc.exe,
 * .NET IO, splatting). This returns canonical verb tokens for those forms so
 * the EXISTING never-list rules see the same intent. It never removes text and
 * never makes a decision itself; it only lets current rules recognise
 * equivalents. Policy (what is blocked) stays in never-list.ts.
 */
export function canonicalEquivalents(text: string): string {
  const t = text.toLowerCase();
  const out: string[] = [];
  const stopsService =
    /\.stop\s*\(\s*\)/.test(t) ||
    /-methodname\s+['"]?(stopservice|changestartmode)\b/.test(t) ||
    /\bstopservice\b/.test(t) ||
    /\bsc(\.exe)?\s+(stop|config)\b/.test(t) ||
    /\bnet(\.exe)?\s+stop\b/.test(t) ||
    /\bset-service\b.*-(startuptype|startmode)\s+['"]?disabled/.test(t) ||
    /\bset-service\b.*-status\s+['"]?stopped/.test(t);
  if (stopsService) out.push("stop-service");
  const disablesStart =
    /\bchangestartmode\b.*disabled/.test(t) ||
    /\bsc(\.exe)?\s+config\b.*start=\s*['"]?disabled/.test(t) ||
    /\bset-service\b.*-(startuptype|startmode)\s+['"]?disabled/.test(t);
  if (disablesStart && /\bwuauserv\b/.test(t)) out.push("sc config wuauserv start= disabled");
  if (
    /\bset-mppreference\b/.test(t) &&
    /\bdisablerealtimemonitoring['"]?\s*=\s*(\$true|1|['"]?true)/.test(t)
  ) {
    out.push("set-mppreference -disablerealtimemonitoring $true");
  }
  const deletesFile =
    /\.delete\s*\(/.test(t) ||
    /\[(system\.)?io\.(file|directory|fileinfo|directoryinfo)\]\s*::\s*delete\b/.test(t) ||
    /-methodname\s+['"]?delete\b/.test(t);
  if (deletesFile) {
    const recursive =
      /\[(system\.)?io\.directory\]\s*::\s*delete\s*\([^)]*,\s*\$true/.test(t) ||
      /\.delete\s*\(\s*\$true\s*\)/.test(t);
    out.push(recursive ? "remove-item -recurse" : "remove-item");
  }
  return out.join(" ");
}

/** Strip common PowerShell obfuscation wrappers for a second pass. */
export function deobfuscateLite(text: string): string {
  const canon = canonicalEquivalents(text);
  return (canon ? `${canon} ` : "") + text
    .replace(/`/g, "")
    .replace(/\$env:comspec/gi, "cmd")
    .replace(/\+\s*/g, "")
    .replace(/\[char\]\d+/gi, "X")
    .replace(/\$\(/g, " ")
    .replace(/&\s*\{/g, " ")
    .replace(/invoke-expression/gi, "iex")
    .replace(/\.invoke\(/gi, " ");
}
