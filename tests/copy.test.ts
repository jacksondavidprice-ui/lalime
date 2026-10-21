import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "../src/copy/index.ts";

describe("committed static copy", () => {
  it("covers every source intent key", () => {
    const source = JSON.parse(readFileSync("src/copy/source.json", "utf8")) as Record<
      string,
      unknown
    >;
    const en = JSON.parse(readFileSync("src/copy/en.json", "utf8")) as Record<string, string>;
    for (const key of Object.keys(source)) {
      expect(en[key]?.trim().length).toBeGreaterThan(0);
    }
  });

  it("exposes rewritten strings without needing a runtime key", () => {
    expect(t("settings.writerHeading")).toMatch(/Better writing/i);
    expect(t("chips.downloads")).toMatch(/Downloads/i);
    expect(t("empty.body")).not.toMatch(/lorem/i);
  });
});
