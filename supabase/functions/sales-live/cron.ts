// The cron door (glossary C9). pg_cron cannot call sales-api itself: the
// gateway wants a project key and the vault holds none. So pg_cron posts here
// with x-cron-secret (vault `cockpit_sync_secret`), and sales-live passes on
// exactly these bodies, rebuilt field by field, with the project key plus the
// same secret, the way sales-mirror calls contract.sync:
//
// - room.event, kind sweep.replay: the rooms sweep replaying events nobody
//   handled in 20 s, by their ids ({action, kind, payload: {event_ids}}).
// - room.event, kind sweep.settle: rooms due to be settled as a no-show
//   ({action, kind, payload: {room_ids}}, contract-v2 S4).
// - room.event, kind tick: rooms sales-api re-checks for a link, a count or
//   an undo that never landed ({action, kind, payload: {room_ids}}, S4).
//   A tick moves no timer; a forged one can only ask for a re-check of rows
//   as they stand.
// - thread.tick: the demo chat's two-minute tick (P4), with no payload.
//
// Any other room.event is refused: the cron secret is shared with
// sales-mirror and sales-api, and a Zoom event posted here would skip Zoom's
// signature and could mark a lead in. Everything else sales-api's
// CRON_ACTIONS knows (contract.sync, live.press, reply.seen) has its own
// caller and never comes through here.

export const CRON_FORWARD = new Set(["room.event", "thread.tick"]);

export const CRON_MAX_BYTES = 64_000;

/** The most ids one post carries (the sweep's own `limit 50`, and 50 a tick post). */
export const REPLAY_MAX = 50;

/** The room.event kinds the cron door passes on, and the id list each carries. */
export const CRON_KINDS: Readonly<Record<string, "event_ids" | "room_ids">> = {
  "sweep.replay": "event_ids",
  "sweep.settle": "room_ids",
  tick: "room_ids",
};

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

  const kind = typeof b.kind === "string" && Object.hasOwn(CRON_KINDS, b.kind) ? b.kind : "";
  if (!kind)
    return refuse(403, "The cron door passes on only the sweep's room.event kinds: sweep.replay, sweep.settle and tick.");
  const field = CRON_KINDS[kind];
  const what = field === "event_ids" ? "event" : "room";
  const payload = b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? (b.payload as Record<string, unknown>) : {};
  const ids = payload[field];
  if (!Array.isArray(ids) || ids.length === 0) return refuse(400, `A ${kind} needs payload.${field}, a list of ${what} ids.`);
  if (ids.length > REPLAY_MAX) return refuse(400, `A ${kind} carries at most ${REPLAY_MAX} ${what} ids.`);
  if (!ids.every(id => typeof id === "string" && UUID.test(id))) return refuse(400, `Every ${what} id in a ${kind} must be a UUID.`);
  const unique = [...new Set((ids as string[]).map(id => id.toLowerCase()))];
  return { ok: true, body: { action: "room.event", kind, payload: { [field]: unique } } };
}
