export const outcomeSummaryPrompt = "Give a short final outcome summary using only the evidence already collected. State what was found, what changed, and whether the user's symptom was verified fixed. Do not call tools, describe future actions, or repeat internal planning. If the outcome is unknown, say so.";
export const plainServiceFailure = "I hit a problem talking to the AI service, so I stopped. I did not start any further actions. Please try again.";

// Match only short statements of intent. A reply with an observed outcome stays visible.
export function isNarrationOnly(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 500) return false;
  if (/^(?:plan (?:updated|created)|(?:calling|running|using) lalime_[a-z_]+(?: now)?)\.?$/i.test(value)) return true;
  const sentences = value.split(/(?:[.!?]+\s+|\n+)/).filter(Boolean);
  return sentences.every((sentence) => /^(?:(?:now|first|next|then)[,:]?\s+)?(?:I(?:['’]ll| will| am going to|['’]m going to)|let me)\s+(?:start|check|look|inspect|run|try|test|find|open|review|investigate|use|call|update|continue)\b[^.!?]*[.!?]*$/i.test(sentence.trim()));
}
