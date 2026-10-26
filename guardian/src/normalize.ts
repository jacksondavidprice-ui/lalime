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

const WINDOWS_DIR = "c:\\windows";
const SYSTEM32_DIR = "c:\\windows\\system32";
const SYSWOW64_DIR = "c:\\windows\\syswow64";

/**
 * Path-spelling canonicalization (host-side, no policy change).
 *
 * PowerShell and cmd can name the Windows folder through environment
 * variables or .NET calls instead of the literal "C:\Windows". This rewrites
 * those spellings to the literal path (and "/" or doubled "\\" separators to a
 * single "\") so the EXISTING never-list path rules see the same folder. It
 * only changes spelling; it removes no command text and makes no decision.
 * Policy (what is blocked) stays in never-list.ts.
 */
export function canonicalWindowsPaths(text: string): string {
  let t = text.toLowerCase();
  const before = t;
  // .NET folder lookups.
  t = t
    .replace(/\[(?:system\.)?environment\]\s*::\s*systemdirectory\b/g, SYSTEM32_DIR)
    .replace(
      /\[(?:system\.)?environment\]\s*::\s*getfolderpath\s*\(\s*(?:\[(?:system\.)?environment\+specialfolder\]\s*::\s*|['"]?)(systemx86|system|windows)['"]?\s*\)/g,
      (_m, folder: string) =>
        folder === "windows" ? WINDOWS_DIR : folder === "systemx86" ? SYSWOW64_DIR : SYSTEM32_DIR,
    );
  // Environment variables: $env:X, ${env:X}, %X%.
  t = t
    .replace(/\$\{env:(systemroot|windir)\}|\$env:(systemroot|windir)\b|%(systemroot|windir)%/g, WINDOWS_DIR)
    .replace(/\$\{env:systemdrive\}|\$env:systemdrive\b|%systemdrive%/g, "c:");
  // Separators: quotes / string concatenation between path pieces, "/" and "\\".
  t = t
    .replace(/(c:[^\s;|]*?)['"]?\s*\+\s*['"]?(?=[\\/])/g, "$1")
    .replace(/(c:)['"]+(?=[\\/])/g, "$1")
    .replace(/(c:\\windows)['"]+(?=[\\/])/g, "$1")
    .replace(/(c:\\windows\\system32)['"]+(?=[\\/])/g, "$1");
  // Join-Path <parent> <child> -> parent\child (simple literal forms only).
  t = t.replace(
    /\bjoin-path\s+(?:-path\s+)?['"]?(c:[^\s'"]*)['"]?\s+(?:-childpath\s+)?['"]?([^\s'";|)]+)['"]?/g,
    (_m, parent: string, child: string) => `${parent}\\${child}`,
  );
  t = t.replace(/\bc:[^\s'";|)]*/g, (path) => path.replace(/[\\/]+/g, "\\"));
  return t === before ? "" : t;
}

/** Strip common PowerShell obfuscation wrappers for a second pass. */
export function deobfuscateLite(text: string): string {
  const canon = canonicalEquivalents(text);
  const paths = canonicalWindowsPaths(text);
  return (canon ? `${canon} ` : "") + (paths ? `${paths}\n` : "") + text
    .replace(/`/g, "")
    .replace(/\$env:comspec/gi, "cmd")
    .replace(/\+\s*/g, "")
    .replace(/\[char\]\d+/gi, "X")
    .replace(/\$\(/g, " ")
    .replace(/&\s*\{/g, " ")
    .replace(/invoke-expression/gi, "iex")
    .replace(/\.invoke\(/gi, " ");
}
