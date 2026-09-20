import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Note } from "../../../convex/ceo/payloads";

/**
 * Trust caveats from a payload. A warning is always in view: it changes how
 * a number should be read. The rest, the provenance and definitions, fold
 * under one line so a card stays a card and not a page of footnotes; open
 * it when a number needs explaining.
 */
export function Notes({
  notes,
  className,
  folded = true,
}: {
  /** The payload's notes; empty or missing renders nothing. */
  notes: Note[] | null | undefined;
  className?: string;
  /** Keep the info notes behind a disclosure (default); false lists everything. */
  folded?: boolean;
}) {
  if (!notes?.length) return null;
  const warn = notes.filter(n => n.level === "warn");
  const info = notes.filter(n => n.level !== "warn");
  const list = (items: Note[]) => (
    <ul className="space-y-1.5">
      {items.map((n, i) => {
        const Icon = n.level === "warn" ? TriangleAlert : Info;
        return (
          <li
            key={`${n.level}-${i}`}
            className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
          >
            <Icon
              className="mt-0.5 size-3.5 shrink-0"
              style={{
                color:
                  n.level === "warn"
                    ? "var(--ceo-warning)"
                    : "var(--muted-foreground)",
              }}
              aria-label={n.level === "warn" ? "Warning" : "Note"}
            />
            <span className="min-w-0">{n.text}</span>
          </li>
        );
      })}
    </ul>
  );
  if (!folded || !info.length)
    return <div className={cn("space-y-1.5", className)}>{list(notes)}</div>;
  return (
    <div className={cn("space-y-2", className)}>
      {warn.length ? list(warn) : null}
      <details className="group">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
          {`Where these numbers come from${info.length > 1 ? ` (${info.length} notes)` : ""}`}
        </summary>
        <div className="mt-2">{list(info)}</div>
      </details>
    </div>
  );
}
