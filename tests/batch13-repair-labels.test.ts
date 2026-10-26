import { expect, it } from "vitest";
import { sanitizeRepairPlan } from "../electron/main/agent-prompt.js";
it("retains ordinary Wi-Fi labels and removes invisible formatting from every display field", () => {
  const plan = sanitizeRepairPlan({ symptom: "Wi-Fi\u3164offline", causes: [{ label: "Wi-Fi driver", likelihood: "likely", evidence: "Adapter\u{e0061} disconnected" }], fixes: [{ label: "Reconnect Wi-Fi", cause: "Wi-Fi driver", status: "trying" }] });
  expect(plan?.symptom).toBe("Wi-Fi offline"); expect(plan?.causes[0]).toEqual({ label: "Wi-Fi driver", likelihood: "likely", evidence: "Adapter disconnected" });
  expect(plan?.fixes[0].label).toBe("Reconnect Wi-Fi");
});
it("omits command and path evidence instead of publishing it in the diagnosis", () => {
  const plan = sanitizeRepairPlan({ symptom: "Printer offline", causes: [{ label: "Printer service stopped", likelihood: "likely", evidence: "Get-Service Spooler" }], fixes: [{ label: "Restart the service", cause: "C:\\Users\\jp\\report.txt", status: "pending" }] });
  expect(plan?.causes[0].evidence).toBeUndefined(); expect(plan?.fixes[0].cause).toBeUndefined();
});
it.each(["sc query Spooler", "net stop Spooler", "ping localhost", "del notes"])("omits a recognizable command label: %s", (label) => {
  expect(sanitizeRepairPlan({ symptom: "Printer offline", causes: [{ label, likelihood: "likely" }] })?.causes).toEqual([]);
});
it.each(["Check printer connection", "Network is unavailable", "Ping test failed", "Delete old temporary files"])("retains plain diagnosis labels: %s", (label) => {
  expect(sanitizeRepairPlan({ symptom: label })?.symptom).toBe(label);
});
