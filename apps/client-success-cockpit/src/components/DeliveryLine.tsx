/* Hallmark · component: delivery line · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: done (teal) · waiting (amber) · not yet (hollow) · failed (red) · cut (withdrawn or expired)
 * Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4
 */

import { Check, X } from "lucide-react";
import {
  kuwaitDayWords,
  kuwaitTimeWords,
  type DeliveryLine as Line,
  type Ring,
} from "@/lib/clientFormsCore";
import { cn } from "@/lib/utils";

/**
 * The delivery line (docs/forms/WAVE34-CONTRACT.md 5.0, the cockpit's
 * signature for client forms): one horizontal track of small rings in Geist
 * Mono, Sent → Seen → Opened → Answered, with Approve first when WhatsApp is
 * a channel. A ring is teal when done with its time beneath, amber while it
 * is the step waiting, hollow grey before that; a withdrawn or expired invite
 * is cut after its last done ring by a short muted dash and the word. The
 * ring fills in 150 ms, and not at all under reduced motion.
 */

const RING: Record<Ring["state"], string> = {
  done: "border-mahara-teal bg-mahara-teal text-deep-space",
  waiting:
    "border-[color:color-mix(in_oklab,var(--warning)_75%,var(--foreground))] bg-[color:color-mix(in_oklab,var(--warning)_16%,var(--card))]",
  todo: "border-[color:color-mix(in_oklab,var(--foreground)_38%,var(--card))] bg-card",
  failed:
    "border-destructive bg-[color:color-mix(in_oklab,var(--destructive)_14%,var(--card))] text-destructive",
};

const WORD: Record<Ring["state"], string> = {
  done: "done",
  waiting: "waiting",
  todo: "not yet",
  failed: "did not go",
};

function when(at: string | null): string {
  if (!at) return "";
  const t = kuwaitTimeWords(at);
  const d = kuwaitDayWords(at);
  return t ? `${d} ${t}` : d;
}

export function DeliveryLine({
  line,
  className,
}: {
  line: Line;
  className?: string;
}) {
  // A cut invite keeps its done rings and drops the hollow ones after them.
  const rings = line.cut
    ? line.rings.filter((_r, n) =>
        line.rings
          .slice(n)
          .some(x => x.state === "done" || x.state === "failed"),
      )
    : line.rings;
  const label = [
    ...rings.map(
      r => `${r.label} ${WORD[r.state]}${r.at ? ` ${when(r.at)}` : ""}`,
    ),
    line.cut
      ? `${line.cut.word}${line.cut.at ? ` ${when(line.cut.at)}` : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <ol
      className={cn(
        "flex min-w-0 flex-wrap items-start gap-y-2 font-mono text-[11px] leading-4",
        className,
      )}
      aria-label={label}
      data-delivery-line
    >
      {rings.map((r, n) => (
        <li
          key={r.key}
          className="flex min-w-0 items-start"
          data-ring={r.key}
          data-state={r.state}
        >
          {n > 0 ? (
            <span
              aria-hidden
              className={cn(
                "mx-0.5 mt-[7px] h-px w-3 shrink-0 sm:mx-1 sm:w-6",
                r.state === "done" ? "bg-mahara-teal" : "bg-border",
              )}
            />
          ) : null}
          <span
            className="flex min-w-0 flex-col items-center gap-1"
            aria-hidden
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border-2 transition-colors duration-150 motion-reduce:transition-none",
                RING[r.state],
              )}
            >
              {r.state === "done" ? (
                <Check className="size-2.5" strokeWidth={3.5} />
              ) : r.state === "failed" ? (
                <X className="size-2.5" strokeWidth={3.5} />
              ) : null}
            </span>
            <span
              className={cn(
                "whitespace-nowrap",
                r.state === "todo"
                  ? "text-muted-foreground"
                  : "text-foreground",
                r.state === "waiting" && "txt-warn",
              )}
            >
              {r.label}
            </span>
            {r.at && r.state === "done" ? (
              <span className="hidden whitespace-nowrap text-[10px] text-muted-foreground sm:block">
                {when(r.at)}
              </span>
            ) : null}
          </span>
        </li>
      ))}
      {line.cut ? (
        <li className="flex items-start" data-ring="cut" aria-hidden>
          <span className="mx-1 mt-[7px] h-px w-3 shrink-0 bg-muted-foreground/60" />
          <span className="flex flex-col items-start gap-1">
            <span className="mt-px text-muted-foreground">{line.cut.word}</span>
            {line.cut.at ? (
              <span className="hidden whitespace-nowrap text-[10px] text-muted-foreground sm:block">
                {when(line.cut.at)}
              </span>
            ) : null}
          </span>
        </li>
      ) : null}
    </ol>
  );
}
