import { UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import {
  buttonPrimary,
  EmptyState,
  Failed,
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
  useReps,
  useSetting,
  useWorkerStatus,
} from "../lib/data";
import { ago } from "../lib/format";
import { portalUrl } from "../lib/portal";
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
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
      <header className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Seats</h2>
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

        <div className="min-w-0 space-y-5 lg:col-span-4">
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
                no-show message, for example).
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
            <span>days stay in the cockpit only.</span>
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
  if (v === null || v === undefined) return "--";
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
  return "--";
}

/** The last copy from B2B and the worker's own reports. */
function HealthCard({ now }: { now: number }) {
  const mirror = useMirrorRun();
  const workers = useWorkerStatus();
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

      <h3 className="mt-5 text-xs font-semibold">Proposal worker</h3>
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
            <EmptyState
              compact
              title="The proposal worker has not reported yet."
            />
          )
        ) : (
          <ul className="divide-y hairline">
            {list.map(w => (
              <li key={`${w.worker}:${w.job}`} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {w.job}
                  </span>
                  <StatusChip
                    tone={w.ok ? "good" : "critical"}
                    label={w.ok ? "OK" : "Failing"}
                  />
                </div>
                {w.detail ? (
                  <p className="muted mt-0.5 text-xs [overflow-wrap:anywhere]">
                    {w.detail}
                  </p>
                ) : null}
                <p className="muted mt-0.5 text-[11px]">
                  {w.worker} · {ago(w.at, now)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
