// The cron door (glossary C9). pg_cron cannot call sales-api itself: the
// gateway wants a project key and the vault holds none. So pg_cron posts here
// with x-cron-secret (vault `cockpit_sync_secret`), and sales-live passes on
// only these actions, with the project key plus the same secret, the way
// sales-mirror calls contract.sync.
//
// - room.event: the rooms sweep replaying an event nobody handled in 20 s.
// - thread.tick: the demo chat's two-minute tick (P4).
//
// Everything else sales-api's CRON_ACTIONS knows (contract.sync, live.press,
// reply.seen) has its own caller and never comes through here.

export const CRON_FORWARD = new Set(["room.event", "thread.tick"]);

export const CRON_MAX_BYTES = 64_000;

const KIND = /^[a-z0-9_.]{1,80}$/;

export type CronCheck =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/** Whether a body may be passed on, with the sentence to answer if not. */
export function cronForwardable(body: unknown): CronCheck {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, status: 400, error: "Send a JSON object with an action." };
  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  if (!CRON_FORWARD.has(action))
    return {
      ok: false,
      status: 403,
      error: `The cron door passes on only ${[...CRON_FORWARD].join(" and ")}.`,
    };
  if (action === "room.event" && !(typeof b.kind === "string" && KIND.test(b.kind)))
    return { ok: false, status: 400, error: "A room.event needs a kind, such as sweep.replay." };
  return { ok: true, body: b };
}
