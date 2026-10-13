import { describe, expect, test } from "bun:test";
import { fetchCallRecording, recordingProblem } from "../src/lib/callRecording";

const reply = (body: BodyInit | null, status: number, type: string) =>
  (async () =>
    new Response(body, {
      status,
      headers: { "content-type": type },
    })) as unknown as typeof fetch;

describe("playing a call recording", () => {
  test("audio comes back as a blob; the token and call id go to the function", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const f = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as unknown as typeof fetch;
    const r = await fetchCallRecording(
      "https://x.supabase.co/",
      "tok",
      "123",
      f,
    );
    expect(r.ok).toBe(true);
    expect(seen?.url).toBe(
      "https://x.supabase.co/functions/v1/cockpit-call-recording",
    );
    expect((seen?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    expect(seen?.init?.body).toBe(JSON.stringify({ callId: "123" }));
  });

  test("a refusal reads the database's sentence; other failures read plainly", async () => {
    const refused = await fetchCallRecording(
      "https://x",
      "t",
      "1",
      reply(
        JSON.stringify({
          error: "This call belongs to a client outside your list.",
        }),
        403,
        "application/json",
      ),
    );
    expect(refused).toEqual({
      ok: false,
      message: "This call belongs to a client outside your list.",
    });
    const missing = await fetchCallRecording(
      "https://x",
      "t",
      "1",
      reply("nope", 404, "text/plain"),
    );
    expect(missing).toEqual({ ok: false, message: recordingProblem(404) });
    const notAudio = await fetchCallRecording(
      "https://x",
      "t",
      "1",
      reply("{}", 200, "application/json"),
    );
    expect(notAudio.ok).toBe(false);
    expect((await fetchCallRecording("https://x", "t", " ")).ok).toBe(false);
  });
});
