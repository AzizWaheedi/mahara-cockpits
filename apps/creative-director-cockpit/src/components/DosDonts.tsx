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
  do: "text-emerald-700 dark:text-emerald-300",
  dont: "text-red-700 dark:text-red-300",
  note: "text-muted-foreground",
};
const MARK: Record<Tone, string> = { do: "✓", dont: "✕", note: "•" };

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
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map(s => (
        <div key={s.tone}>
          <p
            className={`text-[11px] font-bold uppercase tracking-wide ${TONE[s.tone]}`}
          >
            {TITLE[s.tone]}
          </p>
          <ul className="mt-1 space-y-1 text-[13px] leading-snug">
            {s.items.map(item => (
              <li key={item} className="flex gap-1.5">
                <span className={TONE[s.tone]}>{MARK[s.tone]}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
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
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Do's & don'ts
        </h3>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] underline underline-offset-2"
          >
            {has
              ? "Edit on the ClickUp client card"
              : "Add them on the ClickUp client card"}
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
