import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  type FakeApp,
  makeApp,
  restoreGlobals,
  setNow,
  web,
} from "./usage/fakeCtx";

const NOW = Date.parse("2026-10-03T08:00:00Z");
const DAY = "2026-10-03";
const LOCATION = "wwG426bwruWWv9W3fazQ";
let app: FakeApp;
let user: string;
let other: string;
let clientId: string;
let posts = 0;
let status = "sent";
let timeout = false;
const client = (taskId: string, name: string) => ({
  taskId,
  name,
  stage: "Active",
  stageRank: 1,
  todo: "Follow up",
  level: "blue",
  rank: 1,
  hot: [],
  loose: [],
  changes: [],
  newSignup: false,
  onboarding: false,
  syncedAt: NOW,
});
const run = (name: string, args = {}, as = user) => app.run(name, args, { as });
beforeEach(async () => {
  setNow(NOW);
  web.clear();
  posts = 0;
  status = "sent";
  timeout = false;
  app = await makeApp(undefined, {
    env: {
      SUPABASE_URL: "https://csm.test",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic",
      GHL_MAHARA_PIT: "synthetic",
      GHL_MAHARA_LOCATION: LOCATION,
    },
  });
  user = await app.makeUser({ email: "seat@example.test" });
  other = await app.makeUser({ email: "other@example.test" });
  app.seed("portalMembers", [
    {
      email: "seat@example.test",
      roles: ["csm"],
      clients: [" Example Design "],
      at: NOW,
    },
    {
      email: "other@example.test",
      roles: ["csm"],
      clients: ["Private Design"],
      at: NOW,
    },
  ]);
  app.seed("clients", [
    client("client-one", "Example Design"),
    client("client-two", "Private Design"),
  ]);
  clientId = (
    await app.inlineRun("query", ctx => ctx.db.query("clients").first())
  )._id;
  const good = {
    id: "thread-one",
    desk: "csm",
    location_id: LOCATION,
    contact_id: "contact-one",
    client_task_id: "client-one",
    last_inbound_at: "2026-10-03T07:00:00Z",
    awaiting_us: true,
  };
  web.on("https://csm.test/", async req => {
    const u = new URL(req.url);
    if (req.method === "PATCH") return new Response(null, { status: 204 });
    if (u.pathname.endsWith("/wa_threads"))
      return u.searchParams.has("id")
        ? [good]
        : [
            good,
            { ...good, id: "private", client_task_id: "client-two" },
            { ...good, id: "personal", client_task_id: null },
            { ...good, id: "wrong-account", location_id: "other-account" },
            { ...good, id: "wrong-desk", desk: "ads" },
          ];
    if (u.pathname.endsWith("/wa_drafts")) {
      expect(u.searchParams.get("thread_id")).toBe('in.("thread-one")');
      return [{ thread_id: "thread-one", en: "Fictional reply" }];
    }
    if (u.pathname.endsWith("/wa_messages"))
      return [
        { thread_id: "thread-one", body: "Fictional client message" },
        { thread_id: "private", body: "Never expose" },
      ];
    if (u.pathname.endsWith("/review_list"))
      return [
        { client_name: "Example Design", token: "ours" },
        { client_name: "Private Design", token: "not-ours" },
        { client_name: null, token: "unlinked" },
      ];
    if (u.pathname.endsWith("/review_imports"))
      return [
        {
          id: 9,
          client_task_id: "client-two",
          client_name: "Private Design",
          token: "not-ours",
        },
      ];
    throw new Error(`Unexpected Supabase request: ${u.pathname}`);
  });
  web.on("https://services.leadconnectorhq.com/", async req => {
    const u = new URL(req.url);
    if (u.pathname === "/contacts/contact-one")
      return {
        contact: {
          id: "contact-one",
          locationId: LOCATION,
          customFields: [{ id: "Csj6vsVH3wSRseT3OkMU", value: "client-one" }],
        },
      };
    if (req.method === "POST") {
      posts++;
      if (timeout) throw new Error("socket closed");
      return { messageId: "message-one" };
    }
    return { message: { status } };
  });
});
afterAll(restoreGlobals);

describe("CSM role and client boundaries", () => {
  test("revocation overrides every authenticated seat, including static allowlisted accounts", async () => {
    const admin = await app.makeUser({ email: "aziz@maharamedia.com" });
    app.seed("portalMembers", [
      {
        email: "aziz@maharamedia.com",
        roles: ["admin"],
        clients: [],
        revokedAt: NOW,
        at: NOW,
      },
    ]);
    expect((await run("roles:me", {}, admin)).roles).toEqual([]);
    expect((await run("roles:me", {}, admin)).isAdmin).toBe(false);
    const endpoints: [string, Record<string, unknown>][] = [
      ["csm:snapshot", {}],
      ["csm:syncStatus", {}],
      ["csm:submitEod", { answers: {}, computed: {} }],
      ["csm:reportIssue", { page: "today", text: "test" }],
      ["wa:inbox", { desk: "csm" }],
      ["review:clients", {}],
      ["review:sent", {}],
      ["billing:sheet", {}],
      ["churn:page", {}],
      ["comms:overview", {}],
      ["hermes:thread", {}],
    ];
    for (const [name, args] of endpoints)
      await expect(run(name, args, admin)).rejects.toThrow();
    expect(app.meter.total.fetches).toBe(0);
  });
  test("a logged-in person without a CSM seat cannot access data", async () => {
    const visitor = await app.makeUser({ email: "visitor@example.test" });
    await expect(run("csm:snapshot", {}, visitor)).rejects.toThrow(/access/);
    await expect(run("wa:inbox", { desk: "csm" }, visitor)).rejects.toThrow(
      /access/,
    );
  });
  test("snapshot scopes counts, decisions, preferences and plans, and hides unlinked shared tasks", async () => {
    app.seed("clientPrefs", [
      { clientName: "Example Design", language: "en" },
      { clientName: "Private Design", language: "ar" },
    ]);
    app.seed(
      "decisions",
      ["Example Design", "Private Design"].map(subject => ({
        day: DAY,
        role: "csm",
        subject,
        action: "call",
        kind: "approved",
        evidence: "",
        at: NOW,
      })),
    );
    app.seed(
      "planItems",
      ["Example Design", "Private Design"].map(clientName => ({
        role: "csm",
        day: DAY,
        clientName,
        text: "Private details",
        confirmed: false,
        createdAt: NOW,
      })),
    );
    app.seed("csTasks", [
      {
        taskId: "shared-task",
        name: "Private Design private task",
        status: "open",
        syncedAt: NOW,
      },
    ]);
    const snap = await run("csm:snapshot");
    expect(snap.clients.map((c: any) => c.taskId)).toEqual(["client-one"]);
    expect(snap.totals.clients).toBe(1);
    expect(snap.decisions).toHaveLength(1);
    expect(snap.prefs).toHaveLength(1);
    expect(snap.plan).toHaveLength(1);
    expect(snap.tasksRestricted).toBe(true);
    expect(snap.tasks).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain("Private Design");
  });
  test("task-ID substitution fails before writing or reading another client's outbox", async () => {
    await expect(
      run("csm:addTask", {
        taskId: "client-two",
        clientName: "Example Design",
        title: "Bad match",
      }),
    ).rejects.toThrow(/not on your list/);
    await expect(
      run("gaps:queue", {
        taskId: "client-two",
        clientName: "Example Design",
        label: "gap",
        fix: "fix",
      }),
    ).rejects.toThrow(/not on your list/);
    await expect(
      run("csm:tasksAdded", { taskId: "client-two" }),
    ).rejects.toThrow(/not on your list/);
    await expect(
      run("csm:act", {
        clientId,
        taskId: "client-two",
        action: "Wrong identity",
        kind: "call",
      }),
    ).rejects.toThrow();
    expect(
      await app.inlineRun("query", ctx => ctx.db.query("outbox").collect()),
    ).toHaveLength(0);
  });
  test("a hot-list key cannot overwrite another client's row", async () => {
    app.seed("hotList", [
      { key: "secret", clientName: "Private Design", type: "Review", at: NOW },
    ]);
    await expect(
      run("csm:saveHotRow", {
        key: "secret",
        clientName: "Example Design",
        type: "Review",
      }),
    ).rejects.toThrow(/not on your list/);
  });
  test("generic assistant questions get only the seat's client context", async () => {
    await run("hermes:send", { text: "What needs attention?" });
    const saved = await app.inlineRun("query", ctx =>
      ctx.db.query("hermesChat").first(),
    );
    expect(saved.context).toContain("Example Design");
    expect(saved.context).not.toContain("Private Design");
  });
  test("calendar rows respect both ownership and client scope; legacy inbox is absent", async () => {
    app.seed("calendarEvents", [
      {
        eventId: "own",
        calendarId: "c",
        title: "Our call",
        clientName: "Example Design",
        start: "2026-10-03T12:00:00Z",
        end: "2026-10-03T12:30:00Z",
        allDay: false,
        attendees: [],
        syncedAt: NOW,
      },
      {
        eventId: "other",
        calendarId: "c",
        title: "Private call",
        clientName: "Private Design",
        start: "2026-10-03T12:00:00Z",
        end: "2026-10-03T12:30:00Z",
        allDay: false,
        attendees: [],
        syncedAt: NOW,
      },
    ]);
    const data = await run("comms:overview");
    expect(data.today).toHaveLength(1);
    expect(data.nextCall).toHaveLength(1);
    expect(data.threads).toEqual([]);
    await expect(
      run("comms:sendReply", { chatId: "legacy", text: "Test" }),
    ).rejects.toThrow(/Meetings/);
  });
});

describe("retries, ownership and provider receipts", () => {
  test("one request produces one decision and one outbox item across retries", async () => {
    const args = {
      clientId,
      taskId: "client-one",
      requestId: "request-001",
      action: "Held a call",
      kind: "call",
    };
    await Promise.all([run("csm:act", args), run("csm:act", args)]);
    expect(
      await app.inlineRun("query", ctx => ctx.db.query("outbox").collect()),
    ).toHaveLength(1);
    await expect(
      run("csm:act", { ...args, action: "Changed" }),
    ).rejects.toThrow(/changed/);
  });
  test("EOD reports belong to the author, identical resubmission schedules only once", async () => {
    const args = {
      answers: { rollup: "Example report" },
      computed: { calls: 1 },
    };
    await run("csm:submitEod", args);
    await run("csm:submitEod", args);
    await run(
      "csm:submitEod",
      { answers: { rollup: "Other report" }, computed: {} },
      other,
    );
    const reports = await app.inlineRun("query", ctx =>
      ctx.db.query("eodReports").collect(),
    );
    expect(reports).toHaveLength(2);
    expect((await run("csm:snapshot")).eod.answers.rollup).toBe(
      "Example report",
    );
    expect(app.meter.total.scheduled).toBe(2);
  });
  test("client messages exclude personal, wrong-account, wrong-desk and out-of-scope threads", async () => {
    const data = await run("wa:inbox", { desk: "csm" });
    expect(data.threads.map((t: any) => t.id)).toEqual(["thread-one"]);
    expect(JSON.stringify(data)).not.toContain("Never expose");
    await expect(run("wa:inbox", { desk: "ads" })).rejects.toThrow(/only open/);
    await expect(
      run("wa:assign", { threadId: "thread-one", desk: "ads" }),
    ).rejects.toThrow(/admin/);
  });
  test("repeat reply clicks never send twice and pending is not reported as delivered", async () => {
    status = "pending";
    const a = {
      threadId: "thread-one",
      desk: "csm",
      body: "Fictional approved reply",
      lang: "en",
    };
    const first = await run("wa:send", a);
    const retry = await run("wa:send", a);
    expect(first.sent).toBe(false);
    expect(first.status).toBe("accepted");
    expect(retry.duplicate).toBe(true);
    expect(posts).toBe(1);
  });
  test("uncertain WhatsApp send has a durable receipt and blocks another POST", async () => {
    timeout = true;
    const a = {
      threadId: "thread-one",
      desk: "csm",
      body: "Fictional reply",
      lang: "en",
    };
    await expect(run("wa:send", a)).rejects.toThrow(/needs checking/);
    timeout = false;
    expect((await run("wa:send", a)).status).toBe("unknown");
    expect(posts).toBe(1);
  });
  test("review lists and imports cannot expose another client's links", async () => {
    expect((await run("review:clients")).map((r: any) => r.task_id)).toEqual([
      "client-one",
    ]);
    expect((await run("review:sent")).map((r: any) => r.token)).toEqual([
      "ours",
    ]);
    await expect(run("review:importStatus", { id: 9 })).rejects.toThrow(
      /not for one/,
    );
    await expect(
      run("review:create", {
        client: "Private Design",
        title: "Bad",
        videos: [{ url: "https://example.test/video.mp4" }],
      }),
    ).rejects.toThrow(/Select one/);
  });
});

test("a partial opportunity edit does not undo a closed win", async () => {
  app.seed("hotList", [
    {
      key: "won",
      clientName: "Example Design",
      type: "Review",
      status: "Closed",
      at: NOW,
    },
  ]);
  await run("csm:saveHotRow", {
    key: "won",
    clientName: "Example Design",
    type: "Review",
    notes: "New note",
  });
  expect(
    (await app.inlineRun("query", ctx => ctx.db.query("hotList").first()))
      .status,
  ).toBe("Closed");
  expect(
    await app.inlineRun("query", ctx => ctx.db.query("decisions").collect()),
  ).toHaveLength(0);
});
test("missing EOD identity saves an actionable error and does not send under another person", async () => {
  await run("csm:submitEod", {
    energy: "8",
    stress: "3",
    answers: { rollup: "Fictional report" },
    computed: {},
  });
  await app.flushScheduled(NOW);
  const row = await app.inlineRun("query", ctx =>
    ctx.db.query("eodReports").first(),
  );
  expect(row.energy).toBe("8");
  expect(row.exportError).toContain("connect your email");
  expect(app.meter.total.fetches).toBe(0);
});
test("changed reply text cannot send a second message for the same inbound", async () => {
  const args = {
    threadId: "thread-one",
    desk: "csm",
    body: "First reply",
    lang: "en",
  };
  await run("wa:send", args);
  await expect(
    run("wa:send", { ...args, body: "Another reply" }),
  ).rejects.toThrow(/already recorded/);
  expect(posts).toBe(1);
});
test("scoped retention reports exclude other clients and global manual counts", async () => {
  web.clear();
  web.on("https://csm.test/", req => {
    const p = new URL(req.url).pathname;
    if (p.endsWith("cockpit_churn_departures"))
      return [
        {
          id: 1,
          client: "Example Design",
          clickup_task_id: "client-one",
          left_on: DAY,
          launched_on: "2026-09-01",
          reason: "Cancelled",
          mrr_lost_usd: 500,
        },
        {
          id: 2,
          client: "Private Design",
          clickup_task_id: "client-two",
          left_on: DAY,
          launched_on: "2026-09-01",
          reason: "Cancelled",
          mrr_lost_usd: 9999,
        },
      ];
    if (p.endsWith("cockpit_churn_months"))
      return [{ month: "2026-10", active_at_start: 999, new_clients: 100 }];
    if (p.endsWith("cockpit_billing_accounts"))
      return [
        { clickup_task_id: "client-one", client_name: "Example Design" },
        { clickup_task_id: "client-two", client_name: "Private Design" },
      ];
    if (p.endsWith("cockpit_churn_log"))
      return [{ detail: { secret: "Private Design" } }];
    throw new Error("Unexpected path");
  });
  const page = await run("churn:page");
  expect(page.me.canEditMonths).toBe(false);
  expect(JSON.stringify(page)).not.toContain("Private Design");
  expect(JSON.stringify(page)).not.toContain("999");
  await expect(
    run("churn:saveMonth", { month: "2026-10", activeAtStart: 2 }),
  ).rejects.toThrow(/assigned|global|whole|all clients/i);
});
