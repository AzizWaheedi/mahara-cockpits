import { ArrowUpRight, Check, Dot, X } from "lucide-react";

/**
 * A client's Do's & Don'ts, from the "Do's & Don'ts" field on their ClickUp
 * client card (Clients - Mahara). The media buyer, creative director and
 * client success cockpits all read that one field, so it is edited in ClickUp
 * and nowhere else. The card text uses DO / DON'T / NOTES headings with "- "
 * items; a line under no heading shows as a note.
 */

type Tone = "do" | "dont" | "note";
type Section = { tone: Tone; items: string[] };

const TITLE: Record<Tone, string> = { do: "Do", dont: "Don't", note: "Notes" };
const TONE: Record<Tone, string> = {
  do: "txt-good",
  dont: "txt-bad",
  note: "text-muted-foreground",
};
const MARK: Record<Tone, typeof Check> = { do: Check, dont: X, note: Dot };

export function parseDosDonts(text?: string | null): Section[] {
  const byTone = new Map<Tone, Section>();
  let current: Section | undefined;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/[‘’]/g, "'");
    if (!line || /^do'?s\s*(&|and)\s*don'?ts:?$/i.test(line)) continue;
    const head = /^(do'?s|do|don'?ts|don'?t|notes?):?$/i.exec(line);
    if (head) {
      const h = head[1].toLowerCase();
      const tone: Tone = h.startsWith("don")
        ? "dont"
        : h.startsWith("note")
          ? "note"
          : "do";
      current = byTone.get(tone) ?? { tone, items: [] };
      byTone.set(tone, current);
      continue;
    }
    if (!current) {
      current = byTone.get("note") ?? { tone: "note", items: [] };
      byTone.set("note", current);
    }
    current.items.push(line.replace(/^[-•*]\s*/, ""));
  }
  return (["do", "dont", "note"] as Tone[])
    .map(t => byTone.get(t))
    .filter((s): s is Section => Boolean(s?.items.length));
}

/** The sections side by side: Do, Don't, Notes. Nothing when the card is empty. */
export function DosDontsList({ text }: { text?: string | null }) {
  const sections = parseDosDonts(text);
  if (!sections.length) return null;
  // Widths follow the space the list is given, not the screen, because it
  // sits in a full-width card on one page and inside a narrow panel on another.
  return (
    <div className="@container">
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
        {sections.map(s => {
          const Mark = MARK[s.tone];
          return (
            <div key={s.tone}>
              <p
                className={`font-mono text-[11px] uppercase tracking-[0.08em] ${TONE[s.tone]}`}
              >
                {TITLE[s.tone]}
              </p>
              <ul className="mt-2 space-y-1.5 text-sm leading-snug">
                {s.items.map(item => (
                  <li key={item} className="flex gap-2">
                    <Mark
                      aria-hidden
                      className={`mt-0.5 size-3.5 shrink-0 ${TONE[s.tone]}`}
                    />
                    <span dir="auto">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The client's list in its own card, with a link to change it in ClickUp. */
export function DosDontsCard({
  text,
  url,
}: {
  text?: string | null;
  url?: string;
}) {
  const has = parseDosDonts(text).length > 0;
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">Do's and don'ts</h3>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
          >
            {has
              ? "Edit on the ClickUp client card"
              : "Add them on the ClickUp client card"}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
      {has ? (
        <DosDontsList text={text} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing on the client card yet.
        </p>
      )}
    </section>
  );
}
