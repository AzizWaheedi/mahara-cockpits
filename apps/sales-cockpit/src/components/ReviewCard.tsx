import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { day } from "../lib/format";
import type { Review } from "../lib/types";
import { StatusChip, type Tone } from "./kit";
import { Prose } from "./Prose";

/**
 * Vince's review of a call: the grade, each part of the framework as a bar
 * out of ten (the one picture here: where the call was weak is visible
 * before a word is read), then the pros, the feedback and the whole log.
 */

export function gradeTone(score: number | null, max: number | null): Tone {
  if (score === null || !max) return "neutral";
  const p = score / max;
  return p >= 0.7 ? "good" : p >= 0.5 ? "warning" : "critical";
}

export function GradeChip({ r }: { r: Pick<Review, "score" | "score_max"> }) {
  if (r.score === null || !r.score_max) return null;
  return (
    <StatusChip
      tone={gradeTone(r.score, r.score_max)}
      label={`${Math.round(r.score)}/${Math.round(r.score_max)}`}
      title="Vince's grade for this call"
    />
  );
}

function Bars({ items }: { items: NonNullable<Review["items"]> }) {
  return (
    <ul className="space-y-1.5">
      {items.map(it => {
        const pct = Math.max(0, Math.min(1, it.score / (it.max || 10)));
        return (
          <li
            key={it.name}
            className="grid grid-cols-[minmax(0,1fr)_7rem_2.5rem] items-center gap-3 text-sm"
          >
            <span className="truncate" title={it.name}>
              {it.name}
            </span>
            <span
              className="relative h-2 rounded-full"
              style={{ background: "var(--secondary)" }}
              role="img"
              aria-label={`${it.name}: ${it.score} of ${it.max}`}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${pct * 100}%`,
                  background:
                    pct >= 0.7
                      ? "var(--primary)"
                      : pct >= 0.5
                        ? "color-mix(in oklch, var(--primary) 55%, var(--muted-foreground))"
                        : "var(--muted-foreground)",
                }}
              />
            </span>
            <span className="text-right tabular-nums">
              {it.score}
              <span className="muted">/{it.max}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewCard({ r }: { r: Review }) {
  const [whole, setWhole] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="muted text-xs">
            {r.call_type === "intro" ? "Intro call" : "Demo call"}
            {r.rep_name ? ` · ${r.rep_name}` : ""}
            {r.call_at ? ` · ${day(r.call_at)}` : ""}
          </p>
          {r.score !== null && r.score_max ? (
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {Math.round(r.score)}
              <span className="muted text-lg font-normal">
                /{Math.round(r.score_max)}
              </span>
            </p>
          ) : (
            <p className="muted text-sm">No grade in this review.</p>
          )}
        </div>
        <p className="muted text-xs">
          {r.source === "desk"
            ? `Written ${day(r.reviewed_at)} with ${r.model ?? "the desk's model"}`
            : "From Vince's archive"}
        </p>
      </div>
      {r.items?.length ? <Bars items={r.items} /> : null}
      {r.pros ? (
        <div>
          <p className="mb-1 text-sm font-semibold">What went well</p>
          <Prose text={r.pros} />
        </div>
      ) : null}
      {r.feedback ? (
        <div>
          <p className="mb-1 text-sm font-semibold">What to change</p>
          <Prose text={r.feedback} />
        </div>
      ) : null}
      <div>
        <button
          type="button"
          onClick={() => setWhole(v => !v)}
          className="muted inline-flex items-center gap-1 text-sm hover:underline"
          aria-expanded={whole}
        >
          {whole ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
          The whole review
        </button>
        {whole ? <Prose text={r.body} className="mt-2" /> : null}
      </div>
    </div>
  );
}
