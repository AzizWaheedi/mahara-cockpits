/**
 * Fetch one call centre recording as audio the page can play (Aziz,
 * 2026-10-13: "where we can actually listen to the calls"). The Edge Function
 * cockpit-call-recording checks the seat's own token against the client and
 * audits the play; an <audio> tag cannot send that token, so the page plays a
 * blob URL made from this answer, as the client portal does. The same file in
 * the client success and media buyer cockpits (scripts/check-shared.sh); it
 * imports nothing.
 */

export type RecordingResult =
  | { ok: true; blob: Blob }
  | { ok: false; message: string };

const FALLBACK =
  "The recording could not be played. Try again; if it keeps failing, open the call in the dialer.";

/** Plain words for a refusal or a failure, never a raw status code. */
export function recordingProblem(status: number, message?: string): string {
  if (message?.trim()) return message.trim();
  if (status === 401) return "Your sign-in has expired. Reload the page.";
  if (status === 403) return "You cannot play calls for this client.";
  if (status === 404)
    return "Maqsam has no recording of this call, often because nobody answered.";
  return FALLBACK;
}

export async function fetchCallRecording(
  supabaseUrl: string,
  accessToken: string,
  callId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RecordingResult> {
  if (!callId.trim())
    return { ok: false, message: "This lead has no call to play." };
  let res: Response;
  try {
    res = await fetchImpl(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/cockpit-call-recording`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ callId }),
      },
    );
  } catch {
    return { ok: false, message: FALLBACK };
  }
  if (!res.ok) {
    let message: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Not JSON: the plain sentence below.
    }
    return { ok: false, message: recordingProblem(res.status, message) };
  }
  const type = res.headers.get("content-type") ?? "";
  if (!/^audio\//i.test(type)) return { ok: false, message: FALLBACK };
  return { ok: true, blob: await res.blob() };
}
