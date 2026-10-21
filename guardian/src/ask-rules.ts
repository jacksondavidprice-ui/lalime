/**
 * Patterns that raise an action to "ask" (or higher) even if the default
 * tier for the tool kind would allow it silently.
 */

import type { AskRule } from "./types.js";

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
      /\bClear-RecycleBin\b/i,
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
];
