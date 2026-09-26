import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
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
} from "../components/kit";
import { api } from "../lib/api";
import { useQuery } from "../lib/data";
import { ago, clock } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * The end of day, filed here instead of on the Typeform (Aziz, 2026-09-24:
 * "The end-of-day should be integrated into the thing, the same way the
 * media buyer and the client success have that thing"). Same questions,
 * same sheet tab, same Slack channel; the cockpit shows what it counted
 * beside each question, and starts a closer's calendar and deal numbers
 * filled in, because those mean exactly what the question means.
 */

type Role = "setter" | "closer";
type Kind = "count" | "money" | "minutes" | "text";

interface Field {
  key: string;
  label: string;
  column: string;
  kind: Kind;
  required?: boolean;
}

interface Outbox {
  status: "queued" | "sent" | "failed";
  slack_ts: string | null;
  sent_at: string | null;
  sheet_at: string | null;
  error: string | null;
  sheet_error: string | null;
  attempts: number;
}

interface Eod {
  id: string;
  email: string;
  name: string;
  role: Role;
  day: string;
  answers: Record<string, string | number | null>;
  computed: Record<string, number | null>;
  submitted_at: string | null;
}

interface Prefill {
  day: string;
  today: string;
  role: Role;
  roles: Role[];
  name: string;
  has_slack_id: boolean;
  has_maqsam: boolean;
  has_ghl: boolean;
  fields: Field[];
  computed: Record<string, number | null>;
  notes: Record<string, string>;
  prefill: string[];
  eod: Eod | null;
  outbox: Outbox | null;
}

function dayWords(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function lastDays(today: string, n = 7): string[] {
  const out: string[] = [];
  let t = Date.parse(`${today}T00:00:00Z`);
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 5) out.push(d.toISOString().slice(0, 10));
    t -= 86_400_000;
  }
  return out;
}

export default function EodPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Prefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const role = params.get("role") ?? undefined;
  const day = params.get("day") ?? undefined;

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Prefill>("eod.prefill", { role, day }));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [role, day]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // While it is on its way out, look at where it got to every 20 seconds.
  const waiting = data?.outbox?.status === "queued";
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(t);
  }, [waiting, load]);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <main className={page}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">End of day</h1>
          <p className="muted mt-1 text-sm">
            {data
              ? `${dayWords(data.day)} · goes to #eods-salesreps and the EOD Reports sheet`
              : "Counting your day…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && data.roles.length > 1 ? (
            <Segmented
              label="Which end of day"
              value={data.role}
              options={data.roles.map(r => [
                r,
                r === "setter" ? "Setter" : "Closer",
              ])}
              onChange={r => set("role", r)}
            />
          ) : null}
          {data ? (
            <select
              aria-label="Which day"
              value={data.day}
              onChange={e =>
                set(
                  "day",
                  e.target.value === data.today ? null : e.target.value,
                )
              }
              className={select}
            >
              {lastDays(data.today).map(d => (
                <option key={d} value={d}>
                  {d === data.today ? "Today" : dayWords(d)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {error ? (
        <Failed what="Your end of day" error={error} retry={load} />
      ) : !data ? (
        <p className="muted text-sm">Counting your day…</p>
      ) : data.eod?.submitted_at ? (
        <Filed data={data} onRetry={load} />
      ) : (
        <EodForm key={`${data.role}:${data.day}`} data={data} onSent={load} />
      )}

      {me.manager && data ? <TeamToday day={data.day} /> : null}

      <SourceNote label="Where your end of day goes">
        The same questions as the Typeform EODs, filed to the "Setter" or "Sales
        Rep" tab of the EOD Reports sheet and posted to #eods-salesreps, where
        EOD Radar reads it. Beside each number is what the cockpit counted and
        where from; a setter's call counts come from Maqsam and include intro
        calls, so they are shown, not filled in. An end of day filed before
        04:00 is for the day before, and Friday is not a working day.
      </SourceNote>
    </main>
  );
}

function EodForm({ data, onSent }: { data: Prefill; onSent: () => void }) {
  const draftKey = `sales-eod:${data.role}:${data.day}`;
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) return JSON.parse(saved) as Record<string, string>;
    } catch {
      // no storage
    }
    const start: Record<string, string> = {};
    for (const k of data.prefill) {
      const v = data.computed[k];
      if (v !== null && v !== undefined) start[k] = String(v);
    }
    return start;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(answers));
    } catch {
      // the draft just will not survive a reload
    }
  }, [draftKey, answers]);
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("eod.submit", {
        role: data.role,
        day: data.day,
        answers,
      });
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // nothing to clear
      }
      toast.success(
        "Sent. It posts to Slack and the sheet within five minutes.",
      );
      onSent();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  // Talk time is typed as a range ("13-25 min") but is one of the day's numbers.
  const numbers = data.fields.filter(
    f => f.kind !== "text" || f.key === "talk_time",
  );
  const words = data.fields.filter(
    f => f.kind === "text" && f.key !== "talk_time",
  );
  return (
    <form onSubmit={send} className="space-y-6">
      {!data.has_slack_id ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          Your seat has no Slack id, so EOD Radar cannot credit this to you by
          name. Ask Aziz to add it on the Team page; it still goes to the
          channel and the sheet.
        </p>
      ) : null}
      <SectionCard title="Today's numbers">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {numbers.map(f => (
            <NumberQuestion
              key={f.key}
              f={f}
              value={answers[f.key] ?? ""}
              counted={
                f.key === "talk_time" ? null : (data.computed[f.key] ?? null)
              }
              note={data.notes[f.key]}
              onChange={v => setAnswers(a => ({ ...a, [f.key]: v }))}
            />
          ))}
        </div>
      </SectionCard>
      <SectionCard title="In words">
        <div className="space-y-4">
          {words.map(f => (
            <label key={f.key} className="block space-y-1">
              <span className="text-sm font-medium">
                {f.label}
                {f.required ? "" : " (if any)"}
              </span>
              <textarea
                value={answers[f.key] ?? ""}
                onChange={e =>
                  setAnswers(a => ({ ...a, [f.key]: e.target.value }))
                }
                rows={3}
                dir="auto"
                required={f.required}
                className={`${field} h-auto py-2 leading-relaxed`}
              />
            </label>
          ))}
        </div>
      </SectionCard>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={buttonPrimary}>
          <ClipboardCheck className="size-4" aria-hidden />
          {busy ? "Sending…" : "Send my end of day"}
        </button>
        <p className="muted text-xs">
          Once sent it cannot be changed here; a wrong number is for your
          manager to correct.
        </p>
      </div>
    </form>
  );
}

function NumberQuestion({
  f,
  value,
  counted,
  note,
  onChange,
}: {
  f: Field;
  value: string;
  counted: number | null;
  note?: string;
  onChange: (v: string) => void;
}) {
  const shown =
    counted === null
      ? null
      : f.kind === "money"
        ? `$${counted.toLocaleString("en-US")}`
        : String(counted);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">
        {f.label}
        {f.required ? "" : " (if any)"}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        inputMode={f.kind === "text" ? "text" : "decimal"}
        placeholder={f.key === "talk_time" ? "e.g. 13-25 min" : ""}
        required={f.required}
        dir="auto"
        className={field}
      />
      {note ? (
        <span className="muted flex flex-wrap items-center gap-x-2 text-xs leading-snug">
          {shown !== null ? (
            <strong className="text-[color:var(--foreground)]">
              Cockpit: {shown}
            </strong>
          ) : null}
          <span>{note}</span>
          {shown !== null && value !== String(counted) ? (
            <button
              type="button"
              onClick={() => onChange(String(counted))}
              className="underline underline-offset-2"
            >
              Use {shown}
            </button>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

function Filed({ data, onRetry }: { data: Prefill; onRetry: () => void }) {
  const e = data.eod as Eod;
  const o = data.outbox;
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await api("eod.retry", { id: e.id });
      toast.success("Queued again. It posts within five minutes.");
      onRetry();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }
  const slackRefused = o && !o.slack_ts && o.error;
  return (
    <SectionCard title="Filed">
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <CheckCircle2 className="size-4" aria-hidden />
          Sent {ago(e.submitted_at)}, at {clock(e.submitted_at)}.
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusChip
            tone={o?.slack_ts ? "good" : slackRefused ? "critical" : "neutral"}
            label={
              o?.slack_ts
                ? "Posted to #eods-salesreps"
                : slackRefused
                  ? "Slack refused it"
                  : "Waiting to post to Slack"
            }
          />
          <StatusChip
            tone={
              o?.sheet_at ? "good" : o?.sheet_error ? "critical" : "neutral"
            }
            label={
              o?.sheet_at
                ? "In the EOD Reports sheet"
                : o?.sheet_error
                  ? "The sheet refused it"
                  : "Waiting to go in the sheet"
            }
          />
        </div>
        {slackRefused ? (
          <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2">
            Slack said: {o?.error}.{" "}
            {/not_in_channel|channel_not_found/.test(String(o?.error))
              ? "The cockpit's Slack bot is not in #eods-salesreps. Ask Aziz to add the bot to the channel, then post again."
              : "Post again once that is sorted."}
          </p>
        ) : null}
        {o?.sheet_error ? (
          <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2">
            The sheet said: {o.sheet_error}
          </p>
        ) : null}
        {o && o.status !== "sent" && (o.status === "failed" || slackRefused) ? (
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className={button}
          >
            {busy ? "Queuing…" : "Post again"}
          </button>
        ) : null}
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {data.fields.map(f => {
            const v = e.answers[f.key];
            // A number reads down its column; words read as a sentence,
            // under their question, across the card.
            const words = f.kind === "text" && f.key !== "talk_time";
            return (
              <div
                key={f.key}
                className={`border-b hairline py-1 ${
                  words ? "sm:col-span-2" : "flex justify-between gap-3"
                }`}
              >
                <dt className="muted">{f.label}</dt>
                <dd
                  className={
                    v === null || v === undefined
                      ? "muted"
                      : words
                        ? "mt-0.5 whitespace-pre-wrap"
                        : "text-right font-mono tabular-nums"
                  }
                  dir="auto"
                >
                  {v === null || v === undefined ? "n/a" : String(v)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </SectionCard>
  );
}

function TeamToday({ day }: { day: string }) {
  const eods = useQuery<Eod[]>(
    () =>
      supabase
        .from("cockpit_sales_eods")
        .select("id,email,name,role,day,submitted_at,answers,computed")
        .eq("day", day)
        .order("submitted_at", { ascending: true }),
    [day],
    60_000,
  );
  const rows = eods.data ?? [];
  return (
    <SectionCard title={`Who has filed for ${dayWords(day)}`}>
      {eods.error ? (
        <Failed what="The team's EODs" error={eods.error} retry={eods.reload} />
      ) : !rows.length ? (
        <EmptyState
          compact
          icon={ClipboardCheck}
          title="Nobody has filed in the cockpit yet"
          text="Reps who still use the Typeform show in the sheet, not here."
        />
      ) : (
        <ul className="divide-y hairline text-sm">
          {rows.map(r => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span>
                {r.name}
                <span className="muted">
                  {" "}
                  · {r.role === "setter" ? "Setter" : "Closer"}
                </span>
              </span>
              <span className="muted text-xs">
                {r.submitted_at
                  ? `filed at ${clock(r.submitted_at)}`
                  : "started"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
