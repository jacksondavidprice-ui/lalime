import { describe, expect, it } from "vitest";
import {
  codexMissingMessage,
  resolveCodexCommand,
} from "../electron/main/codex-resolve.ts";

describe("codex binary resolve", () => {
  it("honors LALIME_CODEX_BIN", () => {
    expect(
      resolveCodexCommand({ LALIME_CODEX_BIN: "C:\\Tools\\codex.exe" }, "win32"),
    ).toBe("C:\\Tools\\codex.exe");
  });

  it("falls back to codex name when nothing else matches", () => {
    expect(resolveCodexCommand({ PATH: "" }, "linux")).toBe("codex");
  });

  it("mentions codex login in missing message", () => {
    const msg = codexMissingMessage("codex");
    expect(msg).toMatch(/codex login/);
    expect(msg).toMatch(/API key/i);
  });
});
