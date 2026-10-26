/**
 * Patterns that raise an action to "ask" (or higher) even if the default
 * tier for the tool kind would allow it silently.
 */

import type { AskRule } from "./types.js";

// A delete word only counts where a command starts and outside comments, so
// "Get-Content rm.txt", "Write-Output 'Remove-Item'" and "# not Remove-Item"
// stay ordinary asks. Hands' PowerShell AST guard is the second layer.
const NOT_IN_COMMENT = String.raw`(?<!<#(?:(?!#>)[\s\S])*)(?<!(?:^|[\s;])#[\s\S]*)`;
const COMMAND_START = String.raw`(?<=(?:^|[;|&({}=]|\bcmd(?:\.exe)?\s+/[ck]|-command|\b(?:iex|invoke-expression|start-process))\s*['"]?\s*)`;

export const ASK_RULES: AskRule[] = [
  {
    id: "ask.recycle.bin.move",
    tier: 2,
    description: "Moving files to Recycle Bin",
    plainEnglishTemplate:
      "Lalime wants to move files to the Recycle Bin.",
    patterns: [
      /\brecycle\b/i,
      /\bshell:RecycleBinFolder\b/i,
      /\bmove.*recycle/i,
    ],
    kinds: ["file_move", "file_delete", "powershell", "shell"],
    undoable: true,
  },
  {
    id: "ask.network.reset",
    tier: 2,
    description: "Reset network adapter / flush DNS",
    plainEnglishTemplate:
      "Lalime wants to briefly reset your network connection to fix Wi-Fi. You may disconnect for a few seconds.",
    patterns: [
      /\brestart-netadapter\b/i,
      /\bdisable-netadapter\b/i,
      /\benable-netadapter\b/i,
      /\bipconfig\s+\/(release|renew|flushdns)/i,
      /\bnetsh\s+winsock\s+reset\b/i,
    ],
    kinds: ["powershell", "shell"],
    undoable: false,
  },
  {
    id: "ask.display.settings",
    tier: 1,
    description: "Change display / night light / text size",
    plainEnglishTemplate:
      "Lalime wants to change a display setting (like night light or text size).",
    patterns: [
      /\bms-settings:display\b/i,
      /\bnight[\s-]?light\b/i,
      /\btext\s*size\b/i,
      /\bscale\b.*display/i,
    ],
    kinds: ["open_settings", "ui_click", "ui_type", "powershell"],
    undoable: true,
  },
  {
    id: "ask.service.change",
    tier: 3,
    description: "Change Windows service start type",
    plainEnglishTemplate:
      "Lalime wants to change a Windows background service. This is a serious change.",
    patterns: [
      /\bset-service\b/i,
      /\bsc\s+config\b/i,
      /\bstop-service\b/i,
      /\bstart-service\b/i,
    ],
    kinds: ["powershell", "shell"],
    undoable: true,
  },
  {
    id: "ask.registry",
    tier: 3,
    description: "Registry writes",
    plainEnglishTemplate:
      "Lalime wants to change a Windows registry setting. A backup will be kept first.",
    patterns: [
      /\bset-itemproperty\b.*hk(cu|lm|cr|u):/i,
      /\bnew-itemproperty\b/i,
      /\breg\s+add\b/i,
      /\bregedit\b/i,
    ],
    kinds: ["powershell", "shell"],
    undoable: true,
  },
  {
    // Jackson, Oct 26: "Ms Defender isn't that deep, we can allow the app to
    // mess with that." Was a hard block in never.defender.disable.
    id: "ask.defender.change",
    tier: 3,
    description: "Turn off or weaken Microsoft Defender antivirus",
    plainEnglishTemplate:
      "Lalime wants to turn off or weaken Microsoft Defender antivirus. It stays off until you turn it back on, and your PC is less protected until then.",
    patterns: [
      /\bset-mppreference\b[^\n]*-(disable\w*|drtm)(\s+|:)(\$true|1)\b/i,
      /\b(add|set)-mppreference\b[^\n]*-exclusion\w*/i,
      /\bdisable(realtimemonitoring|antispyware|antivirus|ioavprotection|behaviormonitoring)\b["']?\s*(=|:|-value)?\s*(\$true|1)\b/i,
      /\bdisable(realtimemonitoring|antispyware|antivirus)\b[^\n]*\/d\s+1\b/i,
      /\b(stop|suspend)-service\b[^\n]*\bwindefend\b/i,
      /\bsc(\.exe)?\s+(stop|config|pause)\s+windefend\b/i,
      /\bwindefend\b[^\n]*\.(stop|pause)\(\)/i,
      /\bwindefend\b[^\n]*\bstopservice\b/i,
      /\b(stop-process|taskkill)\b[^\n]*\b(msmpeng|nissrv|securityhealthservice)\b/i,
    ],
    kinds: ["powershell", "shell"],
    undoable: false,
  },
  {
    // Jackson, Oct 26: "Ask before delete". Remove-Item, del and rd never use
    // the Recycle Bin, so this card says the files are gone for good.
    id: "ask.permanent.delete",
    tier: 3,
    description: "Permanent delete (skips the Recycle Bin)",
    plainEnglishTemplate:
      "Lalime wants to permanently delete files. They skip the Recycle Bin and cannot be restored.",
    patterns: [
      new RegExp(NOT_IN_COMMENT + COMMAND_START + String.raw`(?:remove-item|del|erase|rmdir|rd|rm|ri)(?![\w.-])`, "i"),
      new RegExp(NOT_IN_COMMENT + COMMAND_START + String.raw`\[(?:system\.)?io\.(?:file|directory)\]::delete\b`, "i"),
      new RegExp(NOT_IN_COMMENT + COMMAND_START + String.raw`\$[\w:]+(?:\.\w+)*\.delete\(\s*(?:\$true)?\s*\)`, "i"),
      new RegExp(NOT_IN_COMMENT + String.raw`\)\s*\.delete\(\s*(?:\$true)?\s*\)`, "i"),
    ],
    kinds: ["powershell", "shell"],
    undoable: false,
    commandTextOnly: true,
  },
  {
    id: "ask.permanent.delete.file",
    tier: 3,
    description: "Permanent delete (skips the Recycle Bin)",
    plainEnglishTemplate:
      "Lalime wants to permanently delete files. They skip the Recycle Bin and cannot be restored.",
    patterns: [/^(?![\s\S]*\brecycle\b)[\s\S]/i],
    kinds: ["file_delete"],
    undoable: false,
  },
  {
    // Narrow exception to never.system32.wipe (Jackson, Oct 26).
    id: "ask.print.spool.clear",
    tier: 2,
    description: "Clear stuck print-queue files",
    plainEnglishTemplate:
      "Lalime wants to clear the stuck print queue. Any print job still waiting will be lost, so you will need to print it again.",
    patterns: [/\\windows\\system32\\spool\\printers\\[a-z0-9_*?-]+\.(spl|shd)\b/i],
    kinds: ["powershell", "shell", "file_delete"],
    undoable: false,
  },
  {
    id: "ask.recycle.bin.empty",
    tier: 3,
    description: "Empty the Recycle Bin",
    plainEnglishTemplate:
      "Lalime wants to empty the Recycle Bin. Everything in it will be gone for good.",
    patterns: [/\bclear-recyclebin\b/i, /\$recycle\.bin\b/i],
    kinds: ["powershell", "shell"],
    undoable: false,
  },
  {
    // UI steps are tier 1 (Jackson, Oct 26), but a click or typed value whose
    // control or window names a lasting change still gets a card. This keeps
    // a weaker model from clicking through an Uninstall or Reset dialog.
    id: "ask.ui.consequential",
    tier: 2,
    description: "Click or type on a control that removes, resets, or installs something",
    plainEnglishTemplate:
      "Lalime wants to press a button or fill in a box that makes a lasting change (like uninstalling, deleting, or resetting).",
    patterns: [
      /\b(un-?install\w*|delet\w*|remov\w*|reset\w*|eras\w*|format\w*|wipe\w*|clear\w*|empty\w*|disabl\w*|repair\w*|restor\w*|install\w*)\b/i,
      /\b(turn\s+off|end\s+task|sign\s+out|log\s+off|restart|shut\s*down|update\s+now|factory|run\s+as\s+administrator|forget|discard|overwrite|replace)\b/i,
    ],
    kinds: ["ui_click", "ui_type"],
    undoable: false,
  },
  {
    // Typing into a command window is how a model can sidestep the gated
    // lalime_run_powershell path. Always ask.
    id: "ask.ui.type.into.shell",
    tier: 2,
    description: "Type into a command window, Run box, or Registry Editor",
    plainEnglishTemplate:
      "Lalime wants to type into a command window. It should use its own checked command tool instead, so please look closely.",
    patterns: [
      /\b(power\s*shell|pwsh|command\s+prompt|cmd(\.exe)?|windows\s+terminal|terminal|registry\s+editor|regedit)\b/i,
      /"windowtitle":"run"/i,
    ],
    kinds: ["ui_type"],
    undoable: false,
  },
  {
    // A toggle in Windows Security, Firewall, UAC, Windows Update, Services or
    // the Registry Editor is often named only "On"/"Off" or the feature itself,
    // so the button-word rule above can miss it. Any click or typing in those
    // windows gets a card.
    id: "ask.ui.security.window",
    tier: 2,
    description: "Click or type in a Windows security or system-configuration window",
    plainEnglishTemplate:
      "Lalime wants to change something in a Windows security or system settings window. This may not undo automatically.",
    patterns: [
      /"windowtitle":"[^"]*\b(windows\s+security|virus\s*&?\s*threat|firewall|defender|user\s+account\s+control|windows\s+update|services|registry\s+editor|group\s+policy|local\s+security\s+policy|bitlocker)\b/i,
      /"name":"[^"]*\b(real-?time\s+protection|tamper\s+protection|cloud-?delivered\s+protection|controlled\s+folder\s+access|core\s+isolation|memory\s+integrity|firewall|smartscreen)\b/i,
    ],
    kinds: ["ui_click", "ui_type"],
    undoable: false,
  },
];
