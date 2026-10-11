import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarClock, FileText, Mic, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Chip, ExtLink, Kicker, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  answerText,
  CALL_NAMES,
  FORM_NAMES,
  isStale,
  matchUnmatched,
  readClientTimeline,
  readTranscript,
  readUnmatched,
  type SourceHealth,
  staleSentence,
  type Timeline,
  type TimelineCall,
  type TimelineForm,
  type Unmatched,
} from "@/lib/csmCalls";
import { cn } from "@/lib/utils";

/**
 * The client's calls, forms and the health of their sources, from the CSM
 * call store. Design: the cockpit's own system (DESIGN.md). One signature
 * element: the call spine, a thin rail down the left of the list where each
 * call is a dot by kind, and the next booked call is the one teal glow.
 */

const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Asia/Kuwait",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No date";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: "Booked", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "accent" },
  showed: { label: "Showed", tone: "good" },
  held: { label: "Held", tone: "good" },
  no_show: { label: "No-show", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "warn" },
  gone: { label: "Removed", tone: "neutral" },
};
const SOURCE: Record<string, string> = {
  ghl_appointment: "GoHighLevel",
  fathom: "Fathom",
  checkin_form: "1-1 form",
  manual: "Logged in the cockpit",
  imported: "Imported",
  zoom: "Zoom",
};

/** Past confirmed calls read as held once their time is over (Aziz's rule). */
function statusOf(c: TimelineCall) {
  if (
    c.status === "confirmed" &&
    !c.upcoming &&
    Date.parse(c.endsAt ?? c.startsAt ?? "") < Date.now()
  )
    return STATUS.held;
  return STATUS[c.status] ?? { label: c.status, tone: "neutral" as Tone };
}

function healthOf(h: SourceHealth[], key: string) {
  return h.find(x => x.key === key);
}

/** One plain sentence per missing or stale source that feeds this card. */
function Gaps({ health, keys }: { health: SourceHealth[]; keys: string[] }) {
  const lines = keys
    .map(k => staleSentence(healthOf(health, k), k))
    .filter(Boolean) as string[];
  if (!lines.length) return null;
  return (
    <ul className="space-y-1 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
      {lines.map(l => (
        <li key={l} className="flex gap-2">
          <span
            aria-hidden
            className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-warning"
          />
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

function Answers({ answers }: { answers: TimelineForm["answers"] }) {
  const shown = answers.filter(a => answerText(a.value));
  if (!shown.length)
    return (
      <p className="text-xs text-muted-foreground">
        The form was sent with no answers filled in.
      </p>
    );
  return (
    <dl className="space-y-2 text-sm">
      {shown.map((a, i) => (
        <div key={`${a.ref}-${i}`}>
          <dt className="text-xs text-muted-foreground" dir="auto">
            {a.title || "A question no longer on the form"}
          </dt>
          <dd className="whitespace-pre-wrap" dir="auto">
            {answerText(a.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CallRow({
  c,
  next,
  client,
  taskId,
}: {
  c: TimelineCall;
  next: boolean;
  client: SupabaseClient | null;
  taskId: string;
}) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const st = statusOf(c);
  const hasMore = Boolean(
    c.summary || c.transcript || c.transcriptPath || c.form || c.brief,
  );
  return (
    <li className="relative pl-7">
      <span
        aria-hidden
        className={cn(
          "absolute left-[5px] top-1.5 size-2.5 rounded-full border-2 border-card",
          next
            ? "bg-primary glow-teal"
            : c.upcoming
              ? "bg-primary/50"
              : st.tone === "bad" || st.tone === "warn"
                ? "bg-muted-foreground/40"
                : "bg-foreground/70",
        )}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Kicker>{CALL_NAMES[c.kind] ?? "Call"}</Kicker>
        <span className="text-sm font-medium tabular-nums">
          {when(c.startsAt)}
        </span>
        <Chip tone={st.tone}>{next ? "Next call" : st.label}</Chip>
      </div>
      <div className="mt-1 text-sm" dir="auto">
        {c.title}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {c.host ? <span>Host {c.host}</span> : null}
        <span>{SOURCE[c.source] ?? c.source}</span>
        {c.joinUrl && c.upcoming ? (
          <ExtLink href={c.joinUrl} className="text-xs">
            Join link
          </ExtLink>
        ) : null}
        {c.recordingUrl ? (
          <ExtLink href={c.recordingUrl} className="text-xs">
            Recording
          </ExtLink>
        ) : !c.upcoming && st.tone === "good" ? (
          <span>No recording found</span>
        ) : null}
      </div>
      {c.brief ? (
        <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
          {c.brief}
        </p>
      ) : null}
      {hasMore ? (
        <button
          type="button"
          onClick={async () => {
            setOpen(v => !v);
            if (
              !open &&
              c.transcriptPath &&
              !transcript &&
              client &&
              !transcriptBusy
            ) {
              setTranscriptBusy(true);
              try {
                setTranscript(await readTranscript(client, taskId, c.id));
              } catch (e) {
                setTranscriptError((e as Error).message);
              } finally {
                setTranscriptBusy(false);
              }
            }
          }}
          aria-expanded={open}
          className="mt-1 text-xs text-primary underline-offset-4 hover:underline"
        >
          {open
            ? "Hide the details"
            : `Show ${[c.summary && "summary", (c.transcript || c.transcriptPath) && "transcript", c.form && "1-1 notes"].filter(Boolean).join(", ") || "details"}`}
        </button>
      ) : null}
      {open ? (
        <div className="mt-2 space-y-3 rounded-xl bg-muted/40 p-4">
          {c.summary ? (
            <section>
              <Kicker className="mb-1">Summary</Kicker>
              <p className="whitespace-pre-wrap text-sm" dir="auto">
                {c.summary}
              </p>
            </section>
          ) : null}
          {c.form ? (
            <section>
              <Kicker className="mb-1">1-1 notes</Kicker>
              <Answers answers={c.form.answers} />
            </section>
          ) : null}
          {c.transcript || c.transcriptPath ? (
            <section>
              <Kicker className="mb-1">Transcript</Kicker>
              {transcriptBusy ? (
                <p className="text-xs text-muted-foreground">
                  Opening the private transcript...
                </p>
              ) : null}
              {transcriptError ? (
                <p className="text-xs text-destructive">{transcriptError}</p>
              ) : null}
              {c.transcript || transcript ? (
                <p
                  className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-5"
                  dir="auto"
                >
                  {c.transcript || transcript}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function CallsTimeline({
  timeline,
  client,
}: {
  timeline: Timeline | null;
  client: SupabaseClient | null;
}) {
  const [all, setAll] = useState(false);
  if (!timeline) return null;
  const calls = timeline.calls;
  const nextId = calls.find(c => c.upcoming)?.id;
  const shown = all ? calls : calls.slice(0, 12);
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          Calls{" "}
          <span className="ml-1 font-normal tabular-nums text-muted-foreground">
            {calls.length}
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Booked, recorded and logged, upcoming first
        </span>
      </div>
      <Gaps
        health={timeline.health}
        keys={["csm-ghl-calls", "csm-fathom", "csm-checkin-form"]}
      />
      {calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calls found in GoHighLevel, Fathom or the 1-1 form since 1 Jun.
          Book one with "Book a call" above, or log one you held.
        </p>
      ) : (
        <ol className="relative space-y-5 before:absolute before:bottom-1 before:left-[9px] before:top-2 before:w-px before:bg-border">
          {shown.map(c => (
            <CallRow
              key={c.id}
              c={c}
              next={c.id === nextId}
              client={client}
              taskId={timeline.taskId}
            />
          ))}
        </ol>
      )}
      {calls.length > 12 ? (
        <Button size="sm" variant="ghost" onClick={() => setAll(v => !v)}>
          {all ? "Show fewer" : `Show the other ${calls.length - 12}`}
        </Button>
      ) : null}
    </section>
  );
}

/** What the team wrote about this client in their end-of-day reports, newest first. */
export function TeamEods({ timeline }: { timeline: Timeline | null }) {
  const [all, setAll] = useState(false);
  if (!timeline) return null;
  const eods = timeline.eods;
  const health = timeline.health.find(h => h.key === "csm-eod-mentions");
  const shown = all ? (eods ?? []) : (eods ?? []).slice(0, 8);
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          From the team's EODs{" "}
          <span className="ml-1 font-normal tabular-nums text-muted-foreground">
            {eods ? eods.length : ""}
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Lines that name this client, last 90 days
        </span>
      </div>
      <Gaps health={timeline.health} keys={["csm-eod-mentions"]} />
      {!eods || !health ? (
        <p className="text-sm text-muted-foreground">
          Team EODs have not synced yet, so nothing is shown here. This is not a
          confirmed zero.
        </p>
      ) : eods.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isStale(health)
            ? "None found in the EODs read so far. The EOD sync is behind, so this is not a confirmed zero."
            : "No one has named this client in an EOD in the last 90 days."}
        </p>
      ) : (
        <ul className="-mx-4 divide-y sm:-mx-6">
          {shown.map(e => (
            <li
              key={`${e.source}:${e.at}:${e.author}`}
              className="space-y-1 px-4 py-3 sm:px-6"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="text-sm font-medium text-foreground">
                  {e.author || "Someone on the team"}
                </span>
                {e.role ? <span>{e.role}</span> : null}
                <span className="tabular-nums">{when(e.at)}</span>
                {e.link ? (
                  <ExtLink href={e.link} className="ml-auto">
                    {e.where ?? "Open"}
                  </ExtLink>
                ) : (
                  <span className="ml-auto">{e.where}</span>
                )}
              </div>
              <p dir="auto" className="whitespace-pre-line text-sm">
                {e.excerpt}
              </p>
            </li>
          ))}
        </ul>
      )}
      {eods && eods.length > 8 ? (
        <Button size="sm" variant="ghost" onClick={() => setAll(v => !v)}>
          {all ? "Show fewer" : `Show the other ${eods.length - 8}`}
        </Button>
      ) : null}
    </section>
  );
}

export function FormsHistory({ timeline }: { timeline: Timeline | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!timeline) return null;
  const forms = timeline.forms;
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6">
      <h2 className="text-[15px] font-semibold">
        Forms{" "}
        <span className="ml-1 font-normal tabular-nums text-muted-foreground">
          {forms.length}
        </span>
      </h2>
      <Gaps
        health={timeline.health}
        keys={["csm-checkin-form", "csm-forms-history"]}
      />
      {forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No onboarding, kickoff, Blueprint or 1-1 form has come in for this
          client.
        </p>
      ) : (
        <ul className="-mx-4 divide-y sm:-mx-6">
          {forms.map(f => (
            <li key={f.token} className="px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setOpen(v => (v === f.token ? null : f.token))}
                aria-expanded={open === f.token}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
              >
                <FileText
                  aria-hidden
                  className="size-3.5 self-center text-muted-foreground"
                />
                <span className="text-sm font-medium">
                  {FORM_NAMES[f.kind] ?? f.formId}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {when(f.submittedAt)}
                </span>
                {f.linkedCallId ? (
                  <Chip dot={false}>Linked to a call</Chip>
                ) : null}
                <span className="ml-auto text-xs text-primary">
                  {open === f.token ? "Hide" : "Answers"}
                </span>
              </button>
              {f.recordingUrl ? (
                <ExtLink href={f.recordingUrl} className="mt-1 text-xs">
                  Call recording
                </ExtLink>
              ) : null}
              {open === f.token ? (
                <div className="mt-3 rounded-xl bg-muted/40 p-4">
                  <Answers answers={f.answers} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Calls and forms that matched no client: one click puts each on this client. */
export function UnmatchedQueue({
  client,
  taskId,
  clientName,
  onMatched,
}: {
  client: SupabaseClient | null;
  taskId: string;
  clientName: string;
  onMatched: () => void;
}) {
  const [items, setItems] = useState<Unmatched[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => {
    if (!client) return;
    readUnmatched(client)
      .then(setItems)
      .catch(() => setItems(null));
  }, [client]);
  useEffect(load, [load]);
  if (!items?.length) return null;
  return (
    <details className="group rounded-2xl border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-4 py-3 text-sm sm:px-6">
        <span className="font-medium">
          {items.length}{" "}
          {items.length === 1 ? "call or form" : "calls and forms"} matched no
          client
        </span>
        <span className="text-xs text-muted-foreground">
          If one is {clientName}, put it here.
        </span>
      </summary>
      <ul className="divide-y border-t">
        {items.map(u => (
          <li
            key={u.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-6"
          >
            {u.kind === "call" ? (
              <Video aria-hidden className="size-3.5 text-muted-foreground" />
            ) : (
              <Mic aria-hidden className="size-3.5 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div dir="auto">
                {u.title ||
                  (u.kind === "form" ? "1-1 call notes form" : "Call")}
              </div>
              <div className="text-xs text-muted-foreground" dir="auto">
                {when(u.at)}
                {u.hint ? ` · ${u.hint}` : ""} · {u.reason}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === u.id}
              onClick={async () => {
                if (!client) return;
                setBusy(u.id);
                try {
                  await matchUnmatched(client, u.id, taskId);
                  toast.success(`Saved on ${clientName}`);
                  setItems(v => (v ?? []).filter(x => x.id !== u.id));
                  onMatched();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              This is {clientName}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Read the timeline for a client; reload after a log or a match. */
export function useClientTimeline(
  client: SupabaseClient | null,
  taskId?: string,
) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTimeline(null);
    setError(null);
    if (!client || !taskId) return;
    let live = true;
    readClientTimeline(client, taskId)
      .then(t => live && setTimeline(t))
      .catch(e => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [client, taskId, tick]);
  return { timeline, error, reload: () => setTick(t => t + 1) };
}

export function NextCallLine({
  at,
  kind,
}: {
  at?: string | null;
  kind?: string | null;
}) {
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <CalendarClock aria-hidden className="size-3.5 text-primary" />
      Next: {CALL_NAMES[kind ?? "other"] ?? "Call"} {when(at)}
    </span>
  );
}
