/** Build and sanitize the facts packet for Deliberate Lite (LAPCR result-summary ideas). */

export type FactsOutcome = "done" | "partly_done" | "blocked" | "needs_user" | "failed";

export interface FactsAction {
  summary: string;
  status: "done" | "skipped" | "blocked" | "failed";
  undoable: boolean;
}

export interface FactsPacket {
  userRequest: string;
  outcome: FactsOutcome;
  actions: FactsAction[];
  blocked?: { plainEnglish: string; tier: number }[];
  errors?: { code: string; plainHint: string }[];
  agentConclusion: string;
  untrustedSnippets?: string[];
}

const MAX_FIELD = 500;
const MAX_ACTIONS = 6;
const MAX_PACKET_CHARS = 4000;

export function sanitizeField(value: unknown, max = MAX_FIELD): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function buildFactsPacket(input: {
  userRequest: string;
  outcome: FactsOutcome;
  actions: FactsAction[];
  blocked?: { plainEnglish: string; tier: number }[];
  errors?: { code: string; plainHint: string }[];
  agentConclusion: string;
  untrustedSnippets?: string[];
}): FactsPacket {
  const packet: FactsPacket = {
    userRequest: sanitizeField(input.userRequest),
    outcome: input.outcome,
    actions: input.actions.slice(0, MAX_ACTIONS).map((a) => ({
      summary: sanitizeField(a.summary, 240),
      status: a.status,
      undoable: Boolean(a.undoable),
    })),
    agentConclusion: sanitizeField(input.agentConclusion, 1200),
  };
  if (input.blocked?.length) {
    packet.blocked = input.blocked.slice(0, 4).map((b) => ({
      plainEnglish: sanitizeField(b.plainEnglish, 320),
      tier: b.tier,
    }));
  }
  if (input.errors?.length) {
    packet.errors = input.errors.slice(0, 4).map((e) => ({
      code: sanitizeField(e.code, 64),
      plainHint: sanitizeField(e.plainHint, 240),
    }));
  }
  if (input.untrustedSnippets?.length) {
    packet.untrustedSnippets = input.untrustedSnippets
      .slice(0, 3)
      .map((s) => sanitizeField(s, 200));
  }
  let json = JSON.stringify(packet);
  if (json.length > MAX_PACKET_CHARS) {
    packet.agentConclusion = packet.agentConclusion.slice(0, 400);
    packet.actions = packet.actions.slice(0, 4);
    json = JSON.stringify(packet);
  }
  return packet;
}
