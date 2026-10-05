import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  type FakeApp,
  makeApp,
  restoreGlobals,
  setNow,
  web,
} from "./usage/fakeCtx";

const NOW = Date.parse("2026-10-03T08:00:00Z");
const LOCATION = "wwG426bwruWWv9W3fazQ";
const CALENDAR = "SHjlq0UjeR11maltYNyh";
const FIELD = "Csj6vsVH3wSRseT3OkMU";
const TASK = "client-task-1";
const SLOT = "2026-10-04T13:00:00+03:00";
let app: FakeApp;
let user: string;
let contacts: any[];
let slots: string[];
let posts: any[];
let outcome: "ok" | "timeout" | "refused" | "incomplete";

beforeEach(async () => {
  setNow(NOW);
  web.clear();
  app = await makeApp(undefined, {
    env: { GHL_MAHARA_PIT: "synthetic", GHL_MAHARA_LOCATION: LOCATION },
  });
  user = await app.makeUser({ email: "csm@example.test" });
  app.seed("portalMembers", [
    {
      email: "csm@example.test",
      roles: ["csm"],
      clients: ["Example Design"],
      at: NOW,
    },
  ]);
  app.seed("clients", [
    {
      taskId: TASK,
      name: "Example Design",
      stage: "Active",
      stageRank: 1,
      todo: "",
      level: "blue",
      rank: 1,
      hot: [],
      loose: [],
      changes: [],
      newSignup: false,
      onboarding: false,
      syncedAt: NOW,
    },
  ]);
  contacts = [
    {
      id: "contact-1",
      locationId: LOCATION,
      firstName: "Example",
      lastName: "Owner",
      customFields: [{ id: FIELD, value: TASK }],
    },
  ];
  slots = [SLOT];
  posts = [];
  outcome = "ok";
  web.on("https://services.leadconnectorhq.com/", async req => {
    const url = new URL(req.url);
    if (url.pathname === "/contacts/search") {
      const body = await req.json();
      expect(body.locationId).toBe(LOCATION);
      expect(body.filters).toEqual([
        { field: `customFields.${FIELD}`, operator: "eq", value: TASK },
      ]);
      return { contacts, total: contacts.length };
    }
    if (url.pathname === `/calendars/${CALENDAR}`)
      return {
        calendar: {
          id: CALENDAR,
          locationId: LOCATION,
          name: "Client check-in",
          isActive: true,
          slotDuration: 30,
          slotDurationUnit: "mins",
        },
      };
    if (url.pathname.endsWith("/free-slots"))
      return { "2026-10-04": { slots } };
    if (url.pathname === "/calendars/events/appointments") {
      const body = await req.json();
      posts.push(body);
      if (outcome === "timeout") throw new Error("socket closed after send");
      if (outcome === "refused") return new Response("busy", { status: 409 });
      if (outcome === "incomplete") return { id: "appointment-1" };
      return { ...body, id: "appointment-1" };
    }
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  });
});
afterAll(restoreGlobals);
const prepare = () =>
  app.run(
    "checkIns:prepare",
    { taskId: TASK, day: "2026-10-04" },
    { as: user },
  );
const book = () =>
  app.run(
    "checkIns:book",
    { taskId: TASK, contactId: "contact-1", startTime: SLOT },
    { as: user },
  );

describe("check-in contact and availability", () => {
  test("finds the exact Client ID and works with no renewal date", async () => {
    const ready = await prepare();
    expect(ready.contact).toEqual({ id: "contact-1", name: "Example Owner" });
    expect(ready.slots).toEqual([SLOT]);
    expect(posts).toHaveLength(0);
  });
  test("missing and duplicate contacts cannot be booked", async () => {
    contacts = [];
    await expect(prepare()).rejects.toThrow(/No contact/);
    contacts = [
      { id: "a", locationId: LOCATION },
      { id: "b", locationId: LOCATION },
    ];
    await expect(book()).rejects.toThrow(/one contact/);
    expect(posts).toHaveLength(0);
  });
  test("ignoring the ID filter or returning another location cannot book", async () => {
    contacts[0].customFields[0].value = "another-client";
    await expect(book()).rejects.toThrow(/one contact/);
    contacts[0].customFields[0].value = TASK;
    contacts[0].locationId = "other-account";
    await expect(book()).rejects.toThrow(/one contact/);
    expect(posts).toHaveLength(0);
  });
  test("does not expose contact information without client access", async () => {
    await expect(
      app.run("checkIns:prepare", { taskId: TASK, day: "2026-10-04" }),
    ).rejects.toThrow(/authenticated/i);
    await app.inlineRun("mutation", async ctx => {
      const member = await ctx.db.query("portalMembers").first();
      await ctx.db.patch(member._id, { clients: ["Different Client"] });
    });
    await expect(prepare()).rejects.toThrow(/not on your list/);
    expect(app.meter.total.fetches).toBe(0);
  });
  test("revoked CSM access cannot book", async () => {
    await app.inlineRun("mutation", async ctx => {
      const member = await ctx.db.query("portalMembers").first();
      await ctx.db.patch(member._id, { revokedAt: NOW });
    });
    await expect(book()).rejects.toThrow(/access has ended/);
    expect(posts).toHaveLength(0);
  });
  test("empty availability and stale selected time do not create appointments", async () => {
    slots = [];
    expect((await prepare()).slots).toEqual([]);
    await expect(book()).rejects.toThrow(/no longer available/);
    expect(posts).toHaveLength(0);
  });
  test("invalid dates and changed contacts fail before a write", async () => {
    await expect(
      app.run(
        "checkIns:prepare",
        { taskId: TASK, day: "2026-02-31" },
        { as: user },
      ),
    ).rejects.toThrow(/Choose a day/);
    contacts[0].id = "contact-changed";
    await expect(book()).rejects.toThrow(/linked contact changed/);
    expect(posts).toHaveLength(0);
  });
});

describe("confirmed booking, receipts and retry protection", () => {
  test("records the provider receipt, next call and ClickUp outbox atomically", async () => {
    expect(await book()).toEqual({
      appointmentId: "appointment-1",
      startTime: "2026-10-04T10:00:00.000Z",
    });
    expect(posts[0]).toMatchObject({
      calendarId: CALENDAR,
      locationId: LOCATION,
      contactId: "contact-1",
      ignoreFreeSlotValidation: false,
      ignoreDateRange: false,
      toNotify: true,
      endTime: "2026-10-04T10:30:00.000Z",
    });
    const state = await app.inlineRun("query", async ctx => ({
      bookings: await ctx.db.query("checkInBookings").collect(),
      appointments: await ctx.db.query("appointments").collect(),
      outbox: await ctx.db.query("outbox").collect(),
      client: await ctx.db.query("clients").first(),
    }));
    expect(state.bookings[0].status).toBe("confirmed");
    expect(state.appointments).toHaveLength(1);
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0].clientTaskId).toBe(TASK);
    expect(state.client.nextCallAt).toBe("2026-10-04T10:00:00.000Z");
    expect(state.client.nextPoc).toBe("2026-10-04");
  });
  test("concurrent clicks and repeated requests create only one appointment", async () => {
    await Promise.allSettled([book(), book()]);
    slots = []; // Provider removes the booked slot from future availability.
    await book();
    expect(posts).toHaveLength(1);
    expect(
      await app.inlineRun("query", ctx => ctx.db.query("outbox").collect()),
    ).toHaveLength(1);
  });
  test("a timeout keeps an unknown receipt and blocks automatic retry", async () => {
    outcome = "timeout";
    await expect(book()).rejects.toThrow(/Check the calendar/);
    outcome = "ok";
    await expect(book()).rejects.toThrow(/already being checked/);
    expect(posts).toHaveLength(1);
    expect(
      (
        await app.inlineRun("query", ctx =>
          ctx.db.query("checkInBookings").first(),
        )
      ).status,
    ).toBe("unknown");
  });
  test("an incomplete provider response cannot report success or retry", async () => {
    outcome = "incomplete";
    await expect(book()).rejects.toThrow(/result needs checking/);
    await expect(book()).rejects.toThrow(/already being checked/);
    expect(posts).toHaveLength(1);
    expect(
      await app.inlineRun("query", ctx =>
        ctx.db.query("appointments").collect(),
      ),
    ).toHaveLength(0);
  });
  test("a definitive provider refusal allows another checked attempt", async () => {
    outcome = "refused";
    await expect(book()).rejects.toThrow(/no longer available/);
    outcome = "ok";
    await book();
    expect(posts).toHaveLength(2);
  });
  test("a later booking preserves an earlier upcoming call", async () => {
    await app.inlineRun("mutation", async ctx => {
      const c = await ctx.db.query("clients").first();
      await ctx.db.patch(c._id, {
        nextCallAt: "2026-10-04T08:00:00.000Z",
        nextPoc: "2026-10-04",
      });
    });
    await book();
    expect(
      (await app.inlineRun("query", ctx => ctx.db.query("clients").first()))
        .nextCallAt,
    ).toBe("2026-10-04T08:00:00.000Z");
    expect(
      await app.inlineRun("query", ctx => ctx.db.query("outbox").collect()),
    ).toHaveLength(0);
  });
});
