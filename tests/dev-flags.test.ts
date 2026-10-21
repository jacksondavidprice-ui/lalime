import { describe, expect, it } from "vitest";
import { isPackagedBuild, isScriptedMockAllowed } from "../electron/main/dev-flags.ts";

describe("scripted mock gating", () => {
  it("never allows mocks when packaged", () => {
    expect(
      isScriptedMockAllowed({
        isPackaged: true,
        env: { LALIME_DEMO: "1", NODE_ENV: "test" },
      }),
    ).toBe(false);
  });

  it("never allows mocks when LALIME_PACKAGED is set", () => {
    expect(
      isScriptedMockAllowed({
        isPackaged: false,
        env: { LALIME_PACKAGED: "1", LALIME_DEMO: "1" },
      }),
    ).toBe(false);
    expect(isPackagedBuild(false, { LALIME_PACKAGED: "true" })).toBe(true);
  });

  it("allows mocks only with explicit LALIME_DEMO when unpackaged", () => {
    expect(isScriptedMockAllowed({ isPackaged: false, env: {} })).toBe(false);
    expect(
      isScriptedMockAllowed({ isPackaged: false, env: { LALIME_DEMO: "1" } }),
    ).toBe(true);
  });

  it("allows mocks under NODE_ENV=test for unit fixtures", () => {
    expect(
      isScriptedMockAllowed({ isPackaged: false, env: { NODE_ENV: "test" } }),
    ).toBe(true);
  });
});
