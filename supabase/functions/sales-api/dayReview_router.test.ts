// The real authenticated sales-api door, with fictional storage and no network.
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { FakeDb } from "./testfakes.ts";
import { EOD_FIELDS, eodDay } from "./lib.ts";
type Row = Record<string, unknown>;
const DB = "https://review.invalid",
  db = new FakeDb({
    get now() {
      return Date.now();
    },
  });
const seat = {
  signed_in: true,
  seat: true,
  email: "setter@test.invalid",
  role: "setter",
  ghl_user_id: "u-me",
};
const day = eodDay(Date.now()),
  start = `${day}T09:00:00+03:00`;
let handler: (r: Request) => Promise<Response>;
const commits: Row[] = [];
const reply = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json" },
  });
beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: {
      get: (k: string) =>
        ({
          SUPABASE_URL: DB,
          SUPABASE_SERVICE_ROLE_KEY: "test-service",
          SUPABASE_ANON_KEY: "test-anon",
        })[k],
    },
    serve: (h: typeof handler) => {
      handler = h;
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input),
      body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.endsWith("/rpc/cockpit_sales_whoami"))
      return new Headers(init.headers).get("authorization") === "Bearer seat"
        ? reply(seat)
        : reply({ message: "invalid" }, 401);
    if (url.endsWith("/rpc/cockpit_sales_submit_reviewed_eod")) {
      commits.push(body);
      return reply({
        eod: { id: "eod", answers: body.p_answers, computed: body.p_computed },
        outbox: { status: "queued" },
      });
    }
    if (!url.startsWith(`${DB}/rest/v1/`))
      throw new Error("Unexpected network call " + url);
    return reply(
      await db.db(url.slice(`${DB}/rest/v1/`.length), {
        method: init.method ?? "GET",
        body,
        prefer: new Headers(init.headers).get("prefer") ?? "",
      }),
    );
  };
  await import("./index.ts?day_review_router");
});
beforeEach(() => {
  commits.length = 0;
  db.tables = {};
  db.seed("cockpit_sales_people", [
    { ...seat, active: true, name: "Sample Rep" },
  ]);
  db.seed("cockpit_sales_calendar", [
    {
      appointment_id: "intro",
      contact_id: "lead",
      call_type: "intro",
      start_at: start,
      booked_at: start,
      assigned_user_id: "u-me",
      status: "showed",
      lead_quality: 7,
      no_demo_reason: "not_ready",
    },
    {
      appointment_id: "demo",
      contact_id: "lead",
      call_type: "demo",
      start_at: start,
      booked_at: start,
      assigned_user_id: "u-me",
      status: "confirmed",
      lead_quality: 8,
    },
    {
      appointment_id: "other",
      contact_id: "other",
      call_type: "intro",
      start_at: start,
      assigned_user_id: "u-other",
      status: "confirmed",
    },
    {
      appointment_id: "tomorrow",
      call_type: "demo",
      start_at: new Date(Date.now() + 86400000).toISOString(),
      assigned_user_id: "u-me",
      status: "confirmed",
    },
  ]);
});
async function call(b: Row, token = "seat") {
  const r = await handler(
    new Request("https://fn.invalid/sales-api", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(b),
    }),
  );
  return { status: r.status, body: await r.json() };
}
const answers = () =>
  Object.fromEntries(
    EOD_FIELDS.closer.map(f => [f.key, f.kind === "text" ? "Reviewed" : 0]),
  );
async function version() {
  return (await call({ action: "eod.prefill", day, role: "closer" })).body
    .review.version;
}
test("a setter can review both intro and demo calls and file a closer report", async () => {
  const out = await call({ action: "eod.prefill", day, role: "closer" });
  expect(out.status).toBe(200);
  expect(out.body.roles).toEqual(["setter", "closer"]);
  expect(out.body.review.calls.map((r: Row) => r.appointment_id)).toEqual([
    "intro",
    "demo",
  ]);
  expect(out.body.review.pending).toBe(1);
  expect(out.body.computed.demos_showed).toBe(0);
});
test("a held call waits on the lead's quality, and a held intro on why no demo", async () => {
  db.t("cockpit_sales_calendar")[1]!.status = "showed";
  const intro = db.t("cockpit_sales_calendar")[0]!;
  intro.lead_quality = null;
  let out = await call({ action: "eod.prefill", day, role: "closer" });
  expect(out.body.review.pending).toBe(1);
  intro.lead_quality = 6;
  intro.no_demo_reason = null;
  out = await call({ action: "eod.prefill", day, role: "closer" });
  expect(out.body.review.pending).toBe(1);
  const blocked = await call({
    action: "eod.submit",
    day,
    role: "closer",
    answers: answers(),
    review_version: out.body.review.version,
  });
  expect(blocked.status).toBe(409);
  expect(commits).toHaveLength(0);
  // A demo booked after the intro, or a signature, is the answer itself.
  intro.demo_after_at = start;
  out = await call({ action: "eod.prefill", day, role: "closer" });
  expect(out.body.review.pending).toBe(0);
  intro.demo_after_at = null;
  intro.signed_after = true;
  out = await call({ action: "eod.prefill", day, role: "closer" });
  expect(out.body.review.pending).toBe(0);
});
test("pending calls block before the outgoing transaction even with a forged version", async () => {
  const out = await call({
    action: "eod.submit",
    day,
    role: "closer",
    answers: answers(),
    review_version: "anything",
  });
  expect(out.status).toBe(409);
  expect(out.body.error).toContain("Review 1 call");
  expect(commits).toHaveLength(0);
});
test("a changed outcome requires reviewing the refreshed totals", async () => {
  const old = await version();
  db.t("cockpit_sales_calendar")[1]!.status = "showed";
  const out = await call({
    action: "eod.submit",
    day,
    role: "closer",
    answers: answers(),
    review_version: old,
  });
  expect(out.status).toBe(409);
  expect(commits).toHaveLength(0);
});
test("manual correction and computed totals are sent separately in one transaction", async () => {
  db.t("cockpit_sales_calendar")[1]!.status = "showed";
  const out = await call({
    action: "eod.submit",
    day,
    role: "closer",
    answers: { ...answers(), demos_showed: 3 },
    review_version: await version(),
    email: "someone-else@test.invalid",
  });
  expect(out.status).toBe(200);
  expect(commits).toHaveLength(1);
  expect(commits[0]!.p_email).toBe(seat.email);
  expect((commits[0]!.p_answers as Row).demos_showed).toBe(3);
  expect((commits[0]!.p_computed as Row).demos_showed).toBe(1);
  expect(commits[0]!.p_review_rows as Row[]).toHaveLength(2);
});
test("new callback after the review blocks filing", async () => {
  db.t("cockpit_sales_calendar")[1]!.status = "showed";
  const prior = await version();
  db.t("cockpit_sales_calendar").push({
    appointment_id: "callback",
    call_type: "callback",
    start_at: start,
    assigned_user_id: "u-me",
    status: "new",
  });
  expect(
    (
      await call({
        action: "eod.submit",
        day,
        role: "closer",
        answers: answers(),
        review_version: prior,
      })
    ).status,
  ).toBe(409);
  expect(commits).toHaveLength(0);
});
test("an invalid seat cannot read or submit the report", async () => {
  expect((await call({ action: "eod.prefill", day }, "missing")).status).toBe(
    401,
  );
  expect(commits).toHaveLength(0);
});
test("a stale profile stage refuses before touching HighLevel", async () => {
  db.seed("cockpit_sales_leads", [
    { contact_id: "lead", stage_id: "new-stage", tags: [] },
  ]);
  const r = await call({
    action: "pipeline.move",
    contact_id: "lead",
    stage_id: "target",
    expected_stage_id: "old-stage",
  });
  expect(r.status).toBe(409);
  expect(r.body.error).toContain("pipeline changed");
});

test("a recorded handoff credits its original setter, not every past intro owner", async () => {
  db.seed("cockpit_sales_demo_handoffs", [
    {
      demo_id: "demo",
      day,
      state: "recorded",
      setter_email: "another@test.invalid",
    },
  ]);
  const r = await call({ action: "eod.prefill", day, role: "setter" });
  expect(r.status).toBe(200);
  expect(r.body.computed.demos_booked).toBe(0);
  db.t("cockpit_sales_demo_handoffs")[0]!.setter_email = seat.email;
  expect(
    (await call({ action: "eod.prefill", day, role: "setter" })).body.computed
      .demos_booked,
  ).toBe(1);
});
