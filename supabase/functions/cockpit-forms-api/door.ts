/**
 * The door of cockpit-forms-api (docs/forms/STAGE2-CONTRACT.md 6.2), deployed with
 * the JWT check on. POST only; a bearer token is required; the user comes from
 * Supabase Auth and the seat from cockpit_forms_actor. A service-role token (the
 * gateway has checked its signature) runs the doctor and nothing else. Every op
 * gates itself again in the database: checkin.calls and checkin.typeformSent
 * through the client gate, the draft and transcript ops through the response's
 * own gate (read with the seat's token), keys.save and the doctor for the CEO.
 * An error answers {"error": "<one sentence>"} with 400, 403 or 404: never a
 * stack, a key or a provider's body.
 */
import { type Rpc, RpcError } from "../cockpit-hours-sync/db.ts";
import { checkinCalls } from "./calls.ts";
import { checkinDrafts, type Kind } from "./drafts.ts";
import { transcriptOp } from "./fathom.ts";
import { runDoctor } from "./doctor.ts";
import { saveKey } from "./keys.ts";
import { typeformSent } from "./typeform.ts";

export type Actor = { actorId: string; email: string; ceo: boolean; admin: boolean; csm: boolean; roles: string[] };
export type Deps = {
  /** The project's service key, to know a service-role bearer when it is not a JWT. */
  serviceKey: string;
  /** The signed-in user of a bearer token (Supabase Auth), or null. */
  getUser: (authorization: string) => Promise<{ id: string; email: string | null } | null>;
  /** Service RPCs (restRpc with the service key). */
  rpc: Rpc;
  /** Browser RPCs with the seat's own token, so the database gates them as the seat. */
  userRpc: (authorization: string) => Rpc;
  /** One row into cockpit_csm_provider_health; throws when it cannot be saved. */
  health: (row: Record<string, unknown>) => Promise<void>;
  /** One row into cockpit_forms_key_checks (keys.save's tests of a pasted key); throws when it cannot be saved. */
  keyChecks: (row: Record<string, unknown>) => Promise<void>;
  /** The transcripts bucket (csm-call-transcripts): a stored text, and a signed link to it. */
  storage: { read(path: string): Promise<string | null>; sign(path: string, seconds: number): Promise<string | null> };
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  now: () => Date;
  waitUntil: (work: Promise<unknown>) => void;
  uuid: () => string;
};
/** What an op gets: the deps, the seat, and the seat's own RPCs. */
export type OpCtx = { deps: Deps; actor: Actor; userRpc: Rpc };

/** A refusal in one sentence, with its status. */
export class DoorError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DoorError";
    this.status = status;
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const DRAFT_AGAIN = new Set<Kind>(["todos", "client_notes", "defcon_priority", "recap"]);
/**
 * The database's sentences: a refusal (22023, 40001, P0001 with no code of its own) or a gate (42501).
 * A unique violation (23505) is Postgres's own message, which names a constraint, so it gets the plain one.
 */
const SENTENCE_CODES = new Set(["22023", "40001", "P0001", "42501"]);
const GENERIC = "The 1-1 notes could not do that just now. Try again in a minute.";
const NOT_LIVE = "The cockpit's 1-1 notes are not live yet.";

/** The role a JWT says it carries (the gateway has verified the signature), or null. */
export function tokenRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** An error as the browser may see it: its sentence and status, or a plain sentence that names nothing inside. */
export function answerFor(error: unknown): { status: number; message: string } {
  if (error instanceof DoorError) return { status: error.status, message: error.message };
  if (error instanceof RpcError) {
    if (error.code === "PGRST202" || error.code === "42883") return { status: 404, message: NOT_LIVE };
    if (error.code && SENTENCE_CODES.has(error.code)) return { status: error.code === "42501" ? 403 : 400, message: error.message.slice(0, 240) };
  }
  return { status: 400, message: GENERIC };
}

export function makeDoor(deps: Deps): (req: Request) => Promise<Response> {
  return async req => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.length <= 7) return json({ error: "Sign in first" }, 401);
    const token = authorization.slice(7).trim();
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await req.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
    const op = typeof body.op === "string" ? body.op : "";
    try {
      if ((deps.serviceKey && token === deps.serviceKey) || tokenRole(token) === "service_role") {
        if (op !== "doctor") return json({ error: "The service key runs the doctor only." }, 403);
        return json(await runDoctor({ deps }));
      }
      const user = await deps.getUser(authorization);
      if (!user?.id) return json({ error: "Sign in first" }, 401);
      const actor = (await deps.rpc("cockpit_forms_actor", { p_actor: user.id })) as Actor;
      const ctx: OpCtx = { deps, actor, userRpc: deps.userRpc(authorization) };
      switch (op) {
        case "checkin.calls":
          return json(await checkinCalls(ctx, body));
        case "checkin.drafts":
          return json(await checkinDrafts(ctx, body, null));
        case "checkin.draftAgain": {
          const kind = String(body.kind ?? "");
          if (kind === "grade") return json({ error: "A call is graded once." }, 400);
          if (!DRAFT_AGAIN.has(kind as Kind)) return json({ error: "Pick what to draft again." }, 400);
          return json(await checkinDrafts(ctx, body, kind as Kind));
        }
        case "checkin.transcript":
          return json(await transcriptOp(ctx, body));
        case "checkin.typeformSent":
          return json(await typeformSent(ctx, body));
        case "keys.save":
          if (!actor.ceo) return json({ error: "Only the CEO can change the 1-1 notes connections." }, 403);
          return json(await saveKey(ctx, body));
        case "doctor":
          if (!actor.ceo) return json({ error: "Only the CEO can run the 1-1 notes doctor." }, 403);
          return json(await runDoctor(ctx));
        default:
          return json({ error: "Unknown action." }, 400);
      }
    } catch (error) {
      const { status, message } = answerFor(error);
      return json({ error: message }, status);
    }
  };
}
