/**
 * Frame.io's webhook, received and put in the queue.
 *
 * Deliberately the dumbest thing in the integration. Their payload is ids
 * and nothing else -- no comment text, no frame, no author -- so there is
 * nothing here worth interpreting. Reading what the event points at needs
 * an Adobe token, and that token lives on the worker beside the Google one
 * it already renews every run. So this verifies the signature, writes one
 * row, and stops.
 *
 * Three things fall out of keeping it this small:
 *
 * - **Nothing is lost when the token is stale.** The events are already
 *   queued; the worker drains the backlog when it can read again.
 * - **This cannot be slow.** One signature check and one insert, no
 *   outbound call that can hang for thirty seconds.
 * - **It is optional.** If the Frame.io account turns out not to be able to
 *   create a webhook at all, the worker's twenty minute sweep reads the
 *   same comments on its own. This only makes it prompt: the request queue
 *   drains every three minutes.
 *
 * Environment (Vercel, production): FRAMEIO_WEBHOOK_SECRET, given once when
 * the webhook is created and never shown again; SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY, already set for the rest of this deployment.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far out of date a signed event may be. Their signature covers the
 *  timestamp, so this is what stops a captured request being replayed. */
export const MAX_AGE_SECONDS = 300;

/** Events worth queueing. Anything else is acknowledged and dropped, so a
 *  webhook configured too broadly does not fill the queue with noise. */
export const WANTED = new Set([
  "comment.created",
  "comment.updated",
  "comment.completed",
  "comment.uncompleted",
  "file.versioned",
  "file.ready",
  "share.viewed",
]);

function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/**
 * Their scheme: HMAC SHA256 over `v0:<timestamp>:<body>`, compared against
 * the `X-Frameio-Signature` header, which arrives as `t=…,v0=<hex>`.
 *
 * The body has to be the bytes as sent. Parsing the JSON and re-encoding
 * it changes the whitespace and the signature stops matching, which is why
 * the raw text is read first and parsed afterwards.
 *
 * **The timestamp used for freshness is the one inside the signed
 * message**, not a separate header. That matters more than it looks: the
 * signature covers the timestamp, so if freshness were judged on an
 * unsigned header, anyone holding a captured request could replay it
 * forever just by putting today's date in the header the signature does
 * not cover. Checking the signed one means a replay needs the secret.
 */
export function verify(
  raw: string,
  signature: string | null,
  fallbackStamp: string | null,
  secret: string,
): { ok: boolean; why: string } {
  if (!signature) return { ok: false, why: "unsigned" };
  const parts: Record<string, string> = {};
  for (const piece of signature.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  const given =
    parts.v0 ?? (signature.startsWith("v0=") ? signature.slice(3) : "");
  // Their own header carries `t=`; the separate request-timestamp header is
  // accepted only as a fallback, and either way the value goes into the
  // signed message, so neither can be changed without breaking the hash.
  const stamp = parts.t ?? fallbackStamp ?? "";
  if (!given || !stamp) return { ok: false, why: "malformed" };

  if (!fresh(stamp)) return { ok: false, why: "stale" };

  const want = createHmac("sha256", secret)
    .update(`v0:${stamp}:${raw}`)
    .digest("hex");
  let a: Buffer;
  try {
    a = Buffer.from(given, "hex");
  } catch {
    return { ok: false, why: "malformed" };
  }
  const b = Buffer.from(want, "hex");
  if (a.length !== b.length) return { ok: false, why: "malformed" };
  return timingSafeEqual(a, b)
    ? { ok: true, why: "" }
    : { ok: false, why: "bad signature" };
}

export function fresh(stamp: string | null): boolean {
  const t = Number(stamp);
  if (!Number.isFinite(t) || t <= 0) return false;
  return Math.abs(Date.now() / 1000 - t) <= MAX_AGE_SECONDS;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.FRAMEIO_WEBHOOK_SECRET;
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!secret || !url || !key) {
    console.error("frameio: FRAMEIO_WEBHOOK_SECRET or Supabase is not set");
    return Response.json({ ok: false }, { status: 503 });
  }

  const raw = await request.text();
  const stamp =
    request.headers.get("x-frameio-request-timestamp") ??
    request.headers.get("x-frameio-timestamp");

  const check = verify(
    raw,
    request.headers.get("x-frameio-signature"),
    stamp,
    secret,
  );
  if (!check.ok) {
    // The reason goes to our log, not to the caller: somebody who cannot
    // sign a request does not get told which half they got wrong.
    console.error(`frameio: refused a call (${check.why})`);
    return Response.json({ ok: false }, { status: 401 });
  }

  let event: {
    type?: string;
    resource?: { id?: string; type?: string };
    project?: { id?: string };
  };
  try {
    event = JSON.parse(raw);
  } catch (e) {
    return Response.json({ ok: false, why: short(e) }, { status: 400 });
  }

  const type = String(event.type ?? "");
  const resource = String(event.resource?.id ?? "");
  if (!type || !resource) {
    return Response.json(
      { ok: false, why: "no type or resource" },
      { status: 400 },
    );
  }
  // Acknowledged, not queued. Frame.io retries anything it is not told was
  // received, and an event we will never act on should not come back.
  if (!WANTED.has(type)) {
    return Response.json({ ok: true, ignored: type });
  }

  // One row per event, keyed so the same event delivered twice -- which
  // their retries will do -- is one row and not two notes.
  const id = `fio:${type}:${resource}:${stamp ?? ""}`;
  const now = new Date().toISOString();
  const res = await fetch(`${url}/rest/v1/editor_requests?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        id,
        kind: "frameio",
        // The worker reads the event name from `input` and the thing it
        // points at from `task_id`. Neither is a task id here, but the
        // queue's shape is the queue's shape, and inventing a second one
        // for this would be worse than the small lie.
        input: type,
        task_id: resource,
        params: {
          project: event.project?.id ?? null,
          resource_type: event.resource?.type ?? null,
        },
        status: "queued",
        requested_by: "frame.io",
        requested_by_name: "Frame.io",
        created_at: now,
        updated_at: now,
        attempts: 0,
      },
    ]),
  });

  if (!res.ok) {
    const why = (await res.text()).slice(0, 200);
    console.error(`frameio: could not queue ${type}: ${why}`);
    // 503 rather than 200: Frame.io retries, which is exactly what we want
    // when the queue itself is the thing that failed.
    return Response.json({ ok: false }, { status: 503 });
  }

  return Response.json({ ok: true, queued: type });
}
