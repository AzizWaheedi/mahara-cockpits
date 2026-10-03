// The cron door (glossary C9). pg_cron cannot call sales-api itself: the
// gateway wants a project key and the vault holds none. So pg_cron posts here
// with x-cron-secret (vault `cockpit_sync_secret`), and sales-live passes on
// exactly two bodies, rebuilt field by field, with the project key plus the
// same secret, the way sales-mirror calls contract.sync:
//
// - room.event, kind sweep.replay only: the rooms sweep replaying events
//   nobody handled in 20 s, by their ids (mahara-sales-rooms-sweep sends
//   {action, kind, payload: {event_ids}}). Any other room.event is refused:
//   the cron secret is shared with sales-mirror and sales-api, and a Zoom
//   event posted here would skip Zoom's signature and could mark a lead in.
// - thread.tick: the demo chat's two-minute tick (P4), with no payload.
//
// Everything else sales-api's CRON_ACTIONS knows (contract.sync, live.press,
// reply.seen) has its own caller and never comes through here.

export const CRON_FORWARD = new Set(["room.event", "thread.tick"]);

export const CRON_MAX_BYTES = 64_000;

/** The most events one sweep run replays (the sweep's own `limit 50`). */
export const REPLAY_MAX = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CronCheck =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): CronCheck => ({ ok: false, status, error });

/**
 * Whether a body may be passed on, and the exact body to pass on if so. The
 * forwarded body is built here from the checked fields only; nothing else
 * the caller sent reaches sales-api.
 */
export function cronForwardable(body: unknown): CronCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "Send a JSON object with an action.");
  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  if (!CRON_FORWARD.has(action))
    return refuse(403, `The cron door passes on only ${[...CRON_FORWARD].join(" and ")}.`);

  if (action === "thread.tick") return { ok: true, body: { action: "thread.tick" } };

  if (b.kind !== "sweep.replay")
    return refuse(403, "The cron door passes on only the sweep's replays (room.event, kind sweep.replay).");
  const payload = b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? (b.payload as Record<string, unknown>) : {};
  const ids = payload.event_ids;
  if (!Array.isArray(ids) || ids.length === 0)
    return refuse(400, "A sweep replay needs payload.event_ids, a list of event ids.");
  if (ids.length > REPLAY_MAX) return refuse(400, `A sweep replay carries at most ${REPLAY_MAX} event ids.`);
  if (!ids.every(id => typeof id === "string" && UUID.test(id)))
    return refuse(400, "Every event id in a sweep replay must be a UUID.");
  const unique = [...new Set((ids as string[]).map(id => id.toLowerCase()))];
  return { ok: true, body: { action: "room.event", kind: "sweep.replay", payload: { event_ids: unique } } };
}
