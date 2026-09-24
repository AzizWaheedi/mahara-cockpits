import { PhoneCall, PhoneOff, ScrollText, SkipForward } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  button,
  buttonPrimary,
  EmptyState,
  field,
  SectionCard,
  StatusChip,
  type Tone,
} from "../components/kit";
import { api } from "../lib/api";
import { useLead, useNow } from "../lib/data";
import { ago, classLabel, plainStage } from "../lib/format";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * The power dialer: one lead at a time, in the order the playbook says,
 * called through Maqsam with the right line for the lead's country. The rep
 * saves how it went and the next lead comes up. The queue is worked out on
 * the server from the leads, the calendar, Maqsam's calls and replies; two
 * reps never get the same lead, and a rep never has two calls open.
 */

interface QueueItem {
  contact_id: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  lead_class: string | null;
  tier: 0 | 1 | 2 | 3;
  why: string;
  created_at: string | null;
  last_dial_at: string | null;
  due_at: string | null;
}

interface Attempt {
  id: string;
  contact_id: string;
  state: string;
  started_at: string;
  error: string | null;
}

interface Queue {
  as: "setter" | "closer";
  counts: number[];
  open: Attempt | null;
  queue: QueueItem[];
}

const TIER: Record<number, { tone: Tone; label: string }> = {
  0: { tone: "critical", label: "Call now" },
  1: { tone: "warning", label: "Today" },
  2: { tone: "neutral", label: "Due" },
  3: { tone: "neutral", label: "Never called" },
};

const OUTCOMES: { key: string; label: string; needsNote: boolean }[] = [
  { key: "no_answer", label: "No answer", needsNote: false },
  { key: "callback", label: "Call back", needsNote: true },
  { key: "booked", label: "Booked", needsNote: true },
  { key: "not_interested", label: "Not interested", needsNote: true },
  { key: "disqualified", label: "Disqualified", needsNote: true },
  { key: "wrong_number", label: "Wrong number", needsNote: true },
  { key: "handled", label: "Handled", needsNote: true },
];

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function DialerPage({ me }: { me: Me }) {
  const canBoth = me.manager || me.role === "both";
  const [as, setAs] = useState<"setter" | "closer">(
    me.role === "closer" ? "closer" : "setter",
  );
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const out = await api<Queue>("dial.queue", { as, limit: 40 });
      setQ(out);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [as]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 45_000);
    return () => window.clearInterval(t);
  }, [load]);

  const list = (q?.queue ?? []).filter(i => !skipped.includes(i.contact_id));
  const next = list[0] ?? null;
  const open = q?.open ?? null;

  async function call(contactId: string) {
    setBusy(true);
    try {
      const out = await api<{
        attempt: Attempt;
        route: { country: string; caller: string };
      }>("dial.call", {
        contact_id: contactId,
      });
      toast.success(
        `Calling through Maqsam on the ${out.route.country} line. Pick up in the softphone.`,
      );
      setQ(prev => (prev ? { ...prev, open: out.attempt } : prev));
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const counts = q?.counts ?? [0, 0, 0, 0];

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dialer</h1>
          <p className="muted text-sm">
            {q
              ? `${counts[0] + counts[1]} to call now or today · ${counts[2]} due · ${counts[3]} never called`
              : "Working out who to call…"}
          </p>
        </div>
        {canBoth ? (
          <div
            className="raised inline-flex rounded-[var(--radius-md)] p-0.5 text-sm"
            role="group"
            aria-label="Queue"
          >
            {(["setter", "closer"] as const).map(k => (
              <button
                key={k}
                type="button"
                aria-pressed={as === k}
                onClick={() => {
                  setAs(k);
                  setSkipped([]);
                }}
                className={`rounded-[calc(var(--radius-md)-2px)] px-3 py-1 ${as === k ? "bg-[color:var(--card)] font-medium shadow-sm" : "muted"}`}
              >
                {k === "setter" ? "Setter queue" : "Closer queue"}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          {error}{" "}
          <button type="button" onClick={load} className="underline">
            Try again
          </button>
        </div>
      ) : null}

      {!me.maqsam_email ? (
        <div className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          Your seat has no Maqsam address yet, so the dialer cannot place calls
          for you. Ask Aziz to add it on the Team page. You can still work the
          list and call from the softphone.
        </div>
      ) : null}

      {open ? (
        <OnCall
          attempt={open}
          onSaved={() => {
            setQ(prev => (prev ? { ...prev, open: null } : prev));
            void load();
          }}
        />
      ) : next ? (
        <NextUp
          item={next}
          busy={busy}
          onCall={() => call(next.contact_id)}
          onSkip={() => setSkipped(s => [...s, next.contact_id])}
        />
      ) : q ? (
        <SectionCard title="Next up">
          <EmptyState
            icon={PhoneCall}
            title="Nobody to call right now"
            text="New leads, replies and due callbacks appear here as they happen. The list refreshes every minute."
          />
        </SectionCard>
      ) : null}

      {list.length > 1 ? (
        <SectionCard title="After that" flush>
          <ul className="divide-y hairline">
            {list.slice(1, 25).map(i => (
              <li key={i.contact_id}>
                <Link
                  to={`/lead/${i.contact_id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--secondary)]"
                >
                  <StatusChip
                    tone={TIER[i.tier].tone}
                    label={TIER[i.tier].label}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" dir="auto">
                      {i.name ?? "Unnamed lead"}
                    </p>
                    <p className="muted text-xs">
                      {i.why} · {classLabel(i.lead_class)}
                      {i.created_at ? ` · came in ${ago(i.created_at)}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </main>
  );
}

function NextUp({
  item,
  busy,
  onCall,
  onSkip,
}: {
  item: QueueItem;
  busy: boolean;
  onCall: () => void;
  onSkip: () => void;
}) {
  const lead = useLead(item.contact_id);
  const l = lead.data;
  const brief = l
    ? [l.revenue, l.readiness, l.challenge, l.decision_maker].filter(Boolean)
    : [];
  return (
    <section className="panel overflow-hidden" aria-label="Next up">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b hairline px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip
              tone={TIER[item.tier].tone}
              label={TIER[item.tier].label}
              size="md"
            />
            <span className="muted text-sm">{item.why}</span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight" dir="auto">
            {item.name ?? "Unnamed lead"}
          </h2>
          <p className="muted mt-1 text-sm">
            {[
              l?.company,
              l?.country,
              classLabel(item.lead_class),
              item.stage ? plainStage(item.stage) : null,
              item.created_at ? `came in ${ago(item.created_at)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onSkip} className={button}>
            <SkipForward className="size-3.5" aria-hidden /> Skip
          </button>
          <button
            type="button"
            onClick={onCall}
            disabled={busy}
            className={`${buttonPrimary} h-10 px-4 text-[15px]`}
          >
            <PhoneCall className="size-4" aria-hidden />
            {busy ? "Calling…" : "Call"}
          </button>
        </div>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div>
          <p className="muted text-xs">What they told us</p>
          {brief.length ? (
            <ul className="mt-1 space-y-1 text-sm" dir="auto">
              {brief.map(b => (
                <li key={String(b)}>{String(b)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted mt-1 text-sm">
              No form answers on this contact.
            </p>
          )}
        </div>
        <div>
          <p className="muted text-xs">Before you call</p>
          <p className="mt-1 text-sm">
            {item.last_dial_at
              ? `Last called ${ago(item.last_dial_at)}.`
              : "Nobody has called them yet."}{" "}
            {l?.ad_name ? `They came from the ad "${l.ad_name}".` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to={`/lead/${item.contact_id}`} className={button}>
              Open the lead
            </Link>
            <Link
              to={`/call/${item.contact_id}?script=intro`}
              className={button}
            >
              <ScrollText className="size-3.5" aria-hidden /> The script
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function OnCall({
  attempt,
  onSaved,
}: {
  attempt: Attempt;
  onSaved: () => void;
}) {
  const lead = useLead(attempt.contact_id);
  const now = useNow(1000);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [callback, setCallback] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = OUTCOMES.find(o => o.key === outcome);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    setBusy(true);
    try {
      await api("dial.save", {
        attempt_id: attempt.id,
        outcome,
        note,
        callback_at:
          outcome === "callback" && callback
            ? new Date(callback).toISOString()
            : null,
      });
      toast.success(`Saved: ${chosen?.label ?? outcome}. Next lead is up.`);
      onSaved();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await api("dial.release", { attempt_id: attempt.id });
      onSaved();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel overflow-hidden" aria-label="On a call">
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
        style={{
          borderColor: "color-mix(in oklch, var(--now) 45%, transparent)",
          background: "color-mix(in oklch, var(--now) 8%, transparent)",
        }}
      >
        <div className="min-w-0">
          <p className="muted text-sm">
            {attempt.state === "failed"
              ? "The call did not go through"
              : "On a call"}{" "}
            ·{" "}
            <span className="tabular-nums">
              {mmss(now - Date.parse(attempt.started_at))}
            </span>
          </p>
          <h2 className="text-2xl font-semibold tracking-tight" dir="auto">
            {lead.data?.name ?? "The lead"}
          </h2>
          {attempt.error ? (
            <p className="mt-1 text-sm" style={{ color: "var(--destructive)" }}>
              {attempt.error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/call/${attempt.contact_id}?script=intro`}
            className={button}
          >
            <ScrollText className="size-3.5" aria-hidden /> The script
          </Link>
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className={button}
          >
            <PhoneOff className="size-3.5" aria-hidden /> Skip without saving
          </button>
        </div>
      </div>
      <form onSubmit={save} className="space-y-4 px-5 py-4">
        <div>
          <p className="text-sm font-medium">How did it go?</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OUTCOMES.map(o => (
              <button
                key={o.key}
                type="button"
                aria-pressed={outcome === o.key}
                onClick={() => setOutcome(o.key)}
                className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-sm ${
                  outcome === o.key
                    ? "border-[color:var(--primary)] font-semibold"
                    : "hairline"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {outcome === "callback" ? (
          <label className="block max-w-xs space-y-1">
            <span className="muted block text-xs">
              Call back at (your time)
            </span>
            <input
              type="datetime-local"
              value={callback}
              onChange={e => setCallback(e.target.value)}
              className={field}
              required
            />
          </label>
        ) : null}
        {outcome ? (
          <label className="block space-y-1">
            <span className="muted block text-xs">
              {chosen?.needsNote
                ? "What happened (goes on the lead in HighLevel too)"
                : "Anything worth noting (optional)"}
            </span>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              dir="auto"
              required={chosen?.needsNote}
              className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
            />
          </label>
        ) : null}
        {outcome === "booked" ? (
          <p className="muted text-xs">
            Book the call in HighLevel's calendar as you do now; it shows here
            within a few minutes.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !outcome}
          className={buttonPrimary}
        >
          {busy ? "Saving…" : "Save and next"}
        </button>
      </form>
    </section>
  );
}
