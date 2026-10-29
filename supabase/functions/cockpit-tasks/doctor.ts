/**
 * The doctor (contract 5.5): which secrets are set (names only, never a
 * value), one GET user to prove the token works and read its rate limit,
 * the task mirror's own pace beside it, how many seats are linked, and the
 * last delta and seats runs. Reads only; it writes no state row.
 */
import { ClickUpReader, callsPerMinute, type Deps, type Row, sentence } from "./clickup.ts";

/** The task mirror's pace may take at most this share of the limit ClickUp reports for the shared token. */
export const PACE_SHARE = 0.6;

export const SECRETS = ["CLICKUP_API_TOKEN", "TASKS_CRON_SECRET", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

export type Doctor = {
  ok: boolean;
  note: string;
  secrets: Record<string, boolean>;
  rateLimit: number | null;
  /** The calls a minute the delta and seats readers keep to (callsPerMinute). */
  pace: number;
  linked: number | null;
  notLinked: number | null;
  lastDelta: Row | null;
  lastSeats: Row | null;
  problems: string[];
};

export async function runDoctor(deps: Deps): Promise<Doctor> {
  const secrets = Object.fromEntries(SECRETS.map(name => [name, !!deps.env(name)?.trim()])) as Record<string, boolean>;
  const problems: string[] = [];
  for (const [name, present] of Object.entries(secrets)) if (!present) problems.push(`${name} is not set on cockpit-tasks.`);
  let rateLimit: number | null = null;
  const pace = callsPerMinute(deps.env);
  if (secrets.CLICKUP_API_TOKEN) {
    try {
      // A person is waiting: not paced, and one more try after ClickUp's 429.
      const cu = new ClickUpReader(deps, deps.uuid(), { interactive: true });
      const me = await cu.get("user");
      if (!me?.user?.id) throw new Error("ClickUp answered without a user");
      rateLimit = cu.rateLimit;
    } catch (e) {
      problems.push(`ClickUp did not accept the token: ${sentence(e)}`);
    }
  }
  if (rateLimit && pace > rateLimit * PACE_SHARE)
    problems.push(
      `The task mirror is set to ${pace} calls a minute, more than 60% of the ${rateLimit} ClickUp allows this token. Lower CLICKUP_TASKS_CALLS_PER_MINUTE.`,
    );
  let linked: number | null = null;
  let notLinked: number | null = null;
  let lastDelta: Row | null = null;
  let lastSeats: Row | null = null;
  try {
    const inputs = (await deps.rpc("cockpit_task_mirror_inputs", {})) as Row;
    linked = Array.isArray(inputs?.linked) ? inputs.linked.length : null;
    notLinked = typeof inputs?.notLinked === "number" ? inputs.notLinked : null;
    lastDelta = inputs?.states?.delta ?? null;
    lastSeats = inputs?.states?.seats ?? null;
  } catch (e) {
    problems.push(`The database did not answer: ${sentence(e)}`);
  }
  if (linked === 0) problems.push("No seat is linked to a ClickUp user yet. Run the seats job, then link the rest in Requests settings.");
  if (lastDelta === null) problems.push("The 2-minute task read has not run yet.");
  else if (lastDelta.ok === false) problems.push(`The last task read failed: ${lastDelta.note ?? "no note"}`);
  if (lastSeats === null) problems.push("The hourly seats read has not run yet.");
  else if (lastSeats.ok === false) problems.push(`The last seats read failed: ${lastSeats.note ?? "no note"}`);
  const ok = problems.length === 0;
  const note = ok
    ? `ClickUp answers${rateLimit ? ` (${rateLimit} calls a minute allowed; the task mirror reads at ${pace} a minute)` : ""}; ${linked} seats linked, ${notLinked ?? 0} not linked.`
    : problems.join(" ");
  return { ok, note, secrets, rateLimit, pace, linked, notLinked, lastDelta, lastSeats, problems };
}
