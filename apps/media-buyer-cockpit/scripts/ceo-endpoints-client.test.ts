import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "bun:test";
import { applyExtensionsToClickUp, postingAction, setWebinarPitches } from "../src/lib/ceoEndpointsClient";

type Call = { kind: "rpc" | "invoke"; name: string; body: any };

function fakeClient(reply: (call: Call) => { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const client = {
    async rpc(name: string, body: unknown) {
      const call: Call = { kind: "rpc", name, body };
      calls.push(call);
      return reply(call);
    },
    functions: {
      async invoke(name: string, options: { body: unknown }) {
        const call: Call = { kind: "invoke", name, body: options.body };
        calls.push(call);
        return reply(call);
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test("pitch times go to the founder RPC as whole minutes; bad input never leaves the browser", async () => {
  const { client, calls } = fakeClient(() => ({ data: { ok: true }, error: null }));
  expect(await setWebinarPitches(client, { sessionUuid: "s1", pitch1Min: 12, pitch2Min: null })).toEqual({ ok: true });
  expect(calls).toEqual([{ kind: "rpc", name: "cockpit_ceo_webinar_pitch_set", body: { p_session_uuid: "s1", p_pitch1_min: 12, p_pitch2_min: null } }]);
  await expect(setWebinarPitches(client, { sessionUuid: "s1", pitch1Min: Number.NaN, pitch2Min: null })).rejects.toThrow("whole minute");
  await expect(setWebinarPitches(client, { sessionUuid: "s1", pitch1Min: 301, pitch2Min: null })).rejects.toThrow("whole minute");
  expect(calls.length).toBe(1);
  const refused = fakeClient(() => ({ data: null, error: { message: "Pitch 2 has to come after pitch 1." } }));
  await expect(setWebinarPitches(refused.client, { sessionUuid: "s1", pitch1Min: 5, pitch2Min: 4 })).rejects.toThrow("after pitch 1");
});

test("the extension button applies through the gateway and returns the tab's result shape", async () => {
  const { client, calls } = fakeClient(() => ({ data: { written: 2, cleared: 1, skipped: 0, errors: [], note: "Written.", ok: true }, error: null }));
  expect(await applyExtensionsToClickUp(client)).toEqual({ written: 2, cleared: 1, skipped: 0, errors: [], note: "Written." });
  expect(calls[0]).toEqual({ kind: "invoke", name: "cockpit-ceo-api", body: { operation: "ceo.extensions.applyToClickUp", args: {}, apply: true } });
  const broken = fakeClient(() => ({ data: { error: "Founder access required" }, error: null }));
  await expect(applyExtensionsToClickUp(broken.client)).rejects.toThrow("Founder access required");
});

test("posting reads go without apply, writes with it, and every answer is shape-checked", async () => {
  const post = { id: 7, urls: {} };
  const { client, calls } = fakeClient(call => {
    const op = String(call.body.operation).split(".").pop();
    if (op === "list") return { data: [post], error: null };
    if (op === "channels") return { data: [{ platform: "youtube" }], error: null };
    if (op === "uploadUrl") return { data: { path: "uploads/1-a.mp4", url: "https://u.test" }, error: null };
    if (op === "rerender") return { data: { jobId: 4 }, error: null };
    return { data: post, error: null };
  });
  expect(await postingAction(client, "list", { limit: 40 })).toEqual([post]);
  expect(await postingAction(client, "channels", {})).toEqual([{ platform: "youtube" }]);
  expect(await postingAction(client, "uploadUrl", { filename: "a.mp4" })).toEqual({ path: "uploads/1-a.mp4", url: "https://u.test" });
  expect(await postingAction(client, "rerender", { id: 7 })).toEqual({ jobId: 4 });
  expect(await postingAction(client, "approve", { id: 7 })).toEqual(post);
  expect(calls.map(c => [c.body.operation, c.body.apply])).toEqual([
    ["ceo.posting.list", false],
    ["ceo.posting.channels", false],
    ["ceo.posting.uploadUrl", true],
    ["ceo.posting.rerender", true],
    ["ceo.posting.approve", true],
  ]);
  await expect(postingAction(client, "publishEverywhere", {})).rejects.toThrow("Unknown posting operation");
  expect(calls.length).toBe(5);
  const odd = fakeClient(() => ({ data: { dryRun: true }, error: null }));
  await expect(postingAction(odd.client, "approve", { id: 7 })).rejects.toThrow("did not confirm the post");
});
