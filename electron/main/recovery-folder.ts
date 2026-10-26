import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";

/** Open only the default NodeHands quarantine. No renderer path is accepted. */
export async function openRecoveryFolder(): Promise<{ ok: boolean; message?: string }> {
  let recovery: string;
  try {
    const temporary = path.resolve(os.tmpdir());
    const root = path.join(temporary, "lalime-hands");
    recovery = path.join(root, "quarantine");
    for (const directory of [root, recovery]) {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return { ok: false, message: "The recovery folder could not be opened safely." };
      }
    }
    // The OS temp folder can have a canonical alias. The app folders cannot.
    const canonicalTemporary = realpathSync(temporary);
    const canonicalRoot = realpathSync(root);
    const canonicalRecovery = realpathSync(recovery);
    if (path.relative(path.join(canonicalTemporary, "lalime-hands"), canonicalRoot) !== ""
      || path.relative(path.join(canonicalRoot, "quarantine"), canonicalRecovery) !== "") {
      return { ok: false, message: "The recovery folder could not be opened safely." };
    }
    recovery = canonicalRecovery;
  } catch (error) {
    return {
      ok: false,
      message: (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "There are no recovery files yet."
        : "The recovery folder could not be opened safely.",
    };
  }
  try {
    const error = await shell.openPath(recovery);
    return error ? { ok: false, message: "The recovery folder could not be opened." } : { ok: true };
  } catch {
    return { ok: false, message: "The recovery folder could not be opened." };
  }
}
