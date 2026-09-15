import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Note } from "../../../convex/ceo/payloads";

/** Trust caveats from a payload: info with an info icon, warn with a warning icon. */
export function Notes({
  notes,
  className,
}: {
  /** The payload's notes; empty or missing renders nothing. */
  notes: Note[] | null | undefined;
  className?: string;
}) {
  if (!notes?.length) return null;
  return (
    <ul className={cn("space-y-1.5", className)}>
      {notes.map((n, i) => {
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
}
