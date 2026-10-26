/**
 * Tiny, dependency-free Markdown subset for assistant replies.
 * Produces plain data (never HTML strings) so React escapes everything.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "em"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string };

export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "h"; level: 1 | 2 | 3; inl: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "quote"; lines: Inline[][] }
  | { t: "code"; v: string };

const INLINE = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_]))/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: src.slice(last, at) });
    if (m[2] ?? m[3]) out.push({ t: "strong", v: (m[2] ?? m[3])! });
    else if (m[4]) out.push({ t: "code", v: m[4] });
    else if (m[5] && m[6]) out.push({ t: "link", v: m[5], href: m[6] });
    else out.push({ t: "em", v: (m[7] ?? m[8])! });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

const UL = /^\s{0,3}[-*•]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const H = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }

    if (FENCE.test(line.trim())) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!.trim())) body.push(lines[i++]!);
      i++; // closing fence (or end)
      blocks.push({ t: "code", v: body.join("\n") });
      continue;
    }

    const h = H.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, inl: parseInline(h[2]!.trim()) });
      i++;
      continue;
    }

    if (UL.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && UL.test(lines[i]!)) items.push(parseInline(UL.exec(lines[i++]!)![1]!));
      blocks.push({ t: "ul", items });
      continue;
    }

    const ol = OL.exec(line);
    if (ol) {
      const items: Inline[][] = [];
      while (i < lines.length && OL.test(lines[i]!)) items.push(parseInline(OL.exec(lines[i++]!)![2]!));
      blocks.push({ t: "ol", start: Number(ol[1]), items });
      continue;
    }

    if (QUOTE.test(line)) {
      const q: Inline[][] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) q.push(parseInline(QUOTE.exec(lines[i++]!)![1]!));
      blocks.push({ t: "quote", lines: q });
      continue;
    }

    const para: Inline[][] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !UL.test(lines[i]!) &&
      !OL.test(lines[i]!) &&
      !H.test(lines[i]!) &&
      !QUOTE.test(lines[i]!) &&
      !FENCE.test(lines[i]!.trim())
    ) {
      para.push(parseInline(lines[i++]!));
    }
    blocks.push({ t: "p", lines: para });
  }
  return blocks;
}
