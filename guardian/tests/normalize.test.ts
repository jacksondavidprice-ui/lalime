import { describe, expect, it } from "vitest";
import { collapsePolicyTokens, deobfuscateLite } from "../src/normalize.js";

describe("collapsePolicyTokens", () => {
  it("still matches obfuscated BitLocker-style tokens", () => {
    const raw = 'b"it"Lo`cker';
    const collapsed = collapsePolicyTokens(raw);
    expect(collapsed).toContain("bitlocker");
    expect(collapsePolicyTokens("Manage-Bde -Unlock")).toContain("managebde");
  });

  it("strips PowerShell dynamic invocation markers in deobfuscateLite", () => {
    const text = deobfuscateLite("& { Invoke-Expression $(Get-Content x) }");
    expect(text.toLowerCase()).toMatch(/iex/);
    expect(text).not.toMatch(/\$\(/);
  });
});
