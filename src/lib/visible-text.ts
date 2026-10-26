// Preserve existing escapes. Show presentation controls as literal text.
export function visibleText(value: string, keepNewlines = false): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu,
    (character) => keepNewlines && (character === "\n" || character === "\r" || character === "\t") ? character
      : character === "\n" ? "\\n" : character === "\r" ? "\\r" : character === "\t" ? "\\t"
        : character.length === 2 ? `\\u{${character.codePointAt(0)!.toString(16)}}`
          : `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
