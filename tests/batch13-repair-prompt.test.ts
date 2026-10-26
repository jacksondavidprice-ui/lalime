import { expect, it } from "vitest";
import { DEVELOPER_INSTRUCTIONS, LALIME_DYNAMIC_TOOLS } from "../electron/main/agent-prompt.js";

it("allows approved repair commands while retaining Guardian and bypass restrictions", () => {
  expect(DEVELOPER_INSTRUCTIONS).not.toMatch(/Never[^\n]*run programs or scripts/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/built-in diagnostic and repair commands.*lalime_run_powershell/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/Guardian.*block/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/download-and-execute/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/encoded commands/i);
});
it("gathers evidence before questions and exhausts useful fixes before handoff", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/read-only evidence before asking/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/each likely cause.*several candidate fixes/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/one at a time.*verify/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/physical steps.*alternatives.*exhausted/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/what you tried/i);
  expect(LALIME_DYNAMIC_TOOLS.find((t) => t.name === "lalime_screenshot")?.description).toMatch(/short text.*image item.*never print the whole/i);
});

it("instructs structured image consumers to separate image content from text", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/code.mode.*contentItems/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/inputText.*text/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/inputImage.*imageUrl.*image.output helper/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/never.*(?:serialize|print).*whole.*(?:response|result)/i);
});
