/**
 * cockpit-call-recording (JWT check ON): plays one call centre call to a seat
 * that may hear it (Aziz, 2026-10-13: "where we can actually listen to the
 * calls ... see why exactly the leads were lost").
 *
 *   POST {callId}   Authorization: Bearer <the seat's own token>   Range: optional
 *
 * 1. public.cockpit_call_recording_scope, called with the seat's own token,
 *    says yes only for a call the dialer links to a client the seat may see
 *    (the CEO, client success or a media buyer, within cockpit_client_allowed).
 *    Anything else is a 403 with the database's own sentence.
 * 2. Maqsam gives a short-lived signed link (SALES_MAQSAM_ACCESS_KEY and
 *    SALES_MAQSAM_SECRET, read by name). Only https links on Maqsam's storage
 *    hosts are followed.
 * 3. The audio is fetched with the browser's Range and streamed back with
 *    Cache-Control: private, no-store. The signed link never leaves the
 *    function: not in a header, a body, an error or the health ledger.
 * 4. public.cockpit_call_recording_played writes the audit row, as the seat,
 *    before the first byte goes out; no audit row, no audio.
 *
 * An <audio> tag cannot send the token, so the page fetches the audio as a
 * blob, the way the client portal's CallAudio does.
 */
import { type Health, maqsamRecordings, ProviderError } from "./tools.ts";

export type RpcResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
};

export type RecordingDeps = {
  /** A database function called as the seat, with the seat's own token. */
  userRpc: (
    jwt: string,
    fn: "cockpit_call_recording_scope" | "cockpit_call_recording_played",
    args: { p_call_id: string },
  ) => Promise<RpcResult>;
  /** One receipt in the provider health ledger, written with the service key. */
  health: Health;
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
};

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info,range",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Expose-Headers":
    "content-type,content-length,content-range,accept-ranges",
};
const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...NO_STORE, "Content-Type": "application/json" },
  });

/** Database refusals whose sentence is ours to show (the gate and the input). */
const REFUSALS = new Set(["42501", "22023"]);
const AUDIO = /^(audio\/|video\/|application\/octet-stream)/i;
const RANGE = /^bytes=(\d+-\d*|-\d+)$/;

export function makeRecordingApi(deps: RecordingDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("", { headers: cors });
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ") || auth.length < 8)
      return json({ error: "Sign in first." }, 401);
    const jwt = auth.slice(7);
    const body = (await req.json().catch(() => null)) as {
      callId?: unknown;
    } | null;
    const callId =
      typeof body?.callId === "string" || typeof body?.callId === "number"
        ? String(body.callId)
        : "";
    if (!/^[0-9]{1,20}$/.test(callId))
      return json({ error: "Choose a call to play." }, 400);
    const range = req.headers.get("Range");
    if (range !== null && !RANGE.test(range))
      return new Response(null, {
        status: 416,
        headers: { ...cors, ...NO_STORE },
      });

    // 1. May this seat hear this call?
    const scope = await deps
      .userRpc(jwt, "cockpit_call_recording_scope", { p_call_id: callId })
      .catch(() => null);
    if (!scope)
      return json(
        { error: "Could not check your access. Try again in a minute." },
        502,
      );
    if (scope.error)
      return REFUSALS.has(scope.error.code ?? "")
        ? json(
            {
              error: scope.error.message || "This call cannot be played here.",
            },
            403,
          )
        : json(
            { error: "Could not check your access. Try again in a minute." },
            502,
          );
    if ((scope.data as { ok?: unknown } | null)?.ok !== true)
      return json({ error: "This call cannot be played here." }, 403);

    let upstream: Response | null = null;
    try {
      const maqsam = maqsamRecordings(
        {
          key: deps.env("SALES_MAQSAM_ACCESS_KEY") ?? "",
          secret: deps.env("SALES_MAQSAM_SECRET") ?? "",
        },
        deps.health,
        deps.fetch,
      );
      // 2 and 3. The signed link, then the audio.
      const url = await maqsam.signedUrl(callId);
      upstream = await maqsam.audio(url, callId, range);
      if (upstream.status === 416) {
        await upstream.body?.cancel();
        return new Response(null, {
          status: 416,
          headers: { ...cors, ...NO_STORE },
        });
      }
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return json(
          {
            error:
              "The recording link expired before it played. Press play again.",
          },
          502,
        );
      }
      if (!AUDIO.test(upstream.headers.get("content-type") ?? "")) {
        await upstream.body?.cancel();
        return json(
          {
            error:
              "Maqsam sent something that is not audio, so it was not played.",
          },
          502,
        );
      }
      // 4. The audit row, then the audio.
      const played = await deps
        .userRpc(jwt, "cockpit_call_recording_played", { p_call_id: callId })
        .catch(() => null);
      if (!played || played.error) {
        await upstream.body?.cancel();
        return played?.error && REFUSALS.has(played.error.code ?? "")
          ? json(
              {
                error:
                  played.error.message || "This call cannot be played here.",
              },
              403,
            )
          : json(
              {
                error:
                  "The play could not be recorded, so the recording was not sent. Try again.",
              },
              502,
            );
      }
      const headers = new Headers({
        ...cors,
        ...NO_STORE,
        "X-Content-Type-Options": "nosniff",
      });
      for (const k of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
      ]) {
        const v = upstream.headers.get(k);
        if (v) headers.set(k, v);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      await upstream?.body?.cancel().catch(() => {});
      if (error instanceof ProviderError)
        return json({ error: error.message }, error.status);
      return json(
        { error: "The recording could not be played. Try again in a minute." },
        502,
      );
    }
  };
}
