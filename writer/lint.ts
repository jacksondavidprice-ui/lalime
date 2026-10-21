/** Zero-latency writing checkers ported from Deliberate clear-explanations. */

export interface LintFinding {
  ruleId: string;
  blockScoreContribution: number;
  reason: string;
  evidence: string;
  span: { start: number; end: number };
}

const AIISM_RULES = [
  {
    ruleId: "ai-process-narration",
    blockScoreContribution: 4,
    reason: "Start with the subject. Do not announce that you are about to explain.",
    patterns: [
      /\b(?:let me explain|i(?:['’]ll| will) walk you through|let['’]s break this down)\b/gi,
      /\bhere['’]s what you need to know\b/gi,
    ],
  },
  {
    ruleId: "ai-throat-clearing",
    blockScoreContribution: 4,
    reason: "Cut the filler and state the fact.",
    patterns: [
      /\bhere['’]s the thing\b/gi,
      /\bit['’]s worth noting\b/gi,
      /\bit['’]s important to (?:note|understand|remember)\b/gi,
      /\blet me know if\b/gi,
      /\bfeel free to\b/gi,
    ],
  },
  {
    ruleId: "ai-signposted-recap",
    blockScoreContribution: 4,
    reason: "End on the result. Do not announce a summary.",
    patterns: [
      /\b(?:in conclusion|to (?:summarize|sum up)|the key takeaway(?: is)?)\b/gi,
    ],
  },
] as const;

export function proseOnly(text: string): string {
  // Mask fenced code and simple backticks so checkers ignore them.
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\r\n]/g, " "))
    .replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length));
}

export function detectAiisms(text: string): LintFinding[] {
  const source = proseOnly(typeof text === "string" ? text : "");
  const findings: LintFinding[] = [];
  for (const rule of AIISM_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        findings.push({
          ruleId: rule.ruleId,
          blockScoreContribution: rule.blockScoreContribution,
          reason: rule.reason,
          evidence: match[0],
          span: { start: match.index ?? 0, end: (match.index ?? 0) + match[0].length },
        });
      }
    }
  }
  return findings.sort((a, b) => a.span.start - b.span.start);
}

export function detectEmDashes(text: string): LintFinding[] {
  const source = typeof text === "string" ? text : "";
  const findings: LintFinding[] = [];
  for (const match of source.matchAll(/[—–]/g)) {
    findings.push({
      ruleId: "em-dash",
      blockScoreContribution: 2,
      reason: "Write authored prose without em dashes.",
      evidence: match[0],
      span: { start: match.index ?? 0, end: (match.index ?? 0) + 1 },
    });
  }
  return findings;
}

export function detectEmptySetup(text: string): LintFinding[] {
  const source = typeof text === "string" ? text : "";
  const findings: LintFinding[] = [];
  const patterns = [
    /^here(?:'s| is) (?:a |the )?(?:quick )?(?:overview|summary|breakdown).*$/gim,
    /^in this (?:section|guide|message).*$/gim,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      findings.push({
        ruleId: "empty-setup-sentence",
        blockScoreContribution: 4,
        reason: "A sentence stays only if deleting it removes a fact, cause, limit, or result.",
        evidence: match[0].slice(0, 160),
        span: { start: match.index ?? 0, end: (match.index ?? 0) + match[0].length },
      });
    }
  }
  return findings;
}

export function detectLaterTopicDump(text: string): LintFinding[] {
  const source = typeof text === "string" ? text : "";
  const findings: LintFinding[] = [];
  const pattern = /\b(?:additionally|furthermore|on another note|while we(?:'re| are) here)\b/gi;
  for (const match of source.matchAll(pattern)) {
    findings.push({
      ruleId: "later-topic-dump",
      blockScoreContribution: 3,
      reason: "End on the result. Do not open a new topic at the end.",
      evidence: match[0],
      span: { start: match.index ?? 0, end: (match.index ?? 0) + match[0].length },
    });
  }
  return findings;
}

export function lintReply(text: string): LintFinding[] {
  return [
    ...detectAiisms(text),
    ...detectEmDashes(text),
    ...detectEmptySetup(text),
    ...detectLaterTopicDump(text),
  ];
}

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/** Safe local fixes that do not change meaning: strip em dashes to commas/periods. */
export function applySafeLocalFixes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/,{2,}/g, ",");
}
