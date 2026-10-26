import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { parseBlocks } from "./rich-text";
import type { Block, Inline } from "./rich-text";
import "./chat-motion.css";

/**
 * Renders an assistant reply as calm, readable prose.
 * With `reveal`, words fade in with a short stagger (capped so long replies don't drag).
 */
export function RichText({ text, reveal = false }: { text: string; reveal?: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  // Each word is scheduled relative to first paint, so text that streams in later
  // (the Writer's rewrite) continues the cadence instead of restarting it.
  const [mountedAt] = useState(() => performance.now());
  const counter = { n: 0, elapsed: performance.now() - mountedAt };
  return <div className="lalime-prose">{blocks.map((b, i) => renderBlock(b, i, reveal, counter))}</div>;
}

type Counter = { n: number; elapsed: number };

const STAGGER_MS = 16;
const MAX_DELAY_MS = 1100;

function words(v: string, reveal: boolean, counter: Counter, keyBase: string): ReactNode {
  if (!reveal) return v;
  return v.split(/(\s+)/).map((w, i) => {
    if (!w || /^\s+$/.test(w)) return w;
    const delay = Math.max(0, Math.min(counter.n++ * STAGGER_MS, MAX_DELAY_MS) - counter.elapsed);
    return (
      <span key={`${keyBase}-${i}`} className="lalime-word" style={{ animationDelay: `${delay}ms` }}>
        {w}
      </span>
    );
  });
}

function renderInline(parts: Inline[], reveal: boolean, counter: Counter, keyBase: string): ReactNode[] {
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    switch (p.t) {
      case "text":
        return <span key={key}>{words(p.v, reveal, counter, key)}</span>;
      case "strong":
        return <strong key={key}>{words(p.v, reveal, counter, key)}</strong>;
      case "em":
        return <em key={key}>{words(p.v, reveal, counter, key)}</em>;
      case "code":
        return <code key={key}>{p.v}</code>;
      case "link":
        return (
          <a key={key} href={p.href} target="_blank" rel="noreferrer noopener">
            {words(p.v, reveal, counter, key)}
          </a>
        );
    }
  });
}

function renderLines(lines: Inline[][], reveal: boolean, counter: Counter, keyBase: string): ReactNode[] {
  return lines.flatMap((l, i) => {
    const nodes = renderInline(l, reveal, counter, `${keyBase}-${i}`);
    return i < lines.length - 1 ? [...nodes, <br key={`${keyBase}-br-${i}`} />] : nodes;
  });
}

function renderBlock(b: Block, i: number, reveal: boolean, counter: Counter): ReactNode {
  const k = `b${i}`;
  switch (b.t) {
    case "p":
      return <p key={k}>{renderLines(b.lines, reveal, counter, k)}</p>;
    case "h": {
      const Tag = (`h${b.level}` as "h1" | "h2" | "h3");
      return <Tag key={k}>{renderInline(b.inl, reveal, counter, k)}</Tag>;
    }
    case "ul":
      return (
        <ul key={k}>
          {b.items.map((it, j) => <li key={j}>{renderInline(it, reveal, counter, `${k}-${j}`)}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol key={k} start={b.start}>
          {b.items.map((it, j) => <li key={j}>{renderInline(it, reveal, counter, `${k}-${j}`)}</li>)}
        </ol>
      );
    case "quote":
      return <blockquote key={k}>{renderLines(b.lines, reveal, counter, k)}</blockquote>;
    case "code":
      return <pre key={k}><code>{b.v}</code></pre>;
  }
}
