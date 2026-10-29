import { describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { answerFor, DoorError, makeDoor, sameSecret, tokenRole } from "./door.ts";
import { ceoActor, csmActor, fakeDeps, jwt, SEAT_TOKEN, SERVICE_KEY } from "./testkit.ts";

const post = (body: unknown, auth: string | null = SEAT_TOKEN, method = "POST") =>
  new Request("https://example.test/functions/v1/cockpit-forms-api", {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });

const doctorRpc = {
  cockpit_forms_key_get: null,
  cockpit_forms_doctor_store: { csRecordings24h: 2, candidates7d: 1, lastPull: null, lastDelivery: null },
};

describe("the door", () => {
  test("POST only: GET is 405, OPTIONS answers the CORS headers", async () => {
    const door = makeDoor(fakeDeps().deps);
    expect((await door(post({}, SEAT_TOKEN, "GET"))).status).toBe(405);
    const pre = await door(new Request("https://example.test", { method: "OPTIONS" }));
    expect(pre.status).toBe(200);
    expect(pre.headers.get("Access-Control-Allow-Methods")).toBe("POST,OPTIONS");
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("authorization");
  });

  test("no bearer token, or one Auth does not know: 401 Sign in first", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_actor: csmActor } });
    const door = makeDoor(f.deps);
    for (const auth of [null, "Basic abc", "Bearer ", "Bearer someone-else"]) {
      const res = await door(post({ op: "checkin.calls", taskId: "86exCITYW" }, auth));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Sign in first" });
    }
    expect(f.service.calls).toHaveLength(0);
  });

  test("an unknown op is 400 Unknown action., after the seat is known", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_actor: csmActor } });
    const res = await makeDoor(f.deps)(post({ op: "checkin.everything" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown action." });
    expect(f.service.named("cockpit_forms_actor")[0].args).toEqual({ p_actor: csmActor.actorId });
  });

  test("a body that is not JSON is an unknown action, never a crash", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_actor: csmActor } });
    const req = new Request("https://example.test", { method: "POST", headers: { Authorization: SEAT_TOKEN }, body: "{not json" });
    const res = await makeDoor(f.deps)(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown action." });
  });

  test("the seat comes from cockpit_forms_actor: its refusal is 403 with its sentence", async () => {
    const f = fakeDeps({
      rpc: {
        cockpit_forms_actor: () => {
          throw new RpcError("Sign in to the cockpit first.", "42501");
        },
      },
    });
    const res = await makeDoor(f.deps)(post({ op: "checkin.calls", taskId: "86exCITYW" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Sign in to the cockpit first." });
  });

  test("a service-role token runs the doctor and nothing else, and never needs a seat", async () => {
    for (const token of [`Bearer ${SERVICE_KEY}`, `Bearer ${jwt({ role: "service_role", iss: "supabase" })}`]) {
      const f = fakeDeps({ rpc: doctorRpc });
      const door = makeDoor(f.deps);
      const refused = await door(post({ op: "checkin.calls", taskId: "86exCITYW" }, token));
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "The service key runs the doctor only." });
      const doctor = await door(post({ op: "doctor" }, token));
      expect(doctor.status).toBe(200);
      expect((await doctor.json()).ok).toBe(false);
      expect(f.service.named("cockpit_forms_actor")).toHaveLength(0);
    }
  });

  test("an authenticated user's JWT is not mistaken for the service role", () => {
    expect(tokenRole(jwt({ role: "authenticated" }))).toBe("authenticated");
    expect(tokenRole("not-a-jwt")).toBeNull();
    expect(tokenRole("a.%%%.c")).toBeNull();
  });

  test("keys.save and the doctor are the CEO's: 403 for a CSM seat, nothing called", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_actor: csmActor } });
    const door = makeDoor(f.deps);
    const save = await door(post({ op: "keys.save", provider: "fathom", key: "x".repeat(30) }));
    expect(save.status).toBe(403);
    expect(await save.json()).toEqual({ error: "Only the CEO can change the 1-1 notes connections." });
    const doctor = await door(post({ op: "doctor" }));
    expect(doctor.status).toBe(403);
    expect(f.service.calls.map(c => c.name)).toEqual(["cockpit_forms_actor", "cockpit_forms_actor"]);
    expect(f.sent).toHaveLength(0);
  });

  test("the CEO runs the doctor", async () => {
    const f = fakeDeps({ rpc: { ...doctorRpc, cockpit_forms_actor: ceoActor } });
    const res = await makeDoor(f.deps)(post({ op: "doctor" }));
    expect(res.status).toBe(200);
    expect((await res.json()).store.csRecordings24h).toBe(2);
  });

  test("draftAgain refuses the grade and an unknown kind before reading anything", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_actor: csmActor } });
    const door = makeDoor(f.deps);
    const grade = await door(post({ op: "checkin.draftAgain", responseId: "44444444-4444-4444-8444-444444444444", kind: "grade" }));
    expect(grade.status).toBe(400);
    expect(await grade.json()).toEqual({ error: "A call is graded once." });
    const other = await door(post({ op: "checkin.draftAgain", responseId: "44444444-4444-4444-8444-444444444444", kind: "everything" }));
    expect(other.status).toBe(400);
    expect(f.seat.calls).toHaveLength(0);
  });

  test("errors carry one sentence: a gate's, a database refusal's, or a plain one that names nothing inside", async () => {
    expect(answerFor(new DoorError("No transcript yet. Open the call in Fathom.", 404))).toEqual({ status: 404, message: "No transcript yet. Open the call in Fathom." });
    expect(answerFor(new RpcError("That client is not on your access list", "42501"))).toEqual({ status: 403, message: "That client is not on your access list" });
    expect(answerFor(new RpcError("The client roster is incomplete. Refresh its native source", "P0001")).status).toBe(400);
    expect(answerFor(new RpcError("Could not find the function public.cockpit_fathom_match_inputs", "PGRST202"))).toEqual({ status: 404, message: "The cockpit's 1-1 notes are not live yet." });
    const leaky = answerFor(new Error("fetch failed for https://api.fathom.ai with X-Api-Key test-fathom-key-0123456789abcdef"));
    expect(leaky).toEqual({ status: 400, message: "The 1-1 notes could not do that just now. Try again in a minute." });
    expect(answerFor(new RpcError('column "x" does not exist', "42703")).message).not.toContain("column");
    // A unique violation is Postgres's own words, naming a constraint: the plain sentence answers.
    expect(answerFor(new RpcError('duplicate key value violates unique constraint "secrets_name_idx"', "23505"))).toEqual({
      status: 400,
      message: "The 1-1 notes could not do that just now. Try again in a minute.",
    });
  });

  test("a provider failure inside an op reaches the browser as a plain sentence, never its body", async () => {
    const f = fakeDeps({
      rpc: {
        cockpit_forms_actor: csmActor,
        cockpit_csm_client_gate_for_actor: () => {
          throw new Error('{"provider_body":"secret stuff","key":"sk-test-should-not-leak"}');
        },
      },
    });
    const res = await makeDoor(f.deps)(post({ op: "checkin.calls", taskId: "86exCITYW" }));
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("sk-test");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("the door: 2b ops", () => {
  const cron = (body: unknown, secret: string) =>
    new Request("https://example.test/functions/v1/cockpit-forms-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt({ role: "anon" })}`, "x-cron-secret": secret },
      body: JSON.stringify(body),
    });

  test("sameSecret: equal only when every byte is; an empty expected secret matches nothing", () => {
    expect(sameSecret("abc123", "abc123")).toBe(true);
    for (const [a, b] of [["abc123", "abc124"], ["abc12", "abc123"], ["abc1234", "abc123"], ["", ""], ["x", ""], ["", "x"]]) expect(sameSecret(a, b)).toBe(false);
    expect(sameSecret("سر", "سر")).toBe(true);
  });

  test("x-cron-secret is checked before any seat or service key: wrong is 401, another op 403, nothing called", async () => {
    const f = fakeDeps({ env: { NOTICES_CRON_SECRET: "invented-secret-abc" }, rpc: { cockpit_forms_actor: csmActor } });
    const door = makeDoor(f.deps);
    const wrong = await door(cron({ op: "effects.sweep" }, "invented-secret-abd"));
    expect([wrong.status, await wrong.json()]).toEqual([401, { error: "Not allowed." }]);
    const other = await door(cron({ op: "checkin.calls", taskId: "86exCITYW" }, "invented-secret-abc"));
    expect([other.status, await other.json()]).toEqual([403, { error: "The cron secret runs the 1-1 notes sweep only." }]);
    expect(f.service.calls).toEqual([]);
    expect(f.seat.calls).toEqual([]);
  });

  test("recap.approve is a seat op: the seat comes first, the service key never runs it", async () => {
    const f = fakeDeps({ rpc: { cockpit_forms_actor: csmActor } });
    const res = await makeDoor(f.deps)(post({ op: "recap.approve", messageId: "not-a-uuid", body: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Open the recap from the client page." });
    expect(f.service.named("cockpit_forms_actor")).toHaveLength(1);
    const svc = await makeDoor(fakeDeps().deps)(post({ op: "recap.approve" }, `Bearer ${SERVICE_KEY}`));
    expect(svc.status).toBe(403);
  });

  test("the service key runs the doctor and it names NOTICES_CRON_SECRET as a boolean", async () => {
    const f = fakeDeps({ env: { NOTICES_CRON_SECRET: "invented-secret-abc" }, rpc: doctorRpc });
    const res = await makeDoor(f.deps)(post({ op: "doctor" }, `Bearer ${SERVICE_KEY}`));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.secrets).toEqual({ NOTICES_CRON_SECRET: true });
    expect(JSON.stringify(d)).not.toContain("invented-secret-abc");
  });
});
