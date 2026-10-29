/**
 * op effects.sweep (docs/forms/STAGE2B-CONTRACT.md build 0): the 1-1 notes sweep's
 * drafts. A live check-in's grade and recap effects wait for their drafts; when a
 * planned grade or recap effect younger than 30 minutes has no drafting or ready
 * draft, cockpit_form_effects_kick (migration 20261029w, every minute from the
 * notices kick) posts this op with the cron secret, at most once every two
 * minutes. This begins the missing drafts as the response's own seat, so the
 * drafts' own guards keep one grade per recording and one recap per response,
 * and the dispatch trigger turns a ready draft into its delivery.
 *
 * A cron request has no seat token: the response comes from the service read
 * (cockpit_form_effects_waiting carries cockpit_form_response_view), the seat
 * from cockpit_forms_actor, and the stored drafts from cockpit_form_drafts_service
 * (Z42, Z56). No seat RPC is ever called here. At most four rows a run, inside a
 * 100-second budget; a refused seat skips its row with a log line and no draft.
 * Log lines name the effect and the kind only, never a person, a client or a text.
 */
import { RpcError } from "../cockpit-hours-sync/db.ts";
import type { Actor, Deps } from "./door.ts";
import { type DraftsReader, draftsForResponse, draftsOf, type Kind } from "./drafts.ts";

/** One row of cockpit_form_effects_waiting (2b 4.0 item 8). */
export type WaitingEffect = {
  effectId: string;
  responseId: string;
  kind: "grade" | "recap";
  taskId: string | null;
  recordingId: string | null;
  since: string | null;
  draftState: string | null;
  actorId: string | null;
  response: Record<string, any> | null;
};
export type SweepAnswer = { ok: true; begun: number; skipped: number };

/** Rows one run takes; the rest wait for the next post (the kick posts at most once every two minutes). */
export const SWEEP_MAX = 4;
/** No new row starts after this long, so the run ends inside the Edge Function's wall clock. */
export const SWEEP_BUDGET_MS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored drafts of a response through the service read (cockpit_form_drafts_service, 20261029w). */
export const serviceDrafts =
  (deps: Pick<Deps, "rpc">): DraftsReader =>
  async responseId =>
    draftsOf(await deps.rpc("cockpit_form_drafts_service", { p_response_id: responseId }));

const say = (line: string) => console.log(`effects.sweep: ${line}`);

export async function sweepEffects(deps: Deps): Promise<SweepAnswer> {
  const raw = await deps.rpc("cockpit_form_effects_waiting", {});
  const rows = (Array.isArray(raw) ? raw : []) as WaitingEffect[];
  const started = deps.now().getTime();
  const readDrafts = serviceDrafts(deps);
  let begun = 0;
  let skipped = 0;
  for (const row of rows.slice(0, SWEEP_MAX)) {
    if (deps.now().getTime() - started > SWEEP_BUDGET_MS) {
      say(`the time ran out before the ${row.kind} of effect ${row.effectId}; the next sweep takes it.`);
      break;
    }
    const kind = row.kind;
    if ((kind !== "grade" && kind !== "recap") || !row.response || !UUID.test(String(row.actorId ?? ""))) {
      say(`skipped effect ${row.effectId}: the row names no seat, response or kind to draft.`);
      skipped += 1;
      continue;
    }
    let actor: Actor | null;
    try {
      actor = (await deps.rpc("cockpit_forms_actor", { p_actor: row.actorId })) as Actor | null;
    } catch (e) {
      if (!(e instanceof RpcError)) throw e;
      say(`skipped the ${kind} of effect ${row.effectId}: the response's seat was refused, so no draft was begun.`);
      skipped += 1;
      continue;
    }
    if (!actor?.actorId) {
      say(`skipped the ${kind} of effect ${row.effectId}: the response's seat was refused, so no draft was begun.`);
      skipped += 1;
      continue;
    }
    try {
      const answer = await draftsForResponse({ deps, actor }, row.response, [kind as Kind], readDrafts);
      if (answer.started.length) begun += answer.started.length;
      else skipped += 1;
    } catch (e) {
      say(`the ${kind} of effect ${row.effectId} could not be begun: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
      skipped += 1;
    }
  }
  return { ok: true, begun, skipped };
}
