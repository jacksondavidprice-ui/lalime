/**
 * Hard NEVER list — these actions are always blocked, no approval override.
 *
 * JACKSON: This file is yours. Add/remove patterns carefully. Every entry needs
 * a plain-English reason a grandparent would understand.
 *
 * Matching runs on a normalized lowercase string of payload + paths.
 */

import type { NeverRule } from "./types.js";

export const NEVER_RULES: NeverRule[] = [
  {
    id: "never.disk.format",
    description: "Disk formatting / partitioning",
    plainEnglish:
      "Lalime will not erase or reformat a disk. That could wipe your whole computer.",
    patterns: [
      /\bformat\s+[a-z]:/i,
      /\bformat-volume\b/i,
      /\bclear-disk\b/i,
      /\bnew-partition\b/i,
      /\bdiskpart\b/i,
      /\bclean\s+all\b/i,
    ],
  },
  {
    id: "never.boot.config",
    description: "Boot configuration changes",
    plainEnglish:
      "Lalime will not change how your computer starts up. That is too risky to automate.",
    patterns: [/\bbcdedit\b/i, /\bbootrec\b/i, /\bbootsect\b/i],
  },
  {
    id: "never.shadow.copies",
    description: "Delete shadow copies / restore points",
    plainEnglish:
      "Lalime will not delete backup snapshots or restore points. Those are your safety net.",
    patterns: [
      /\bvssadmin\s+delete\b/i,
      /\bwmic\s+shadowcopy\s+delete\b/i,
      /\bdisable-computerrestore\b/i,
      /\bcheckpoint-computer\b.*-restorepoint.*delete/i,
    ],
  },
  {
    id: "never.defender.disable",
    // Defender itself moved to ask.defender.change (Jackson, Oct 26:
    // "Ms Defender isn't that deep, we can allow the app to mess with that").
    description: "Disable firewall / UAC / Windows Update",
    plainEnglish:
      "Lalime will not turn off your firewall, Windows security prompts (UAC), or Windows Update. Those keep you safe.",
    patterns: [
      /\bset-netfirewallprofile\b.*-enabled\s+(false|0)/i,
      /\bnetsh\s+advfirewall\s+set\b.*off/i,
      /\bSet-ItemProperty\b.*EnableLUA.*0/i,
      /\bsc\s+config\s+wuauserv\s+start=\s*disabled/i,
      /\bStop-Service\b.*wuauserv/i,
    ],
  },
  {
    id: "never.executionpolicy.unrestricted",
    description: "Set-ExecutionPolicy Unrestricted",
    plainEnglish:
      "Lalime will not unlock PowerShell to run any script from anywhere. That opens the door to malware.",
    patterns: [/\bset-executionpolicy\b.*\bunrestricted\b/i],
  },
  {
    id: "never.encoded.powershell",
    description: "Encoded or obfuscated PowerShell",
    plainEnglish:
      "Lalime blocked a hidden or scrambled command. Safe helpers never need to hide what they are doing.",
    patterns: [
      /powershell[^\n]*\s(-e|-enc|-encodedcommand)\b/i,
      /\b-encodedcommand\b/i,
      /\bfrombase64string\b/i,
      /\biex\b[\s\S]{0,200}downloadstring/i,
      /\binvoke-expression\b[\s\S]{0,200}download/i,
      /\bdownloadstring\b[\s\S]{0,80}\biex\b/i,
      /\binvoke-webrequest\b[^\n]*\|\s*iex\b/i,
      /\bcurl\b[^\n]*\|\s*iex\b/i,
      /\bwget\b[^\n]*\|\s*iex\b/i,
      /\bnew-object\s+net\.webclient\b[\s\S]{0,120}downloadstring/i,
    ],
  },
  {
    id: "never.download.execute",
    description: "Download-and-execute patterns",
    plainEnglish:
      "Lalime will not download a program from the internet and run it in one step.",
    patterns: [
      /\binvoke-webrequest\b[^\n]*-outfile[^\n]*\.(ps1|exe|bat|cmd|msi|js|vbs)/i,
      /\bstart-process\b[^\n]*\$env:temp[^\n]*\.(exe|msi|bat)/i,
      /\bbitsadmin\b[^\n]*\/transfer/i,
    ],
  },
  {
    id: "never.credentials",
    description: "Credential stores / LSASS / SAM",
    plainEnglish:
      "Lalime will not touch password vaults, browser saved passwords, or Windows login secrets.",
    patterns: [
      /\blsass\.exe\b/i,
      /\\windows\\system32\\config\\sam\b/i,
      /\\login data\b/i,
      /\\local state\b.*chrome/i,
      /\bsekurlsa\b/i,
      /\bmimikatz\b/i,
      /\bvaultcmd\b/i,
    ],
  },
  {
    id: "never.other.users",
    description: "Other users' profiles (explicit cross-account paths)",
    plainEnglish:
      "Lalime only works in your own folders, not other people's accounts on this PC.",
    // Hands should also enforce the real Windows username at runtime.
    // Here we only catch obvious cross-account / shared-admin targets.
    patterns: [
      /\\users\\(administrator|defaultaccount|guest)\\/i,
      /\\users\\\*\\/i,
    ],
    kinds: ["file_read", "file_write", "file_move", "file_delete", "shell", "powershell"],
  },
  {
    id: "never.system32.wipe",
    description: "Mass delete of system directories",
    plainEnglish:
      "Lalime will not delete Windows system files. That would break your computer.",
    patterns: [
      // Narrow exception (Jackson, Oct 26): print-queue job files
      // (System32\spool\PRINTERS\<name>.SPL / .SHD) are not system files.
      // Deleting them is ask.print.spool.clear instead of this hard block.
      /\b(remove-item|rm|del|erase|rmdir|rd)\b[^\n]*(\\windows\\system32(?!\\spool\\printers\\[a-z0-9_*?-]+\.(?:spl|shd)(?![\w\\/.*?]))|\\windows\\syswow64|\\windows\\winsxs)/i,
      /\b(remove-item|rm)\b[^\n]*-recurse[^\n]*(\\windows(?!\\system32\\spool\\printers\\[a-z0-9_*?-]+\.(?:spl|shd)(?![\w\\/.*?]))|\/windows)/i,
      /\bdelete\s+everything\s+in\s+system32\b/i,
      // Moving or renaming system files breaks Windows the same way deleting
      // them does (Jackson, Oct 26: "Treat a move as destructive with system files").
      /\b(move-item|mv|move|mi|rename-item|ren|rename|rni)\b[^\n]*(\\windows\\system32|\\windows\\syswow64|\\windows\\winsxs)/i,
      /\[(system\.)?io\.(file|directory)\]::(move|replace)\b[^\n]*(\\windows\\system32|\\windows\\syswow64|\\windows\\winsxs)/i,
      /\brobocopy\b(?=[^\n]*\\windows\\(system32|syswow64|winsxs))(?=[^\n]*\s\/(move|mov|mir|purge)\b)/i,
      /\bxcopy\b[^\n]*\\windows\\(system32|syswow64|winsxs)/i,
    ],
  },
  {
    id: "never.lalime.self",
    description: "Modify Lalime's own install / guardian rules",
    plainEnglish:
      "Lalime will not change its own safety settings. That would be like removing the seatbelt.",
    patterns: [
      /\blalime[\\/]+guardian\b/i,
      /\blalime[\\/]+never-list\b/i,
      /\bappdata[\\/]+local[\\/]+lalime\b.*remove-item/i,
    ],
  },
  {
    id: "never.recursive.root",
    description: "Recursive delete outside allowed user roots",
    plainEnglish:
      "Lalime will not wipe large parts of your drive. Cleanup stays inside folders you asked about.",
    patterns: [
      /\b(remove-item|rm)\b[^\n]*-recurse[^\n]*[cC]:\\\s*($|\")/,
      /\b(remove-item|rm)\b[^\n]*-recurse[^\n]*\/\s*($|\")/,
      /\brm\s+-rf\s+\/\s*$/,
      /\brm\s+-rf\s+\/\s*["']?\s*$/,
      /\brm\s+-rf\s+\//,
      /\brm\s+-rf\s+\*\b/,
    ],
  },
];

/** Paths Guardian treats as allowed mutation roots (user folders). */
export const ALLOWED_MUTATION_ROOTS = [
  "documents",
  "downloads",
  "desktop",
  "pictures",
  "videos",
  "music",
  "lalime",
];
