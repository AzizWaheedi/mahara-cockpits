import { UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  buttonPrimary,
  EmptyState,
  Failed,
  page,
  SectionCard,
  StatusChip,
} from "../components/kit";
import { TeamSwitch } from "../components/TeamControls";
import { type GhlUser, TeamSeat } from "../components/TeamSeat";
import { api } from "../lib/api";
import {
  useMirrorRun,
  useNow,
  usePeople,
  useQuery,
  useReps,
  useSetting,
  useWorkerStatus,
} from "../lib/data";
import { ago } from "../lib/format";
import { portalUrl } from "../lib/portal";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me, Person } from "../lib/types";

/**
 * The sales manager's page: every seat and what it is linked to, each
 * person's pay rule and goals, whether marks go to HighLevel, and whether
 * the copy from B2B and the proposal worker are healthy.
 *
 * Seats are made on the portal's Admin page, never here: this page links
 * and tunes them. Every change goes through the sales-api function, which
 * refuses anyone who is not a manager and writes the audit row.
 */

/** HighLevel's users, read once when the page opens (a manager-only action). */
function useGhlUsers() {
  const [state, setState] = useState<{
    users: GhlUser[] | null;
    error: string | null;
  }>({
    users: null,
    error: null,
  });
  useEffect(() => {
    let alive = true;
    api<{ users?: GhlUser[] }>("ghl.users").then(
      out => {
        if (alive) setState({ users: out.users ?? [], error: null });
      },
      (e: unknown) => {
        if (alive)
          setState({ users: null, error: String((e as Error)?.message ?? e) });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/**
 * Seats by name, the ones the portal took away last. A paused seat keeps
 * its place, so pausing someone does not move the card under the pointer.
 */
function order(p: Person): number {
  return p.via_portal ? 0 : 1;
}

export default function TeamPage({ me }: { me: Me }) {
  const now = useNow(60_000);
  const people = usePeople();
  const reps = useReps();
  const ghl = useGhlUsers();

  const seats = [...(people.data ?? [])].sort(
    (a, b) =>
      order(a) - order(b) ||
      String(a.name ?? a.email).localeCompare(String(b.name ?? b.email)),
  );
  const paused = seats.filter(p => !p.active).length;

  return (
    <main className={page}>
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="muted mt-1 max-w-2xl text-sm">
          Add someone on the{" "}
          <a
            href={`${portalUrl()}/admin`}
            className="underline underline-offset-2"
          >
            portal's Admin page
          </a>{" "}
          with the Sales cockpit ticked and Setter or Closer chosen. Their seat
          appears here straight away.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">Seats</h2>
            {people.data ? (
              <span className="muted text-xs">
                {seats.length} {seats.length === 1 ? "seat" : "seats"}
                {paused ? `, ${paused} paused` : ""}
              </span>
            ) : null}
          </div>
          {people.error ? (
            <Failed
              what="The seats"
              error={people.error}
              retry={people.reload}
            />
          ) : !people.data ? (
            <p className="muted text-sm">Loading the seats…</p>
          ) : !seats.length ? (
            <section className="panel">
              <EmptyState
                icon={UsersRound}
                title="No seats yet"
                text="Give someone the Sales cockpit on the portal's Admin page and choose Setter or Closer. Their seat appears here straight away."
              />
            </section>
          ) : (
            seats.map(p => (
              <TeamSeat
                key={p.email}
                person={p}
                me={me.email}
                users={ghl.users}
                usersError={ghl.error}
                reps={reps.data ?? []}
                onSaved={people.reload}
              />
            ))
          )}
          {reps.error ? (
            <Failed what="B2B's reps" error={reps.error} retry={reps.reload} />
          ) : null}
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-4 lg:space-y-6">
          <CrmWritesCard />
          <HealthCard now={now} />
        </div>
      </div>
    </main>
  );
}

interface CrmWrites {
  dispositions?: boolean;
  backlog_days?: number;
}

/** Whether a mark in the cockpit is written to HighLevel, and how old a call may be. */
function CrmWritesCard() {
  const s = useSetting<CrmWrites>("crm_writes");
  const saved = {
    dispositions: Boolean(s.data?.dispositions),
    backlog_days: Number.isInteger(Number(s.data?.backlog_days))
      ? Number(s.data?.backlog_days)
      : 7,
  };
  const [days, setDays] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typed = days ?? String(saved.backlog_days);
  const n = Number(typed);
  const valid = typed.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 60;
  const changed = days !== null && valid && n !== saved.backlog_days;

  async function save(
    value: { dispositions: boolean; backlog_days: number },
    said: string,
  ) {
    setBusy(true);
    try {
      await api("setting.save", { key: "crm_writes", value });
      toast.success(said);
      setDays(null);
      s.reload();
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Sending marks to HighLevel">
      {s.error ? (
        <Failed what="The setting" error={s.error} retry={s.reload} />
      ) : s.loading && !s.data ? (
        <p className="muted text-sm">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <TeamSwitch
              on={saved.dispositions}
              label="Send marks to HighLevel"
              disabled={busy}
              onChange={on =>
                void save(
                  { dispositions: on, backlog_days: saved.backlog_days },
                  on
                    ? "Saved. Marks on recent calls now go to HighLevel."
                    : "Saved. Marks now stay in the cockpit.",
                )
              }
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {saved.dispositions
                  ? "Marks go to HighLevel"
                  : "Marks stay in the cockpit"}
              </p>
              <p className="muted mt-0.5 text-xs">
                A mark on a recent call runs HighLevel's usual automations (the
                no-show message, for example). An older call's mark changes the
                status in HighLevel without running them, so nobody is messaged
                about a call from weeks ago.
              </p>
            </div>
          </div>

          <form
            className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm"
            onSubmit={e => {
              e.preventDefault();
              if (changed)
                void save(
                  { dispositions: saved.dispositions, backlog_days: n },
                  "Saved.",
                );
            }}
          >
            <label htmlFor="crm-backlog-days">Calls older than</label>
            <input
              id="crm-backlog-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              value={typed}
              onChange={e => setDays(e.target.value)}
              className="h-8 w-16 rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-2 text-sm tabular-nums"
            />
            <span>days go to HighLevel quietly, with no automations.</span>
            {changed ? (
              <button type="submit" disabled={busy} className={buttonPrimary}>
                {busy ? "Saving…" : "Save"}
              </button>
            ) : null}
          </form>
          {!valid ? (
            <p className="text-xs" style={{ color: "var(--destructive)" }}>
              Old calls are counted in whole days, 1 to 60.
            </p>
          ) : null}
          {!s.data ? (
            <p className="muted text-xs">
              Not saved yet, so marks stay in the cockpit.
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function countText(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "n/a";
  // A step that reports more than a count ({n, full, dropped}, or a note
  // that it was skipped) is shown as its count and the one thing worth
  // knowing about it.
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.skipped === "string") return "skipped";
    if (typeof o.n === "number") {
      const extra = [
        o.full ? "full read" : null,
        typeof o.dropped === "number" && o.dropped
          ? `${o.dropped} dropped`
          : null,
      ].filter(Boolean);
      return `${o.n.toLocaleString("en-US")}${extra.length ? ` (${extra.join(", ")})` : ""}`;
    }
  }
  return "n/a";
}

/**
 * How long each desk job may go without a run before it counts as late: the
 * same limits the portal's sales watch alerts on (convex/salesWatch.ts). Jobs
 * not listed write only when they have work, so their age says nothing.
 */
const DESK_LIMITS_MIN: Record<string, number> = {
  requests: 15,
  followups: 75,
  "maqsam-calls": 75,
  "calls-vault": 75,
  recordings: 75,
  reviews: 75,
  notes: 75,
  digest: 26 * 60,
};

/** Tokens the desk's model calls used since Kuwait's midnight. */
function useAiToday() {
  return useQuery<number>(async () => {
    const k = new Date(Date.now() + 3 * 3_600_000);
    const midnight = new Date(
      Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) -
        3 * 3_600_000,
    ).toISOString();
    const { data, error } = await supabase.rpc(
      "cockpit_sales_ai_tokens_since",
      { p_since: midnight },
    );
    return { data: data === null ? null : Number(data), error };
  }, []);
}

/** B2B's own sources in plain words; anything not listed keeps its name. */
const SOURCE_WORDS: Record<string, string> = {
  fathom_calls: "Fathom's video calls",
  maqsam_calls: "Maqsam's phone calls",
  ghl_calls: "HighLevel's calendar",
  leads: "HighLevel's leads",
  meta: "Meta's ads",
  typeform: "The New Client Form",
  typeform_eod: "The end-of-day forms",
  whop_payments: "Whop's payments",
  assets_web: "The asset library (web)",
  assets_wistia: "The asset library (Wistia)",
  assets_social_youtube_mahara: "The asset library (YouTube)",
  assets_social_ig_mahara: "The asset library (Instagram)",
};

interface B2bSources {
  read_at: string;
  sources: {
    source: string;
    last_synced_at: string | null;
    last_sync_status: string | null;
    last_error: string | null;
  }[];
}

/**
 * When B2B last read each of its own sources. The copy from B2B can be fresh
 * while what B2B holds is old: a recording missing because B2B stopped
 * reading Fathom is not a call that never happened.
 */
function SourcesPart({ now }: { now: number }) {
  const s = useSetting<B2bSources>("b2b_sources");
  const list = s.data?.sources ?? [];
  const failing = list.filter(x => x.last_sync_status === "error");
  return (
    <>
      <h3 className="mt-5 text-xs font-semibold">What B2B reads</h3>
      <div className="mt-2">
        {s.error ? (
          <Failed what="B2B's sources" error={s.error} retry={s.reload} />
        ) : !s.data ? (
          <p className="muted text-sm">
            {s.loading
              ? "Reading…"
              : "Not copied yet; the next copy brings it."}
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-xs">
              {[
                ...failing,
                ...list.filter(x => x.last_sync_status !== "error"),
              ].map(x => (
                <li
                  key={x.source}
                  className="flex min-w-0 justify-between gap-2"
                >
                  <span className="truncate">
                    {SOURCE_WORDS[x.source] ?? x.source}
                  </span>
                  <span
                    className="shrink-0 tabular-nums"
                    style={
                      x.last_sync_status === "error"
                        ? { color: "var(--destructive)" }
                        : undefined
                    }
                    title={x.last_error ?? undefined}
                  >
                    {x.last_sync_status === "error"
                      ? `failing, last read ${ago(x.last_synced_at, now)}`
                      : `read ${ago(x.last_synced_at, now)}`}
                  </span>
                </li>
              ))}
            </ul>
            {failing.length ? (
              <p className="muted mt-1 text-xs">
                B2B is Muhammed's: a failing source is fixed there, and what it
                should have brought is missing here until then.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

/** Past calls nobody marked: each counts as shown until it is (the show-rate rule). */
function UnmarkedPart() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const q = useQuery<{ start_at: string }[]>(
    () =>
      supabase
        .from("cockpit_sales_calendar")
        .select("start_at")
        .eq("needs_mark", true)
        .gte("start_at", since)
        .order("start_at", { ascending: true })
        .limit(1000),
    [],
    300_000,
  );
  const n = q.data?.length ?? 0;
  return (
    <>
      <h3 className="mt-5 text-xs font-semibold">Calls waiting on a mark</h3>
      <div className="mt-1 text-xs">
        {q.error ? (
          <Failed what="The unmarked calls" error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <p className="muted">Reading…</p>
        ) : !n ? (
          <p className="muted">Every call of the last 30 days is marked.</p>
        ) : (
          <p>
            {n} past {n === 1 ? "call" : "calls"} of the last 30 days{" "}
            {n === 1 ? "is" : "are"} not marked, the oldest from{" "}
            {ago(q.data[0].start_at)}. Until marked, each counts as shown.{" "}
            <Link to="/calendar" className="underline underline-offset-2">
              Mark them on the Calendar
            </Link>
            .
          </p>
        )}
      </div>
    </>
  );
}

interface DialCheck {
  day: string;
  agent_email: string;
  maqsam_calls: number;
  copied_calls: number;
  checked_at: string;
}

/**
 * The second source for every dial count: per agent, the last seven days'
 * calls in Maqsam against the calls the cockpit holds (written by the sales
 * desk, which reads Maqsam itself). Managers only.
 */
function DialChecksPart() {
  const q = useQuery<DialCheck[]>(
    () =>
      supabase
        .from("cockpit_sales_dial_checks")
        .select("*")
        .order("day", { ascending: false })
        .limit(500),
    [],
    300_000,
  );
  const byAgent = new Map<
    string,
    { maqsam: number; copied: number; at: string }
  >();
  for (const c of q.data ?? []) {
    const cur = byAgent.get(c.agent_email) ?? {
      maqsam: 0,
      copied: 0,
      at: c.checked_at,
    };
    byAgent.set(c.agent_email, {
      maqsam: cur.maqsam + c.maqsam_calls,
      copied: cur.copied + c.copied_calls,
      at: cur.at > c.checked_at ? cur.at : c.checked_at,
    });
  }
  const rows = [...byAgent.entries()].sort((a, b) => b[1].maqsam - a[1].maqsam);
  return (
    <>
      <h3 className="mt-5 text-xs font-semibold">
        Calls in Maqsam against the cockpit, 7 days
      </h3>
      <div className="mt-1 text-xs">
        {q.error ? (
          <Failed what="The call check" error={q.error} retry={q.reload} />
        ) : !q.data ? (
          <p className="muted">Reading…</p>
        ) : !rows.length ? (
          <p className="muted">
            Not checked yet. The sales desk compares them each time it reads
            Maqsam, twice an hour.
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map(([agent, v]) => (
              <li key={agent} className="flex min-w-0 justify-between gap-2">
                <span className="truncate">{agent.split("@")[0]}</span>
                <span
                  className="shrink-0 tabular-nums"
                  style={
                    v.copied < v.maqsam
                      ? { color: "var(--destructive)" }
                      : undefined
                  }
                >
                  {v.copied} of {v.maqsam}
                  {v.copied < v.maqsam ? " (some missing)" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** The last copy from B2B and the desk's own reports. */
function HealthCard({ now }: { now: number }) {
  const mirror = useMirrorRun();
  const workers = useWorkerStatus();
  const ai = useAiToday();
  const run = mirror.data;
  const late = run?.finished_at
    ? now - Date.parse(run.finished_at) > 20 * 60_000
    : false;
  const list = [...(workers.data ?? [])].sort((a, b) =>
    `${a.worker}${a.job}`.localeCompare(`${b.worker}${b.job}`),
  );

  return (
    <SectionCard title="Health">
      <h3 className="text-xs font-semibold">Copy from B2B</h3>
      <div className="mt-2">
        {mirror.error ? (
          <Failed
            what="The last copy"
            error={mirror.error}
            retry={mirror.reload}
          />
        ) : !run ? (
          <p className="muted text-sm">
            {mirror.loading
              ? "Loading…"
              : "No copy has finished yet. It runs every 3 minutes."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip
                tone={run.ok === false ? "critical" : late ? "warning" : "good"}
                label={
                  run.ok === false ? "Had a problem" : late ? "Late" : "Working"
                }
                title="The copy from B2B runs every 3 minutes."
              />
              <span className="muted text-xs">
                finished {ago(run.finished_at, now)}
                {run.mode ? ` · ${run.mode}` : ""}
              </span>
            </div>
            {run.error ? (
              <p className="callout-bad mt-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs [overflow-wrap:anywhere]">
                {run.error}
              </p>
            ) : null}
            {Object.keys(run.counts ?? {}).length ? (
              <dl className="mt-3 grid grid-cols-1 gap-y-1 text-xs">
                {Object.entries(run.counts ?? {}).map(([k, v]) => (
                  <div key={k} className="flex min-w-0 justify-between gap-2">
                    <dt className="muted truncate">{k.replace(/_/g, " ")}</dt>
                    <dd
                      className="tabular-nums shrink-0"
                      style={
                        v === "failed"
                          ? { color: "var(--destructive)" }
                          : undefined
                      }
                    >
                      {countText(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </>
        )}
      </div>

      <SourcesPart now={now} />
      <UnmarkedPart />
      <DialChecksPart />

      <h3 className="mt-5 text-xs font-semibold">The sales desk</h3>
      <p className="muted mt-1 text-xs">
        {ai.error
          ? `Today's AI use could not be read: ${ai.error}.`
          : ai.data === null
            ? "Reading today's AI use…"
            : `AI since midnight: ${Math.round(ai.data / 1000).toLocaleString()} thousand tokens (counted since 26 September, when the meter started). The desk stops calling the model at its daily ceiling, 15 million unless set otherwise on the desk, and starts again at midnight.`}
      </p>
      <div className="mt-2">
        {workers.error ? (
          <Failed
            what="The worker's reports"
            error={workers.error}
            retry={workers.reload}
          />
        ) : !list.length ? (
          workers.loading ? (
            <p className="muted text-sm">Loading…</p>
          ) : (
            <EmptyState compact title="The sales desk has not reported yet." />
          )
        ) : (
          <ul className="divide-y hairline">
            {list.map(w => {
              const limit = DESK_LIMITS_MIN[w.job];
              const late =
                w.worker === "sales-desk" &&
                limit !== undefined &&
                now - Date.parse(w.at) > limit * 60_000;
              return (
                <li key={`${w.worker}:${w.job}`} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {w.job}
                    </span>
                    <StatusChip
                      tone={!w.ok ? "critical" : late ? "warning" : "good"}
                      label={!w.ok ? "Failing" : late ? "Late" : "OK"}
                      title={
                        late
                          ? `It should run at least every ${limit} minutes; the portal alerts Aziz when it stays late.`
                          : undefined
                      }
                    />
                  </div>
                  {w.detail ? (
                    <p className="muted mt-0.5 text-xs [overflow-wrap:anywhere]">
                      {w.detail}
                    </p>
                  ) : null}
                  <p className="muted mt-0.5 text-xs">
                    {w.worker} · {ago(w.at, now)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
