/**
 * The Calls part of a client's page in the layout harness: the call centre
 * reads answer from made-up fixtures (callCentreFixture.ts) after a delay,
 * and Play returns a short made-up tone, so every state can be looked at
 * without signing in. Open, for example:
 *
 *   /harness.html?path=%2Fcalls%3Faccount%3DLiwan%2520Limited&calls=call_centre
 *
 * `calls=` picks the answer: call_centre (default), lead_quality, on_track,
 * not_enough, client_calls, no_data, empty, refused, loading. `delay=` sets
 * the wait in ms (1200 by default). Add `%23calls` to the path to open the
 * page at the Calls part. Never imported by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALL_SCENARIOS,
  type CallScenario,
  callCentreScenario,
  callersScenario,
} from "./callCentreFixture";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

/** A second of a quiet 440 Hz tone as a WAV file: the stand-in recording. */
function tone(seconds = 2): Blob {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    v.setInt16(
      44 + i * 2,
      Math.sin((2 * Math.PI * 440 * i) / rate) * 2400,
      true,
    );
  return new Blob([buf], { type: "audio/wav" });
}

export function installCallCentreHarness(client: SupabaseClient): void {
  const params = new URLSearchParams(window.location.search);
  if (!/^\/(ads|calls)\b/.test(params.get("path") ?? "")) return;
  const pick = params.get("calls") ?? "call_centre";
  const delay = Number(params.get("delay") ?? 1200);
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    auth: { getSession: () => Promise<unknown> };
  };
  const previous = c.rpc.bind(c);
  c.rpc = async (name, args = {}) => {
    if (name === "cockpit_client_callers") {
      await new Promise(r => setTimeout(r, 150));
      return { data: callersScenario(), error: null };
    }
    if (name !== "cockpit_client_calls") return previous(name, args);
    if (pick === "loading") return new Promise<Answer>(() => {});
    await new Promise(r => setTimeout(r, delay));
    if (pick === "refused")
      return {
        data: null,
        error: {
          code: "42501",
          message:
            "This client is not on your cockpit seat. Ask the CEO to add it.",
        },
      };
    const kind = (CALL_SCENARIOS as string[]).includes(pick)
      ? (pick as CallScenario)
      : "call_centre";
    return {
      data: callCentreScenario(kind, String(args.p_from), String(args.p_to)),
      error: null,
    };
  };
  // Play: a made-up session token and a short tone from the recording route.
  const session = c.auth.getSession.bind(c.auth);
  c.auth.getSession = async () => {
    const real = (await session()) as {
      data?: { session?: { access_token?: string } | null };
    };
    return real?.data?.session?.access_token
      ? real
      : {
          data: { session: { access_token: "harness-token" } },
          error: null,
        };
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : String((input as Request).url ?? input);
    if (!url.includes("/functions/v1/cockpit-call-recording"))
      return realFetch(input, init);
    await new Promise(r => setTimeout(r, 500));
    const body = JSON.parse(String(init?.body ?? "{}")) as { callId?: string };
    if (body.callId === "88118455")
      return new Response(
        JSON.stringify({
          error:
            "Maqsam has no recording of this call, often because nobody answered.",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    return new Response(tone(), { headers: { "content-type": "audio/wav" } });
  };
}
