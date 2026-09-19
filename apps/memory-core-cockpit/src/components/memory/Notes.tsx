import { Info, TriangleAlert } from "lucide-react";

/** A trust caveat shown at the foot of a card. */
export type Note = { level: "info" | "warn"; text: string };

/**
 * Caveats from a payload or a search pass: info with an info icon, warnings
 * with a warning icon. Missing is never zero, so the sentence that explains a
 * gap belongs on the card rather than in nobody's head.
 */
export function Notes({
  notes,
  className,
}: {
  notes: (Note | null | undefined)[] | null | undefined;
  className?: string;
}) {
  const rows = (notes ?? []).filter((note): note is Note => Boolean(note));
  if (!rows.length) return null;
  return (
    <ul className={`space-y-1.5 ${className ?? ""}`}>
      {rows.map((note, index) => {
        const Icon = note.level === "warn" ? TriangleAlert : Info;
        return (
          <li
            key={`${note.level}-${index}`}
            className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
          >
            <Icon
              className="mt-0.5 size-3.5 shrink-0"
              style={{
                color:
                  note.level === "warn"
                    ? "var(--mc-warning)"
                    : "var(--muted-foreground)",
              }}
              aria-label={note.level === "warn" ? "Warning" : "Note"}
            />
            <span className="min-w-0">{note.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
