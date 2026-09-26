import { ChevronDown, ChevronRight, Send, Sparkles } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
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
import { api } from "../lib/api";
import { useLeadsById, useQuery, useSetting } from "../lib/data";
import { ago, clock, day } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * The follow-up agent's drafts, waiting for a rep's yes (Aziz, 2026-09-24:
 * "for the first few days with approval ... until it's fully trained. They
 * can just approve it, and it goes straight up. The sales manager should be
 * able to see it as well."). A rep sees the drafts for their own leads; a
 * manager sees everyone's, and decides which kinds of message are trusted
 * to go by themselves, from how often reps approved them unchanged.
 */

type Segment = "reply" | "no_show" | "new" | "after_call" | "nurture";

interface Followup {
  id: string;
  contact_id: string;
  owner_email: string | null;
  segment: Segment;
  channel: "whatsapp" | "email";
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
}

interface Settings {
  enabled: boolean;
  autosend: Record<Segment, boolean>;
  per_run: number;
  per_day: number;
  quiet: { from: number; to: number };
  nurture_every_days: number;
  nurture_per_day?: number;
}

const SEGMENT: Record<Segment, { label: string; tone: Tone }> = {
  reply: { label: "They wrote", tone: "critical" },
  no_show: { label: "Missed their call", tone: "warning" },
  new: { label: "New lead", tone: "good" },
  after_call: { label: "After the demo", tone: "neutral" },
  nurture: { label: "Long-term", tone: "neutral" },
};
const SEGMENTS = Object.keys(SEGMENT) as Segment[];

const SKIPS = [
  "Already handled",
  "Wrong message for them",
  "Not a real lead",
  "Too soon",
];

export default function FollowupsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab =
    (params.get("tab") as "waiting" | "sent" | "learning") ?? "waiting";
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
        .limit(500);
      if (!everyone) q = q.eq("owner_email", me.email ?? "");
      return q;
    },
    [everyone, me.email, since],
    60_000,
  );
  const all = rows.data ?? [];
  const waiting = all.filter(
    f =>
      f.status === "draft" &&
      (!f.expires_at || Date.parse(f.expires_at) > Date.now()),
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
            {everyone ? "the team's" : "your"} leads. Nothing goes to a lead
            until a person approves it.
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
              ["learning", "How it is learning"],
            ]}
            onChange={k => set("tab", k === "waiting" ? null : k)}
          />
        </div>
      </header>

      {rows.error ? (
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
                onDone={rows.reload}
              />
            ))}
          </div>
        ) : (
          <section className="panel">
            <EmptyState
              icon={Sparkles}
              title="Nothing waiting"
              text="The agent looks every half hour, from 9 in the morning to 9 at night, for leads who wrote, missed a call, just came in, had a demo, or have gone quiet."
            />
          </section>
        )
      ) : tab === "sent" ? (
        <SentList rows={done} nameOf={nameOf} />
      ) : (
        <Learning rows={all} manager={Boolean(me.manager)} />
      )}

      <SourceNote label="How the drafts are written">
        The assistant reads what the cockpit knows about the lead: their
        answers, the calendar, the calls and their summaries, the notes, the
        conversation in HighLevel and any research. It writes WhatsApp only
        while the lead's 24-hour window is open, otherwise email. When a rep
        changes a draft before sending it, the next drafts of that kind are
        shown the change as what good looks like.
      </SourceNote>
    </main>
  );
}

function DraftCard({
  f,
  lead,
  showOwner,
  onDone,
}: {
  f: Followup;
  lead: string | null;
  showOwner: boolean;
  onDone: () => void;
}) {
  const [body, setBody] = useState(f.body);
  const [subject, setSubject] = useState(f.subject ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const seg = SEGMENT[f.segment];

  async function approve(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api<{
        followup: Followup;
        message: { state: string; error: string | null };
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
          `Sent by ${f.channel === "whatsapp" ? "WhatsApp" : "email"}.`,
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
              {f.channel === "whatsapp" ? "WhatsApp" : "Email"}
              {f.expires_at
                ? ` · good until ${day(f.expires_at)} ${clock(f.expires_at)}`
                : ""}
              {showOwner
                ? ` · ${f.owner_email?.split("@")[0] ?? "no rep on the lead"}`
                : ""}
            </span>
          </div>
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
        onChange={e => setBody(e.target.value)}
        rows={Math.min(10, Math.max(3, body.split("\n").length + 1))}
        className={`${field} h-auto py-2 leading-relaxed`}
        dir="auto"
        aria-label="The message"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !body.trim()}
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
                <span className="muted">· {SEGMENT[f.segment].label}</span>
              </p>
              <p className="muted truncate text-xs" dir="auto">
                {f.status === "skipped"
                  ? `Skipped: ${f.skip_reason ?? "no reason"}`
                  : (f.final_body ?? f.body)}
              </p>
              {f.error ? (
                <p className="text-xs">Why it failed: {f.error}</p>
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

function Learning({ rows, manager }: { rows: Followup[]; manager: boolean }) {
  const settings = useSetting<Settings>("followups");
  const s = settings.data;
  const stats = SEGMENTS.map(seg => {
    const of = rows.filter(r => r.segment === seg);
    const sent = of.filter(r => r.status === "sent" && !r.auto);
    const asWritten = sent.filter(r => !r.edited).length;
    return {
      seg,
      written: of.length,
      sent: sent.length,
      asWritten,
      edited: sent.length - asWritten,
      skipped: of.filter(r => r.status === "skipped").length,
      auto: of.filter(r => r.auto).length,
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

  return (
    <div className="space-y-6">
      <SectionCard title="The last 30 days, by kind of message" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="muted text-left text-xs">
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 text-right font-medium">Written</th>
                <th className="px-3 py-2 text-right font-medium">
                  Sent as written
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Edited first
                </th>
                <th className="px-3 py-2 text-right font-medium">Skipped</th>
                <th className="px-4 py-2 text-right font-medium">
                  Sends by itself
                </th>
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {stats.map(r => (
                <tr key={r.seg}>
                  <td className="px-4 py-2">{SEGMENT[r.seg].label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.written}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.asWritten}
                    {r.sent ? (
                      <span className="muted text-xs">
                        {" "}
                        ({Math.round((100 * r.asWritten) / r.sent)}%)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.edited}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.skipped}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {manager && s ? (
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={Boolean(s.autosend?.[r.seg])}
                          disabled={busy}
                          onChange={e =>
                            save({
                              ...s,
                              autosend: {
                                ...s.autosend,
                                [r.seg]: e.target.checked,
                              },
                            })
                          }
                        />
                        {s.autosend?.[r.seg] ? "On" : "Off"}
                      </label>
                    ) : s?.autosend?.[r.seg] ? (
                      "On"
                    ) : (
                      "Off"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted border-t hairline px-4 py-2 text-xs">
          Switch a kind to send by itself once reps send most of its drafts as
          written. Until then every draft waits for a person. A draft that sends
          by itself goes through the same checks as a rep's send.
        </p>
      </SectionCard>
      {manager && s ? <SettingsForm s={s} busy={busy} onSave={save} /> : null}
    </div>
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
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="block space-y-1 text-sm">
            <span className="muted block text-xs">{label}</span>
            <input
              value={String(v[k] ?? (k === "nurture_per_day" ? 20 : ""))}
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
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={buttonPrimary}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
