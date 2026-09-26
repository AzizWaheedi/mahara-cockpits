import { useQuery } from "../lib/data";
import { day } from "../lib/format";
import { supabase } from "../lib/supabase";
import { StatusChip, type Tone } from "./kit";

/**
 * What the recorded calls told us about a lead: the desk's notes after each
 * call (hermes/sales-desk notes), newest first. Only what was said on the
 * call; a field that did not come up is left out.
 */

export interface CallNote {
  id: string;
  recording_id: string;
  contact_id: string | null;
  call_type: "intro" | "demo" | "phone" | "other" | null;
  call_at: string | null;
  rep: string | null;
  notes: {
    summary?: string;
    pains?: string[];
    goals?: string[];
    current_state?: string;
    budget?: string;
    timeline?: string;
    decision_maker?: string;
    questions?: string[];
    objections?: { objection: string; handled: boolean; how: string }[];
    expectations?: string[];
    next_steps?: string[];
    for_closer?: string;
  };
  verdict: "qualified" | "not_qualified" | "unclear" | null;
  verdict_why: string | null;
  model: string | null;
  written_at: string;
}

export function useCallNotes(contactId: string) {
  return useQuery<CallNote[]>(
    () =>
      contactId
        ? supabase
            .from("cockpit_sales_call_notes")
            .select("*")
            .eq("contact_id", contactId)
            .order("call_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [], error: null }),
    [contactId],
  );
}

const VERDICT: Record<string, { tone: Tone; label: string }> = {
  qualified: { tone: "good", label: "Qualified on the call" },
  not_qualified: { tone: "critical", label: "Not qualified on the call" },
  unclear: { tone: "neutral", label: "Unclear from the call" },
};

const KIND: Record<string, string> = {
  intro: "Intro call",
  demo: "Demo",
  phone: "Phone call",
  other: "Call",
};

function Lines({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="muted text-xs">{label}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 ps-5 text-sm" dir="auto">
        {items.map(x => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <div>
      <p className="muted text-xs">{label}</p>
      <p className="text-sm" dir="auto">
        {text}
      </p>
    </div>
  );
}

export function CallNotesList({
  notes,
  compact = false,
}: {
  notes: CallNote[];
  compact?: boolean;
}) {
  if (!notes.length)
    return (
      <p className="muted text-sm">
        No notes from a recorded call yet. They appear within an hour of a
        call's transcript arriving.
      </p>
    );
  return (
    <div className="space-y-4">
      {notes.slice(0, compact ? 1 : 3).map(n => {
        const v = VERDICT[n.verdict ?? "unclear"];
        return (
          <article key={n.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">
                {KIND[n.call_type ?? "other"]} · {day(n.call_at)}
                {n.rep ? (
                  <span className="muted font-normal"> · {n.rep}</span>
                ) : null}
              </p>
              <StatusChip
                tone={v.tone}
                label={v.label}
                title={n.verdict_why ?? undefined}
              />
            </div>
            {n.notes.summary ? (
              <p className="text-sm" dir="auto">
                {n.notes.summary}
              </p>
            ) : null}
            {n.notes.for_closer ? (
              <p
                className="rounded-[var(--radius-md)] border-s-2 py-1 ps-3 text-sm"
                style={{
                  borderColor: "var(--primary)",
                  background:
                    "color-mix(in oklch, var(--primary) 7%, transparent)",
                }}
                dir="auto"
              >
                {n.notes.for_closer}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Budget" text={n.notes.budget} />
              <Fact label="Who decides" text={n.notes.decision_maker} />
              <Fact label="Timeline" text={n.notes.timeline} />
              <Fact label="Where they are now" text={n.notes.current_state} />
            </div>
            {compact ? null : (
              <>
                <Lines label="Pains" items={n.notes.pains} />
                <Lines label="Goals" items={n.notes.goals} />
                <Lines label="They asked" items={n.notes.questions} />
                <Lines label="They expect" items={n.notes.expectations} />
                <Lines label="Next steps" items={n.notes.next_steps} />
              </>
            )}
            {n.notes.objections?.length ? (
              <div>
                <p className="muted text-xs">Objections</p>
                <ul className="mt-0.5 space-y-0.5 text-sm" dir="auto">
                  {n.notes.objections.map(o => (
                    <li key={o.objection}>
                      {o.objection}
                      <span className="muted">
                        {o.handled
                          ? ` · handled${o.how ? `: ${o.how}` : ""}`
                          : " · not handled"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {n.verdict_why ? (
              <p className="muted text-xs">Why: {n.verdict_why}</p>
            ) : null}
          </article>
        );
      })}
      <p className="muted text-xs">
        Drafted by the assistant from the call's transcript. Only what was said
        on the call.
      </p>
    </div>
  );
}
