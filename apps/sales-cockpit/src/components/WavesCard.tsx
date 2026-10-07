import { Loader2, Waves as WavesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { readAll, useNow, useQuery, useWorkerStatus } from "../lib/data";
import { errorText, once, reasonWords } from "../lib/rooms";
import { supabase } from "../lib/supabase";
import {
  approvedLine,
  BATCH_MAX,
  type BatchDraft,
  batchState,
  batchWrittenToday,
  countMembers,
  countsFor,
  type DeskReport,
  effectLine,
  isOpenWave,
  type MemberRow,
  nextBatchAt,
  POOL_WORDS,
  POOLS,
  type Pool,
  readWave,
  startedLine,
  toApprove,
  type Wave,
  type WaveCounts,
  waveLine,
  waveSettings,
} from "../lib/waves";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  SectionCard,
  StatusChip,
  select,
} from "./kit";

/**
 * Backlog waves on the Follow-ups page (P3 phase 1): each running wave in
 * one line with its members drawn as one bar, the day's batch with
 * "Approve all", and Start, Pause, Resume and Stop for a manager. Behind
 * the follow-up agent's switch: while it is off, nothing here can start or
 * send, and the card says so.
 *
 * The bar is the card's one picture: who has had their opener, today's
 * batch, who waits, and the held-back tenth, hatched because nobody writes
 * to them; they are how the effect is measured.
 */

/**
 * The line after Pause or Stop, with sales-api's own word when an opener
 * was already on its way to HighLevel (going_now): it may still go, and the
 * manager is told so (stress2 round 6, waves-pause-stop-going-now-note-dropped).
 */
type GoingNow = { going_now?: unknown; note?: unknown };

function withGoingNow(line: string, goingNow: unknown, note: unknown): string {
  if (!(Number(goingNow ?? 0) > 0)) return line;
  const said =
    typeof note === "string" && note.trim()
      ? note.trim()
      : "One opener may still go: it was already on its way.";
  return `${line} ${said}`;
}

export interface OpenerDraft {
  id: string;
  contact_id: string;
  template_key: string | null;
  created_at: string;
  segment?: string | null;
  status?: string | null;
  context?: unknown;
  /**
   * The opener as it will go (the name filled in): shown under its row, so
   * Approve all never sends words nobody has read (final review: a lead
   * whose first name is a company name).
   */
  body?: string | null;
}

const TOUCH = "pointer-coarse:min-h-11";

const LANGUAGE: Record<string, string> = {
  opener_ar: "Arabic",
  opener_en: "English",
};

export function WavesCard({
  manager,
  enabled,
  settings,
  openers,
  written,
  nameOf,
  onChanged,
}: {
  manager: boolean;
  /** followups.enabled; null while it is read. */
  enabled: boolean | null;
  /** The followups setting, for waves.per_day, batch_gap_s and the hours. */
  settings: unknown;
  /** Today's open reactivate drafts this seat can see. */
  openers: readonly OpenerDraft[];
  /**
   * Every backlog opener this seat can see, whatever its status: today's
   * batch counts as written once one was drafted today, even after all of
   * it went (stress2, round 1). Left out: the open ones.
   */
  written?: readonly OpenerDraft[];
  nameOf: Map<string, string | null>;
  onChanged: () => void;
}) {
  const now = useNow(60_000);
  const ws = waveSettings(settings);
  const waves = useQuery<Wave[]>(
    async () => {
      const { data, error } = await supabase
        .from("cockpit_sales_followup_waves")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12);
      return {
        data: (data ?? []).map(readWave).filter((w): w is Wave => w !== null),
        error,
      };
    },
    [],
    60_000,
  );
  const shown = waves.data ?? [];
  const ids = shown.map(w => w.id).join(",");
  const members = useQuery<MemberRow[]>(
    () =>
      ids
        ? readAll<MemberRow>((from, to) =>
            // Ordered by a unique key, as every paged read is: without it a
            // member the desk moves between two pages is read twice or never
            // (stress2, round 1).
            supabase
              .from("cockpit_sales_followup_wave_members")
              .select("wave_id,contact_id,arm,state,due_at,sent_at")
              .in("wave_id", ids.split(","))
              .order("wave_id")
              .order("contact_id")
              .range(from, to),
          )
        : Promise.resolve({ data: [], error: null }),
    [ids],
    120_000,
  );
  const openerIds = openers.map(o => o.id).join(",");
  const meta = useQuery<
    {
      followup_id: string;
      wave_id: string | null;
      send_after: string | null;
      held_by: string | null;
      held_at?: string | null;
      hold_reason?: string | null;
    }[]
  >(
    () =>
      openerIds
        ? supabase
            .from("cockpit_sales_followup_meta")
            .select("*")
            .in("followup_id", openerIds.split(","))
        : Promise.resolve({ data: [], error: null }),
    [openerIds],
    60_000,
  );
  const counts = useMemo(
    () => countMembers(members.data ?? []),
    [members.data],
  );
  const waveStates = useMemo(
    () => new Map((waves.data ?? []).map(w => [w.id, w.state])),
    [waves.data],
  );
  const batch: BatchDraft[] = useMemo(() => {
    const byId = new Map((meta.data ?? []).map(m => [m.followup_id, m]));
    return [...openers]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map(o => {
        const m = byId.get(o.id);
        return {
          id: o.id,
          contact_id: o.contact_id,
          wave_id: m?.wave_id ?? null,
          send_after: m?.send_after ?? null,
          held_by: m?.held_by ?? null,
          held_at: m?.held_at ?? null,
          hold_reason: m?.hold_reason ?? null,
          wave_state: m?.wave_id ? (waveStates.get(m.wave_id) ?? null) : null,
        };
      });
  }, [openers, meta.data, waveStates]);

  const open = shown.filter(isOpenWave);
  const ended = shown.filter(w => !isOpenWave(w) && w.state !== "draft");
  const writtenToday = batchWrittenToday(written ?? openers, now);
  const next = {
    at: nextBatchAt(now, {
      firstHour: ws.firstHour,
      quietFrom: ws.quietFrom,
      daysOff: ws.daysOff,
      writtenToday,
    }),
    now,
  };
  const off = enabled === false;
  // The waves job's own sentence (sales-desk/waves): what holds the batch.
  const status = useWorkerStatus();
  const wavesRow = status.data?.find(
    x => x.worker === "sales-desk" && x.job === "waves",
  );
  // Missing is never "fine": no row, or a read that failed, is said.
  const desk: DeskReport = wavesRow
    ? {
        ok: wavesRow.ok !== false,
        detail: wavesRow.detail ?? null,
        at: wavesRow.at ?? null,
      }
    : status.error
      ? { unread: true }
      : status.data
        ? { missing: true }
        : null;

  const [busy, setBusy] = useState<string | null>(null);
  // What the last press did, said beside the part of the card it was in.
  const [said, setSaid] = useState<{
    tone: "good" | "bad";
    text: string;
    where: "batch" | "waves";
  } | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);

  async function run(key: string, work: () => Promise<string | null>) {
    if (busy) return;
    const where =
      key === "approve" || key.startsWith("hold:") ? "batch" : "waves";
    setBusy(key);
    setSaid(null);
    try {
      const done = await work();
      if (done) setSaid({ tone: "good", text: done, where });
      waves.reload();
      members.reload();
      meta.reload();
      onChanged();
    } catch (e) {
      setSaid({ tone: "bad", text: errorText(e), where });
    } finally {
      setBusy(null);
    }
  }

  const wave = (op: string, body: Record<string, unknown>, key: string) =>
    once(`followup.wave:${op}:${key}`, request_id =>
      api("followup.wave", { request_id, op, ...body }),
    );

  const approve = toApprove(batch, now);

  return (
    <SectionCard title="Backlog waves">
      {off ? (
        <p className="callout-warn mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The follow-up agent's own sends are switched off, so no wave drafts or
          sends.
          {manager
            ? " Switch them on under How it works first."
            : " A manager switches them on under How it works."}
        </p>
      ) : null}

      {waves.error ? (
        <Failed what="The waves" error={waves.error} retry={waves.reload} />
      ) : !waves.data ? (
        <p className="muted text-sm">Reading the waves…</p>
      ) : !open.length ? (
        <EmptyState
          compact
          icon={WavesIcon}
          title="No wave is running"
          text={
            manager
              ? "Start one below. Each wave messages one pool of old leads, 40 a day, newest first, and holds a tenth back to measure the effect."
              : "A manager starts a wave. Each one messages one pool of old leads, 40 a day, and holds a tenth back to measure the effect."
          }
        />
      ) : (
        <ul className="space-y-4">
          {open.map(w => {
            const c = countsFor(counts, w.id);
            return (
              <li key={w.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {POOL_WORDS[w.pool].label}
                  </span>
                  <StatusChip
                    tone={w.state === "running" ? "good" : "warning"}
                    label={w.state === "running" ? "Running" : "Paused"}
                  />
                </div>
                {members.error ? (
                  <Failed
                    what="The wave's leads"
                    error={members.error}
                    retry={members.reload}
                  />
                ) : (
                  <>
                    <p className="text-sm">
                      {waveLine(
                        w,
                        c,
                        w.state === "running" ? next : null,
                        desk,
                      )}
                    </p>
                    {c.total ? <WaveBar c={c} /> : null}
                    {c.total ? (
                      <p className="muted text-xs">{effectLine(c)}</p>
                    ) : null}
                  </>
                )}
                {manager ? (
                  stopping === w.id ? (
                    <div className="callout-warn rounded-[var(--radius-md)] border px-3 py-2.5">
                      <p className="text-sm" role="alert">
                        Stop this wave? Its openers not yet sent are taken back,
                        and nothing more goes. The held-back leads are still
                        measured.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`stop:${w.id}`, async () => {
                              const out = (await wave(
                                "stop",
                                { wave_id: w.id },
                                w.id,
                              )) as GoingNow;
                              setStopping(null);
                              return withGoingNow(
                                "Stopped. The desk takes back its openers within 5 minutes.",
                                out.going_now,
                                out.note,
                              );
                            })
                          }
                          className={`${button} h-9 ${TOUCH}`}
                        >
                          {busy === `stop:${w.id}` ? (
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                          ) : null}
                          Yes, stop it
                        </button>
                        <button
                          type="button"
                          onClick={() => setStopping(null)}
                          disabled={busy !== null}
                          className={`${buttonPrimary} h-9 ${TOUCH}`}
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {w.state === "running" ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`pause:${w.id}`, async () => {
                              const out = (await wave(
                                "pause",
                                { wave_id: w.id },
                                w.id,
                              )) as GoingNow;
                              return withGoingNow(
                                "Paused. No new batch is written until you resume it.",
                                out.going_now,
                                out.note,
                              );
                            })
                          }
                          className={`${button} ${TOUCH}`}
                        >
                          {busy === `pause:${w.id}` ? "Pausing…" : "Pause"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== null || off}
                          onClick={() =>
                            void run(`resume:${w.id}`, async () => {
                              await wave("resume", { wave_id: w.id }, w.id);
                              return "Resumed.";
                            })
                          }
                          className={`${button} ${TOUCH}`}
                        >
                          {busy === `resume:${w.id}` ? "Resuming…" : "Resume"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => setStopping(w.id)}
                        className={`${button} ${TOUCH}`}
                      >
                        Stop
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {openers.length || meta.error ? (
        <div className="mt-5 border-t hairline pt-4">
          <div className="flex flex-col items-start gap-1">
            <h3 className="text-sm font-semibold">Today's batch</h3>
            <span className="muted text-xs">
              The CEO's opener, no AI text. One goes every {Math.round(ws.gapS)}{" "}
              seconds once approved, between 09:00 and 18:00 on the lead's
              clock.
            </span>
          </div>
          {meta.error ? (
            <Failed
              what="Which openers are approved"
              error={meta.error}
              retry={meta.reload}
            />
          ) : !meta.data ? (
            <p className="muted mt-2 text-sm">Reading the batch…</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {approve.length ? (
                  <button
                    type="button"
                    disabled={busy !== null || off}
                    onClick={() =>
                      void run("approve", async () => {
                        const out = await once(
                          `followup.batch:${approve.join(",")}`,
                          request_id =>
                            api<{
                              count?: number;
                              first_at?: string;
                              last_at?: string;
                              opens_at?: string;
                              in_hours?: boolean;
                              taken_back?: number;
                              waiting_resume?: number;
                            }>("followup.batch", { request_id, ids: approve }),
                        );
                        return approvedLine(out, ws.gapS, {
                          from: ws.firstHour,
                          to: ws.lastHour,
                          daysOff: ws.daysOff,
                        });
                      })
                    }
                    className={`${buttonPrimary} ${TOUCH}`}
                  >
                    {busy === "approve" ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : null}
                    Approve all {approve.length}
                  </button>
                ) : (
                  <span className="muted text-sm">
                    Every opener in the batch is decided.
                  </span>
                )}
                {batch.length > BATCH_MAX ? (
                  <span className="muted text-xs">
                    {BATCH_MAX} at a time; approve again for the rest.
                  </span>
                ) : null}
              </div>
              {said?.where === "batch" ? <Said said={said} /> : null}
              <ul className="mt-3 divide-y hairline">
                {batch.map(d => {
                  const st = batchState(d, now);
                  const o = openers.find(x => x.id === d.id);
                  return (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                    >
                      <Link
                        to={`/lead/${d.contact_id}`}
                        // An Arabic name keeps its own direction but lines up
                        // with the Latin ones, on the left.
                        className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                        dir="auto"
                      >
                        {nameOf.get(d.contact_id) ?? "A lead"}
                      </Link>
                      <span className="muted text-xs">
                        {LANGUAGE[String(o?.template_key)] ?? "Opener"}
                      </span>
                      <StatusChip
                        tone={
                          st === "approved" || st === "sending"
                            ? "good"
                            : st === "waits_resume"
                              ? "warning"
                              : st === "set_aside"
                                ? "critical"
                                : st === "held" || st === "stalled"
                                  ? "warning"
                                  : "neutral"
                        }
                        label={
                          st === "approved"
                            ? "Approved"
                            : st === "waits_resume"
                              ? "Waits for resume"
                              : st === "sending"
                                ? "Sending"
                                : st === "stalled"
                                  ? "Stopped mid-send"
                                  : st === "set_aside"
                                    ? "Set aside"
                                    : st === "held"
                                      ? "Held"
                                      : st === "taken_back"
                                        ? "Taken back"
                                        : "Waiting"
                        }
                      />
                      {st === "held" || st === "set_aside" ? (
                        <button
                          type="button"
                          disabled={busy !== null || off}
                          onClick={() =>
                            void run(`hold:${d.id}`, async () => {
                              await api("followup.hold", {
                                id: d.id,
                                on: false,
                              });
                              return "Released. It goes with the next approval.";
                            })
                          }
                          className={`${button} h-7 ${TOUCH}`}
                        >
                          Release
                        </button>
                      ) : st === "undecided" ||
                        st === "approved" ||
                        st === "waits_resume" ||
                        st === "stalled" ? (
                        // An approved opener waiting for the lead's hours can be
                        // held too (fix round 4): the hold takes its approval back.
                        // So can one waiting for a paused wave's resume, or one
                        // whose send stopped half way (stress2 round 6).
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`hold:${d.id}`, async () => {
                              await api("followup.hold", {
                                id: d.id,
                                on: true,
                              });
                              return st === "undecided"
                                ? "Held. It stays out of the batch until you release it."
                                : "Held. It will not go; release it and approve it again to send.";
                            })
                          }
                          className={`${button} h-7 ${TOUCH}`}
                        >
                          Hold
                        </button>
                      ) : null}
                      {o?.body ? (
                        <p
                          className="muted w-full whitespace-pre-line text-xs [overflow-wrap:anywhere]"
                          dir="auto"
                        >
                          {o.body}
                        </p>
                      ) : null}
                      {st === "stalled" ? (
                        <p className="muted w-full text-xs">
                          Its send stopped half way. Approve all sends it again.
                        </p>
                      ) : null}
                      {st === "taken_back" ? (
                        <p className="muted w-full text-xs">
                          Its wave was stopped, so it does not go. The desk
                          takes it back within 5 minutes.
                        </p>
                      ) : null}
                      {st === "set_aside" && d.hold_reason ? (
                        <p className="muted w-full text-xs [overflow-wrap:anywhere]">
                          The desk set it aside: {reasonWords(d.hold_reason)}.
                          Release it, then approve it again to send.
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {manager ? (
        <StartWave
          busy={busy !== null}
          off={off}
          taken={new Set(open.map(w => w.pool))}
          perDay={ws.perDay}
          onStart={(pool, perDay) =>
            void run(`start:${pool}`, async () => {
              await wave("start", { pool, per_day: perDay }, pool);
              return startedLine(POOL_WORDS[pool].noun, desk, Date.now());
            })
          }
        />
      ) : null}

      {said?.where === "waves" ? <Said said={said} /> : null}

      {ended.length ? (
        <details className="mt-4 border-t hairline pt-3">
          <summary className="muted cursor-pointer text-xs">
            Ended waves ({ended.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {ended.map(w => {
              const c = countsFor(counts, w.id);
              return (
                <li key={w.id} className="text-xs">
                  <p>{waveLine(w, c, null)}</p>
                  {c.total ? (
                    <p className="muted mt-0.5">{effectLine(c)}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  );
}

function Said({ said }: { said: { tone: "good" | "bad"; text: string } }) {
  return (
    <p
      role={said.tone === "bad" ? "alert" : "status"}
      className={`${said.tone === "bad" ? "callout-bad" : "callout-good"} mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]`}
    >
      {said.text}
    </p>
  );
}

function StartWave({
  busy,
  off,
  taken,
  perDay,
  onStart,
}: {
  busy: boolean;
  off: boolean;
  taken: ReadonlySet<Pool>;
  perDay: number;
  onStart: (pool: Pool, perDay: number) => void;
}) {
  const free = POOLS.filter(p => !taken.has(p));
  const [pool, setPool] = useState<Pool | "">("");
  const chosen = pool && free.includes(pool) ? pool : (free[0] ?? "");
  if (!free.length) return null;
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (chosen) onStart(chosen, perDay);
      }}
      className="mt-5 flex flex-wrap items-end gap-2 border-t hairline pt-4"
    >
      <label className="block space-y-1 text-sm">
        <span className="muted block text-xs">Pool</span>
        <select
          value={chosen}
          onChange={e => setPool(e.target.value as Pool)}
          className={select}
        >
          {free.map(p => (
            <option key={p} value={p}>
              {POOL_WORDS[p].label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy || off || !chosen}
        className={`${button} ${TOUCH}`}
      >
        Start a wave
      </button>
      <p className="muted w-full text-xs">
        {perDay} openers a day across the running waves, newest leads first,
        served in this order: no-shows and cancellations, good intros, demos not
        closed, never booked. A tenth of the pool is held back and never
        messaged.
      </p>
    </form>
  );
}

/**
 * The wave as one bar: opener sent, in today's batch, still waiting, and
 * held back (hatched: never messaged, only measured). Leads who left the
 * wave are the faint end.
 */
export function WaveBar({ c }: { c: WaveCounts }) {
  const parts = [
    { n: c.messaged, label: "sent", style: { background: "var(--won)" } },
    {
      n: c.drafted,
      label: "in today's batch",
      style: { background: "var(--now)" },
    },
    {
      n: c.waiting,
      label: "waiting",
      style: {
        background:
          "color-mix(in oklch, var(--muted-foreground) 30%, transparent)",
      },
    },
    {
      n: c.holdout,
      label: "held back",
      style: {
        background:
          "repeating-linear-gradient(135deg, color-mix(in oklch, var(--muted-foreground) 55%, transparent) 0 3px, transparent 3px 6px)",
      },
    },
    {
      n: c.excluded,
      label: "left the wave",
      style: {
        background:
          "color-mix(in oklch, var(--muted-foreground) 12%, transparent)",
      },
    },
  ];
  const total = parts.reduce((a, p) => a + p.n, 0) || 1;
  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={parts.map(p => `${p.n} ${p.label}`).join(", ")}
      >
        {parts.map(p =>
          p.n ? (
            <span
              key={p.label}
              style={{ ...p.style, width: `${(100 * p.n) / total}%` }}
            />
          ) : null,
        )}
      </div>
      <p className="muted mt-1 flex flex-wrap gap-x-3 text-xs">
        {parts.map(p =>
          p.n ? (
            <span key={p.label} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block size-2 rounded-sm"
                style={p.style}
              />
              <span className="font-mono">{p.n.toLocaleString("en-US")}</span>{" "}
              {p.label}
            </span>
          ) : null,
        )}
      </p>
    </div>
  );
}
