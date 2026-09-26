import { ChevronDown, ChevronRight, Flame, Send, Sparkles } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DeskStatus } from "../components/DeskStatus";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  page,
  SectionCard,
  Segmented,
  SourceNote,
  StatusChip,
  select,
  type Tone,
} from "../components/kit";
import { useWorkflows, WhatsAppLibrary } from "../components/WhatsAppLibrary";
import { api } from "../lib/api";
import { useLeadsById, useQuery, useSetting, useTemplates } from "../lib/data";
import { ago, clock, day } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { firstWord, renderTemplate } from "../lib/whatsapp";

/**
 * The follow-up agent's drafts, waiting for a rep's yes, hottest first.
 *
 * Aziz, 2026-09-24: "for the first few days with approval ... until it's
 * fully trained. They can just approve it, and it goes straight up. The
 * sales manager should be able to see it as well."
 *
 * Aziz, 2026-09-26: WhatsApp first ("not just email, because the reply rates
 * are very low"), and "start replacing our follow-ups": the no-shows, the
 * cancellations and the new leads who did not book get messages written for
 * them in place of HighLevel's automations, each kind switched to send by
 * itself, and to take a lead out of the old automation, once a manager
 * trusts it. What the agent writes, how reps changed it, and how often leads
 * wrote back are all here.
 */

type Segment =
  | "reply"
  | "confirm"
  | "no_show"
  | "cancelled"
  | "new"
  | "after_call"
  | "nurture";
type FChannel = "whatsapp" | "whatsapp_template" | "email";

interface Followup {
  id: string;
  contact_id: string;
  owner_email: string | null;
  segment: Segment;
  channel: FChannel;
  template_key: string | null;
  touch: number | null;
  heat: number | null;
  appointment_id: string | null;
  subject: string | null;
  body: string;
  why: string;
  context: {
    lead?: Record<string, unknown>;
    calls_on_the_calendar?: {
      call_type: string;
      start_at: string;
      status: string;
    }[];
    rep_notes?: { text: string; at: string }[];
    the_call?: {
      type: string | null;
      relative: string;
      time_24h: string;
    } | null;
    heat?: string[];
  } | null;
  model: string | null;
  status: "draft" | "sending" | "sent" | "skipped" | "expired" | "failed";
  created_at: string;
  expires_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  final_body: string | null;
  edited: boolean | null;
  skip_reason: string | null;
  error: string | null;
  auto: boolean;
  replied_at: string | null;
  took_over: Record<string, string> | null;
}

interface Settings {
  enabled: boolean;
  autosend: Partial<Record<Segment, boolean>>;
  takeover?: Partial<Record<Segment, boolean>>;
  replaces?: Partial<Record<Segment, string[]>>;
  email_fallback?: Partial<Record<Segment, boolean>>;
  cadence?: Partial<Record<Segment, number[]>>;
  automation_gap_hours?: number;
  per_run: number;
  per_day: number;
  quiet: { from: number; to: number };
  nurture_every_days: number;
  nurture_per_day?: number;
}

const SEGMENT: Record<Segment, { label: string; tone: Tone }> = {
  reply: { label: "They wrote", tone: "critical" },
  confirm: { label: "Confirm the call", tone: "warning" },
  no_show: { label: "Missed their call", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "warning" },
  new: { label: "New lead", tone: "good" },
  after_call: { label: "After the demo", tone: "neutral" },
  nurture: { label: "Long-term", tone: "neutral" },
};
const SEGMENTS = Object.keys(SEGMENT) as Segment[];
const CHANNEL: Record<FChannel, string> = {
  whatsapp: "WhatsApp",
  whatsapp_template: "WhatsApp template",
  email: "Email",
};

/** The HighLevel automations each kind replaces, by the names they had on 2026-09-26. */
const REPLACES_WORDS: Partial<Record<Segment, string>> = {
  new: "1.1 New Leads [DAY 1] and 1.2 Short Term Nurture",
  no_show: "2.3 Call No Show Sequence (and its intro copy)",
  cancelled: "2.2 Call Cancelled Sequence (and its intro copy)",
  nurture: "1.3 Long Term Nurture",
};

const SKIPS = [
  "Already handled",
  "Wrong message for them",
  "Not a real lead",
  "Too soon",
];

export default function FollowupsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab =
    (params.get("tab") as "waiting" | "sent" | "learning" | "library") ??
    "waiting";
  const everyone = me.manager && params.get("whose") !== "mine";
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const since = useMemo(
    () => new Date(Date.now() - 30 * 86_400_000).toISOString(),
    [],
  );
  const rows = useQuery<Followup[]>(
    () => {
      let q = supabase
        .from("cockpit_sales_followups")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      // A rep's own leads, and the leads nobody owns yet (anyone may send those).
      if (!everyone)
        q = q.or(`owner_email.eq."${me.email ?? ""}",owner_email.is.null`);
      return q;
    },
    [everyone, me.email, since],
    60_000,
  );
  const settings = useSetting<Settings>("followups");
  const all = rows.data ?? [];
  // The most urgent kind first, and within a kind the hottest lead first.
  const waiting = all
    .filter(
      f =>
        f.status === "draft" &&
        (!f.expires_at || Date.parse(f.expires_at) > Date.now()),
    )
    .sort(
      (a, b) =>
        SEGMENTS.indexOf(a.segment) - SEGMENTS.indexOf(b.segment) ||
        (b.heat ?? 0) - (a.heat ?? 0) ||
        Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  const done = all.filter(f => f.status !== "draft");
  const leads = useLeadsById([...new Set(all.map(f => f.contact_id))]);
  const nameOf = useMemo(
    () => new Map((leads.data ?? []).map(l => [l.contact_id, l.name] as const)),
    [leads.data],
  );

  return (
    <main className={page}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
          <p className="muted mt-1 text-sm">
            Written by the follow-up agent for{" "}
            {everyone ? "the team's" : "your"} leads and the ones nobody owns
            yet, hottest first, on WhatsApp wherever it can go. Nothing goes to
            a lead until a person approves it, except the kinds a manager has
            trusted to send by themselves.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me.manager ? (
            <select
              aria-label="Whose follow-ups"
              value={everyone ? "team" : "mine"}
              onChange={e =>
                set("whose", e.target.value === "mine" ? "mine" : null)
              }
              className={select}
            >
              <option value="team">The whole team</option>
              <option value="mine">Mine</option>
            </select>
          ) : null}
          <Segmented
            label="Show"
            value={tab}
            options={[
              [
                "waiting",
                `Waiting${waiting.length ? ` (${waiting.length})` : ""}`,
              ],
              ["sent", "Sent"],
              ["learning", "How it works"],
              ["library", "WhatsApp library"],
            ]}
            onChange={k => set("tab", k === "waiting" ? null : k)}
          />
        </div>
      </header>

      <DeskStatus
        jobs={[{ job: "followups", what: "The follow-up agent", staleMin: 75 }]}
      />
      <WhatsappHealth />

      {tab === "library" ? (
        <WhatsAppLibrary manager={Boolean(me.manager)} />
      ) : rows.error ? (
        <Failed what="The follow-ups" error={rows.error} retry={rows.reload} />
      ) : rows.loading && !all.length ? (
        <p className="muted text-sm">Reading the drafts…</p>
      ) : tab === "waiting" ? (
        waiting.length ? (
          <div className="space-y-4">
            {waiting.map(f => (
              <DraftCard
                key={f.id}
                f={f}
                lead={nameOf.get(f.contact_id) ?? null}
                showOwner={Boolean(everyone)}
                steps={settings.data?.cadence?.[f.segment]?.length ?? null}
                onDone={rows.reload}
              />
            ))}
          </div>
        ) : (
          <section className="panel">
            <EmptyState
              icon={Sparkles}
              title="Nothing waiting"
              text="The agent looks every half hour, from 9 in the morning to 9 at night, for leads who wrote, have a call to confirm, missed or cancelled a call, just came in, had a demo, or have gone quiet."
            />
          </section>
        )
      ) : tab === "sent" ? (
        <SentList rows={done} nameOf={nameOf} />
      ) : (
        <Learning
          rows={all}
          manager={Boolean(me.manager)}
          settings={settings}
        />
      )}

      <SourceNote label="How the drafts are written">
        The assistant reads what the cockpit knows about the lead: their
        answers, the calendar, the calls and their notes, the conversation in
        HighLevel and any research. It writes WhatsApp while the lead's 24-hour
        window is open; outside it, one line for an approved WhatsApp template
        once one is live in the WhatsApp library; email only where neither can
        go and that kind allows it. While a HighLevel automation or a rep has
        messaged the lead lately, it waits. When a rep changes a draft before
        sending it, the next drafts of that kind are shown the change as what
        good looks like.
      </SourceNote>
    </main>
  );
}

function DraftCard({
  f,
  lead,
  showOwner,
  steps,
  onDone,
}: {
  f: Followup;
  lead: string | null;
  showOwner: boolean;
  steps: number | null;
  onDone: () => void;
}) {
  const [body, setBody] = useState(f.body);
  const [subject, setSubject] = useState(f.subject ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const templates = useTemplates();
  const seg = SEGMENT[f.segment];
  const template =
    f.channel === "whatsapp_template"
      ? ((templates.data ?? []).find(t => t.key === f.template_key) ?? null)
      : null;
  const reasons = f.context?.heat ?? [];
  const call = f.context?.the_call;

  async function approve(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api<{
        followup: Followup;
        message: {
          state: string;
          error: string | null;
          provider_status: string | null;
        };
      }>("followup.approve", {
        id: f.id,
        body,
        subject: f.channel === "email" ? subject : undefined,
      });
      if (out.followup.status === "failed")
        toast.error(
          `It did not deliver: ${out.message.error ?? out.followup.error ?? "no reason given"}.`,
        );
      else
        toast.success(
          out.message.provider_status === "enrolled"
            ? "HighLevel is sending the template now."
            : `Sent by ${CHANNEL[f.channel]}.`,
        );
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function skip(reason: string) {
    setBusy(true);
    try {
      await api("followup.skip", { id: f.id, reason });
      toast.success("Skipped.");
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
      setSkipping(false);
    }
  }

  return (
    <form onSubmit={approve} className="panel space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/lead/${f.contact_id}`}
              className="font-semibold hover:underline"
              dir="auto"
            >
              {lead ?? "A lead"}
            </Link>
            <StatusChip tone={seg.tone} label={seg.label} />
            <span className="muted text-xs">
              {CHANNEL[f.channel]}
              {f.touch && steps && steps > 1
                ? ` · message ${f.touch} of ${steps}`
                : ""}
              {call
                ? ` · the call is ${call.relative} at ${call.time_24h}`
                : ""}
              {f.expires_at
                ? ` · good until ${day(f.expires_at)} ${clock(f.expires_at)}`
                : ""}
              {!f.owner_email
                ? " · nobody's lead yet: anyone can send it"
                : showOwner
                  ? ` · ${f.owner_email.split("@")[0]}`
                  : ""}
            </span>
          </div>
          {reasons.length ? (
            <p className="mt-1 text-xs" style={{ color: "var(--primary)" }}>
              <Flame
                className="me-0.5 inline size-3 align-[-2px]"
                aria-hidden
              />
              {reasons.join(" · ")}
            </p>
          ) : null}
          <p className="muted mt-1 text-sm">{f.why}</p>
        </div>
        <p className="muted text-xs">Written {ago(f.created_at)}</p>
      </div>
      {f.channel === "email" ? (
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className={field}
          dir="auto"
          aria-label="Subject"
        />
      ) : null}
      <textarea
        value={body}
        onChange={e =>
          setBody(
            f.channel === "whatsapp_template"
              ? e.target.value.replace(/[\r\n]+/g, " ")
              : e.target.value,
          )
        }
        rows={
          f.channel === "whatsapp_template"
            ? 2
            : Math.min(10, Math.max(3, body.split("\n").length + 1))
        }
        className={`${field} h-auto py-2 leading-relaxed`}
        dir="auto"
        aria-label={
          f.channel === "whatsapp_template"
            ? "The line that goes in the template"
            : "The message"
        }
      />
      {f.channel === "whatsapp_template" ? (
        template ? (
          <div>
            <p className="muted mb-1 text-xs">
              What they read ({"{{2}}"} is signed with the lead's rep, else the
              sales team):
            </p>
            <p
              className="whitespace-pre-wrap rounded-[var(--radius-md)] border-s-2 px-3 py-2 text-sm"
              style={{
                borderColor: "var(--primary)",
                background:
                  "color-mix(in oklch, var(--primary) 7%, transparent)",
              }}
              dir="auto"
            >
              {renderTemplate(template, {
                first_name: firstWord(lead) || undefined,
                line: body.trim() || undefined,
              })}
            </p>
          </div>
        ) : (
          <p className="text-xs">
            The template this draft was written for is not live any more; it
            cannot be sent. Skip it and the agent writes a fresh one.
          </p>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={
            busy ||
            !body.trim() ||
            (f.channel === "whatsapp_template" &&
              !(template?.active && template.workflow_id))
          }
          className={buttonPrimary}
        >
          <Send className="size-3.5" aria-hidden />
          {busy
            ? "Sending…"
            : body.trim() !== f.body.trim()
              ? "Send my version"
              : "Approve and send"}
        </button>
        {skipping ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {SKIPS.map(r => (
              <button
                key={r}
                type="button"
                disabled={busy}
                onClick={() => skip(r)}
                className={button}
              >
                {r}
              </button>
            ))}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSkipping(true)}
            className={button}
          >
            Skip
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="muted inline-flex items-center gap-1 text-xs hover:underline"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-3" aria-hidden />
          ) : (
            <ChevronRight className="size-3" aria-hidden />
          )}
          What it used
        </button>
      </div>
      {open ? <ContextView f={f} /> : null}
    </form>
  );
}

function ContextView({ f }: { f: Followup }) {
  const c = f.context ?? {};
  const lead = c.lead ?? {};
  const answers = Object.entries(lead).filter(
    ([k, v]) => v && !["name", "lead_created_at"].includes(k),
  );
  return (
    <div className="muted space-y-2 border-t hairline pt-2 text-xs">
      {answers.length ? (
        <p dir="auto">
          {answers
            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
            .join(" · ")}
        </p>
      ) : null}
      {c.calls_on_the_calendar?.length ? (
        <p>
          Calls:{" "}
          {c.calls_on_the_calendar
            .map(a => `${a.call_type} ${ago(a.start_at)} (${a.status})`)
            .join(" · ")}
        </p>
      ) : null}
      {c.rep_notes?.length ? (
        <div>
          Notes:
          {c.rep_notes.map(n => (
            <p key={n.at} dir="auto">
              “{n.text}”
            </p>
          ))}
        </div>
      ) : null}
      <p>Drafted by the assistant.</p>
    </div>
  );
}

function SentList({
  rows,
  nameOf,
}: {
  rows: Followup[];
  nameOf: Map<string, string | null>;
}) {
  if (!rows.length)
    return (
      <section className="panel">
        <EmptyState
          icon={Send}
          title="Nothing sent yet"
          text="Approved follow-ups and skipped ones show here for 30 days."
        />
      </section>
    );
  return (
    <SectionCard title="The last 30 days" flush>
      <ul className="divide-y hairline">
        {rows.map(f => (
          <li key={f.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate" dir="auto">
                <Link
                  to={`/lead/${f.contact_id}`}
                  className="font-medium hover:underline"
                >
                  {nameOf.get(f.contact_id) ?? "A lead"}
                </Link>{" "}
                <span className="muted">
                  · {SEGMENT[f.segment].label} · {CHANNEL[f.channel]}
                </span>
              </p>
              <p className="muted truncate text-xs" dir="auto">
                {f.status === "skipped"
                  ? `Skipped: ${f.skip_reason ?? "no reason"}`
                  : (f.final_body ?? f.body)}
              </p>
              {f.error ? (
                <p className="text-xs">Why it failed: {f.error}</p>
              ) : null}
              {f.took_over ? (
                <p className="muted text-xs">
                  Taken out of HighLevel's automation:{" "}
                  {Object.values(f.took_over).every(v => v === "taken out")
                    ? "yes"
                    : Object.values(f.took_over).join("; ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusChip
                tone={
                  f.status === "sent"
                    ? "good"
                    : f.status === "failed"
                      ? "critical"
                      : "neutral"
                }
                label={
                  f.status === "sent"
                    ? f.auto
                      ? "Sent by itself"
                      : f.edited
                        ? "Sent, edited"
                        : "Sent as written"
                    : f.status === "skipped"
                      ? "Skipped"
                      : f.status === "expired"
                        ? "Went stale"
                        : f.status === "failed"
                          ? "Did not send"
                          : "Sending"
                }
              />
              {f.replied_at ? (
                <StatusChip
                  tone="good"
                  label={`They wrote back ${ago(f.replied_at)}`}
                />
              ) : null}
              <span className="muted text-xs">
                {f.decided_by ? `${f.decided_by.split("@")[0]} · ` : ""}
                {ago(f.decided_at ?? f.created_at)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function Learning({
  rows,
  manager,
  settings,
}: {
  rows: Followup[];
  manager: boolean;
  settings: ReturnType<typeof useSetting<Settings>>;
}) {
  const s = settings.data;
  const workflows = useWorkflows(manager);
  const flowName = useMemo(
    () => new Map((workflows.data ?? []).map(w => [w.id, w.name] as const)),
    [workflows.data],
  );
  const stats = SEGMENTS.map(seg => {
    const of = rows.filter(r => r.segment === seg);
    const sent = of.filter(r => r.status === "sent");
    const byPerson = sent.filter(r => !r.auto);
    const asWritten = byPerson.filter(r => !r.edited).length;
    return {
      seg,
      written: of.length,
      sent: sent.length,
      byPerson: byPerson.length,
      asWritten,
      edited: byPerson.length - asWritten,
      skipped: of.filter(r => r.status === "skipped").length,
      replied: sent.filter(r => r.replied_at).length,
      whatsapp: sent.filter(r => r.channel !== "email").length,
    };
  });
  const [busy, setBusy] = useState(false);

  async function save(next: Settings) {
    setBusy(true);
    try {
      await api("followup.settings", { value: next });
      toast.success("Saved.");
      settings.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: "autosend" | "takeover", seg: Segment, on: boolean) => {
    if (!s) return;
    void save({ ...s, [key]: { ...(s[key] ?? {}), [seg]: on } });
  };

  return (
    <div className="space-y-6">
      <SectionCard title="The last 30 days, by kind of message" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="muted text-left text-xs">
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 text-right font-medium">Written</th>
                <th className="px-3 py-2 text-right font-medium">
                  Sent as written
                </th>
                <th className="px-3 py-2 text-right font-medium">Edited</th>
                <th className="px-3 py-2 text-right font-medium">Skipped</th>
                <th className="px-3 py-2 text-right font-medium">Wrote back</th>
                <th className="px-3 py-2 text-right font-medium">
                  Sends by itself
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  Replaces HighLevel's
                </th>
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {stats.map(r => {
                const replaces = s?.replaces?.[r.seg] ?? [];
                return (
                  <tr key={r.seg}>
                    <td className="px-4 py-2">{SEGMENT[r.seg].label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.written}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.asWritten}
                      {r.byPerson ? (
                        <span className="muted text-xs">
                          {" "}
                          ({Math.round((100 * r.asWritten) / r.byPerson)}%)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.edited}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.skipped}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums"
                      title="Sent follow-ups the lead wrote back to within a week, read from the conversation copy"
                    >
                      {r.sent ? (
                        <>
                          {r.replied}
                          <span className="muted text-xs">
                            {" "}
                            of {r.sent} (
                            {Math.round((100 * r.replied) / r.sent)}%)
                          </span>
                        </>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Switch
                        on={Boolean(s?.autosend?.[r.seg])}
                        can={manager && Boolean(s)}
                        busy={busy}
                        label={`${SEGMENT[r.seg].label} sends by itself`}
                        onChange={on => toggle("autosend", r.seg, on)}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {replaces.length ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="muted max-w-[14rem] truncate text-xs"
                            title={replaces
                              .map(id => flowName.get(id) ?? id)
                              .join(", ")}
                          >
                            {REPLACES_WORDS[r.seg] ??
                              `${replaces.length} workflow${replaces.length === 1 ? "" : "s"}`}
                          </span>
                          <Switch
                            on={Boolean(s?.takeover?.[r.seg])}
                            can={manager && Boolean(s)}
                            busy={busy}
                            label={`${SEGMENT[r.seg].label} takes over from HighLevel`}
                            onChange={on => toggle("takeover", r.seg, on)}
                          />
                        </span>
                      ) : (
                        <span className="muted text-xs">nothing</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="muted space-y-1 border-t hairline px-4 py-2 text-xs">
          <p>
            Sends by itself: once reps send most of a kind's drafts as written,
            switch it on and its drafts go without waiting for a person, through
            the same checks as a rep's send.
          </p>
          <p>
            Replaces HighLevel's: on, a lead the cockpit messages is taken out
            of that automation at the send, so they never get both. While it is
            off, the agent waits 20 hours after an automation's message before
            writing. To retire an automation for everyone, switch it off in
            HighLevel once the cockpit's messages do better.
          </p>
        </div>
      </SectionCard>
      {manager && s ? <SettingsForm s={s} busy={busy} onSave={save} /> : null}
      {manager ? <GuardForm /> : null}
    </div>
  );
}

/**
 * WhatsApp's health over the last day: templates sent today against the
 * ceiling, and what failed at Meta. Automatic sends pause by themselves
 * when too many fail (sales-api whatsappHealth); this says so.
 */
function WhatsappHealth() {
  const since = useMemo(
    () => new Date(Date.now() - 86_400_000).toISOString(),
    [],
  );
  const guard = useSetting<Guard>("whatsapp_guard");
  const sends = useQuery<
    { state: string; error: string | null; via: string; created_at: string }[]
  >(
    () =>
      supabase
        .from("cockpit_sales_messages")
        .select("state,error,via,created_at")
        .eq("channel", "whatsapp")
        .gte("created_at", since)
        .limit(2000),
    [since],
    120_000,
  );
  if (sends.error)
    return (
      <p className="muted text-xs">
        WhatsApp's last day could not be read: {sends.error}.
      </p>
    );
  const rows = sends.data ?? [];
  const settled = rows.filter(r =>
    ["sent", "delivered", "read", "failed"].includes(r.state),
  );
  const failed = settled.filter(r => r.state === "failed");
  // Kuwait's midnight (UTC+3) that began today.
  const k = new Date(Date.now() + 3 * 3_600_000);
  const midnight =
    Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) -
    3 * 3_600_000;
  const templatesToday = rows.filter(
    r =>
      r.via === "workflow" &&
      r.state !== "failed" &&
      Date.parse(r.created_at) >= midnight,
  ).length;
  const g = guard.data;
  const paused = Boolean(
    g &&
      settled.length >= g.pause_min_sends &&
      failed.length / settled.length >= g.pause_fail_share,
  );
  if (!settled.length && !templatesToday) return null;
  const reasons = [...new Set(failed.map(r => r.error).filter(Boolean))].slice(
    0,
    2,
  );
  return (
    <p
      className={`text-xs ${paused ? "callout-bad rounded-[var(--radius-md)] border px-2 py-1" : "muted"}`}
    >
      WhatsApp, last day: {settled.length} sent, {failed.length} failed
      {reasons.length ? ` (${reasons.join("; ")})` : ""}.{" "}
      {g
        ? `${templatesToday} of today's ${g.templates_per_day} templates.`
        : ""}
      {paused
        ? " Automatic sends are paused until fewer fail; people can still send."
        : ""}
    </p>
  );
}

interface Guard {
  templates_per_day: number;
  pause_fail_share: number;
  pause_min_sends: number;
}

function GuardForm() {
  const guard = useSetting<Guard>("whatsapp_guard");
  const [perDay, setPerDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = guard.data;
  if (!g) return null;
  const value = perDay ?? String(g.templates_per_day);
  return (
    <SectionCard title="WhatsApp ceilings">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("whatsapp.guard", {
              value: { ...g, templates_per_day: Number(value) },
            });
            toast.success("Saved.");
            setPerDay(null);
            guard.reload();
          } catch (err) {
            toast.error(String((err as Error).message ?? err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block space-y-1 text-sm">
          <span className="muted block text-xs">
            WhatsApp templates a day, at most
          </span>
          <input
            value={value}
            onChange={e => setPerDay(e.target.value)}
            inputMode="numeric"
            className={`${field} w-32`}
          />
        </label>
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy ? "Saving…" : "Save"}
        </button>
        <p className="muted w-full text-xs">
          Meta limits how many conversations a number may start in a day and
          marks it down when too many messages are ignored or reported. Past
          this ceiling templates wait for tomorrow. Automatic sends also pause
          by themselves when {Math.round(g.pause_fail_share * 100)}% or more of
          the last day's WhatsApp sends failed (once {g.pause_min_sends} have
          gone out).
        </p>
      </form>
    </SectionCard>
  );
}

function Switch({
  on,
  can,
  busy,
  label,
  onChange,
}: {
  on: boolean;
  can: boolean;
  busy: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  if (!can) return <span className="text-xs">{on ? "On" : "Off"}</span>;
  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        aria-label={label}
        onChange={e => onChange(e.target.checked)}
      />
      {on ? "On" : "Off"}
    </label>
  );
}

function SettingsForm({
  s,
  busy,
  onSave,
}: {
  s: Settings;
  busy: boolean;
  onSave: (v: Settings) => void;
}) {
  const [v, setV] = useState(s);
  return (
    <SectionCard title="How the agent works">
      <form
        onSubmit={e => {
          e.preventDefault();
          onSave(v);
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={e => setV({ ...v, enabled: e.target.checked })}
          />
          The agent writes drafts
        </label>
        {(
          [
            ["per_run", "Drafts each half hour"],
            ["per_day", "Drafts a day, at most"],
            ["nurture_every_days", "Days between long-term messages"],
            ["nurture_per_day", "Long-term messages a day, at most"],
            [
              "automation_gap_hours",
              "Hours to wait after a HighLevel automation's message",
            ],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="block space-y-1 text-sm">
            <span className="muted block text-xs">{label}</span>
            <input
              value={String(
                v[k] ??
                  (k === "nurture_per_day"
                    ? 20
                    : k === "automation_gap_hours"
                      ? 20
                      : ""),
              )}
              onChange={e => setV({ ...v, [k]: Number(e.target.value) || 0 })}
              inputMode="numeric"
              className={field}
            />
          </label>
        ))}
        <label className="block space-y-1 text-sm">
          <span className="muted block text-xs">
            Quiet hours (Kuwait), from and to
          </span>
          <span className="flex gap-2">
            <input
              value={String(v.quiet.from)}
              onChange={e =>
                setV({
                  ...v,
                  quiet: { ...v.quiet, from: Number(e.target.value) || 0 },
                })
              }
              inputMode="numeric"
              className={field}
              aria-label="Quiet from"
            />
            <input
              value={String(v.quiet.to)}
              onChange={e =>
                setV({
                  ...v,
                  quiet: { ...v.quiet, to: Number(e.target.value) || 0 },
                })
              }
              inputMode="numeric"
              className={field}
              aria-label="Quiet to"
            />
          </span>
        </label>
        <fieldset className="space-y-1 text-sm sm:col-span-2">
          <legend className="muted mb-1 text-xs">
            Email when WhatsApp cannot go (no open window and no live template)
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {SEGMENTS.map(seg => (
              <label key={seg} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={v.email_fallback?.[seg] !== false}
                  onChange={e =>
                    setV({
                      ...v,
                      email_fallback: {
                        ...(v.email_fallback ?? {}),
                        [seg]: e.target.checked,
                      },
                    })
                  }
                />
                {SEGMENT[seg].label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={buttonPrimary}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
