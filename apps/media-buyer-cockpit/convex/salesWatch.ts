import { internalAction } from "./_generated/server";

/**
 * The sales cockpit's watch (Aziz, 2026-09-26: "perfect and bullet proof").
 *
 * The sales cockpit runs outside Convex: its copy of B2B is the Supabase Edge
 * Function sales-mirror (pg_cron, every three minutes) and its worker is the
 * sales desk on the VPS (cron). On 2026-09-26 the VPS stopped answering for
 * eighteen minutes and nothing said so. Every fifteen minutes this reads their
 * last runs from Creative Triage and fails, naming what is late or failing;
 * health.runJob turns three failures in a row into a fix job for Hermes and
 * one Slack line to Aziz, and the first good run after that into an all clear.
 *
 * It reads about fifteen small rows a run. Keys: SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY, already set on this deployment for the Ideation
 * board.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * How old each desk job's last run may be, in minutes, before it counts as
 * stopped. Each of these writes its line on every run, work or not; a job
 * that writes only when it has work (research) cannot be watched by age.
 */
export const DESK_LIMITS: Record<string, number> = {
  requests: 15, // every two minutes: the desk's heartbeat
  followups: 75,
  "maqsam-calls": 75,
  "calls-vault": 75,
  recordings: 75,
  reviews: 75,
  notes: 75,
  digest: 26 * 60,
};
export const MIRROR_LIMIT_MIN = 15;

export interface DeskRun {
  job: string;
  ok: boolean;
  at: string;
  detail: string | null;
}

export interface MirrorRun {
  started_at: string;
  ok: boolean | null;
  error: string | null;
}

/** What is late or failing, in plain words; empty when all is well. */
export function salesProblems(
  desk: DeskRun[],
  mirror: MirrorRun[],
  now: number,
): string[] {
  const out: string[] = [];
  for (const [job, limit] of Object.entries(DESK_LIMITS)) {
    const r = desk.find(x => x.job === job);
    if (!r) {
      out.push(`sales desk "${job}" has never reported`);
      continue;
    }
    const age = (now - Date.parse(r.at)) / 60_000;
    if (!(age <= limit))
      out.push(
        `sales desk "${job}" last ran ${Math.round(age)} min ago${job === "requests" ? " (the VPS or its cron is down)" : ""}`,
      );
    else if (!r.ok)
      out.push(
        `sales desk "${job}" failed: ${String(r.detail ?? "no detail").slice(0, 160)}`,
      );
  }
  const last = mirror[0];
  if (!last) out.push("the sales mirror has never run");
  else {
    const age = (now - Date.parse(last.started_at)) / 60_000;
    if (!(age <= MIRROR_LIMIT_MIN))
      out.push(
        `the sales mirror last ran ${Math.round(age)} min ago (pg_cron job mahara-sales-mirror)`,
      );
    if (mirror.length >= 3 && mirror.slice(0, 3).every(m => m.ok === false))
      out.push(
        `the sales mirror failed three runs in a row: ${String(last.error ?? "no error text").slice(0, 160)}`,
      );
  }
  return out;
}

async function read<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok)
    throw new Error(
      `Creative Triage answered ${res.status} to the sales watch's read`,
    );
  return (await res.json()) as T[];
}

export const check = internalAction({
  args: {},
  handler: async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY)
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deployment, so the sales cockpit cannot be watched",
      );
    const [desk, mirror] = await Promise.all([
      read<DeskRun>(
        "cockpit_sales_worker_status?worker=eq.sales-desk&select=job,ok,at,detail",
      ),
      read<MirrorRun>(
        "cockpit_sales_mirror_runs?select=started_at,ok,error&order=id.desc&limit=3",
      ),
    ]);
    const problems = salesProblems(desk, mirror, Date.now());
    if (problems.length)
      throw new Error(
        `${problems.join("; ")}. Fix: RUNBOOK.md, Sales desk and Sales cockpit (the desk runs on the VPS as hermes: crontab -l, tail ~/.sales-desk.log, python3 desk.py doctor).`,
      );
    return { jobs: desk.length };
  },
});
