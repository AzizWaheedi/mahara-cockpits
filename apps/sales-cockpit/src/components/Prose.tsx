import type { ReactNode } from "react";

/**
 * The little markdown the cockpit shows: Fathom's summaries (### headings,
 * - bullets, **bold**) and Vince's reviews (Slack style, *bold* with single
 * asterisks). Built as React elements, so nothing in a transcript or a
 * model's answer can put HTML on the page. Each block sets its own text
 * direction, because a review mixes English with Arabic lines.
 */

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Bold first (** or single *), then links inside the plain runs.
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    const k = `${key}.${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part) || /^\*[^*\s][^*]*\*$/.test(part)) {
      out.push(<strong key={k}>{part.replace(/^\*\*?|\*\*?$/g, "")}</strong>);
      return;
    }
    if (/^`[^`]+`$/.test(part)) {
      out.push(
        <code
          key={k}
          className="rounded bg-[color:var(--muted)] px-1 text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    let last = 0;
    for (const m of part.matchAll(LINK)) {
      const at = m.index ?? 0;
      if (at > last) out.push(part.slice(last, at));
      const href = m[2] ?? m[3];
      out.push(
        <a
          key={`${k}.${at}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2"
        >
          {m[1] ?? href}
        </a>,
      );
      last = at + m[0].length;
    }
    if (last < part.length) out.push(part.slice(last));
  });
  return out;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "hr" };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", lines: para });
    if (list) out.push(list);
    if (quote.length) out.push({ kind: "quote", lines: quote });
    para = [];
    list = null;
    quote = [];
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ kind: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push({ kind: "hr" });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      if (para.length || list) {
        const keep = quote;
        flush();
        quote = keep;
      }
      quote.push(q[1]);
      continue;
    }
    const ul = /^\s*(?:[-•]|\*(?=\s))\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (para.length || quote.length || (list && list.kind !== kind)) flush();
      list = list ?? { kind, items: [] };
      list.items.push((ul ?? ol)?.[1] ?? "");
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list || quote.length) flush();
    para.push(line);
  }
  flush();
  return out;
}

export function Prose({
  text,
  className = "",
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (!text?.trim()) return null;
  return (
    <div className={`space-y-2 text-sm leading-relaxed ${className}`}>
      {blocks(text).map((b, i) => {
        const key = String(i);
        if (b.kind === "h")
          return (
            <p
              key={key}
              dir="auto"
              className={`pt-1 font-semibold ${b.level <= 2 ? "text-[15px]" : "text-sm"}`}
            >
              {inline(b.text, key)}
            </p>
          );
        if (b.kind === "hr") return <hr key={key} className="hairline" />;
        if (b.kind === "quote")
          return (
            <blockquote
              key={key}
              dir="auto"
              className="muted border-s-2 hairline ps-3"
            >
              {b.lines.map((l, j) => (
                <p key={`${key}.${String(j)}`}>{inline(l, `${key}.${j}`)}</p>
              ))}
            </blockquote>
          );
        if (b.kind === "p")
          return (
            <p key={key} dir="auto">
              {b.lines.map((l, j) => (
                <span key={`${key}.${String(j)}`}>
                  {j ? <br /> : null}
                  {inline(l, `${key}.${j}`)}
                </span>
              ))}
            </p>
          );
        {
          const Tag = b.kind;
          return (
            <Tag
              key={key}
              className={`space-y-1 ps-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}
            >
              {b.items.map((item, j) => (
                <li key={`${key}.${String(j)}`} dir="auto">
                  {inline(item, `${key}.${j}`)}
                </li>
              ))}
            </Tag>
          );
        }
      })}
    </div>
  );
}
