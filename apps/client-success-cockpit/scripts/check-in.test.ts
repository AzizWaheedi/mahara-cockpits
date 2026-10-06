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
/** The four calls' calendars and lengths, as the client account has them. */
const CALENDARS: Record<string, { name: string; minutes: number }> = {
  z1Ne59rohCCj87KhcXoi: { name: "Onboarding Call", minutes: 60 },
  x84ET6KnA8odlsjYiVLq: { name: "Brand Blueprint Call", minutes: 45 },
  "5E1EVxLJbGiDM3iYl2kL": { name: "Launch Call", minutes: 30 },
  SHjlq0UjeR11maltYNyh: { name: "Client check-in", minutes: 30 },
};
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
    const cal = /^\/calendars\/([^/]+)$/.exec(url.pathname)?.[1];
    if (cal && cal in CALENDARS)
      return {
        calendar: {
          id: cal,
          locationId: LOCATION,
          name: CALENDARS[cal].name,
          isActive: true,
          slotDuration: CALENDARS[cal].minutes,
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
      return { ...body, id: `appointment-${posts.length}` };
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
    expect(ready.contact).toEqual({
      id: "contact-1",
      name: "Example Owner",
      phone: null,
      email: null,
      url: `https://app.maharamedia.com/v2/location/${LOCATION}/contacts/detail/contact-1`,
    });
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

const bookKind = (kind: string, startTime = SLOT) =>
  app.run(
    "checkIns:book",
    { taskId: TASK, contactId: "contact-1", startTime, kind },
    { as: user },
  );
const setStage = (stage: string) =>
  app.inlineRun("mutation", async ctx => {
    const c = await ctx.db.query("clients").first();
    await ctx.db.patch(c._id, { stage });
  });

describe("every call type (2026-10-06)", () => {
  test("each call books on its own calendar, length and title", async () => {
    const want = {
      onboarding: [
        "z1Ne59rohCCj87KhcXoi",
        "2026-10-04T11:00:00.000Z",
        "Onboarding call",
      ],
      blueprint: [
        "x84ET6KnA8odlsjYiVLq",
        "2026-10-04T10:45:00.000Z",
        "Brand Blueprint call",
      ],
      launch: [
        "5E1EVxLJbGiDM3iYl2kL",
        "2026-10-04T10:30:00.000Z",
        "Launch call",
      ],
    } as const;
    for (const [kind, [calendarId, endTime, label]] of Object.entries(want)) {
      await bookKind(kind);
      expect(posts.at(-1)).toMatchObject({
        calendarId,
        endTime,
        title: `Example Design | ${label}`,
        contactId: "contact-1",
        locationId: LOCATION,
      });
    }
    const appointments = await app.inlineRun("query", ctx =>
      ctx.db.query("appointments").collect(),
    );
    expect(appointments.map((a: { kind: string }) => a.kind).sort()).toEqual([
      "blueprint",
      "launch",
      "onboarding",
    ]);
  });

  test("a receipt belongs to its call: a Blueprint and a check-in at the same time do not collide", async () => {
    await book();
    await bookKind("blueprint");
    expect(posts).toHaveLength(2);
    const keys = (
      await app.inlineRun("query", ctx =>
        ctx.db.query("checkInBookings").collect(),
      )
    ).map((b: { key: string }) => b.key);
    expect(keys).toContain(`${TASK}|2026-10-04T10:00:00.000Z`);
    expect(keys).toContain(`${TASK}|blueprint|2026-10-04T10:00:00.000Z`);
  });

  test("a booking moves the board forward, never back", async () => {
    await setStage("Needs Contacting");
    const first = await bookKind("onboarding");
    expect(first.stage).toBe("Onboarding Booked");
    let state = await app.inlineRun("query", async ctx => ({
      client: await ctx.db.query("clients").first(),
      outbox: await ctx.db.query("outbox").collect(),
    }));
    expect(state.client.stage).toBe("Onboarding Booked");
    expect(
      state.outbox.find((o: { kind: string }) => o.kind === "stage")?.value,
    ).toBe("Onboarding Booked");

    // An onboarding call booked again later does not pull a Blueprint client back.
    await setStage("Brand Blueprint Booked\u2660\ufe0f");
    slots = ["2026-10-04T15:00:00+03:00"];
    const again = await bookKind("onboarding", "2026-10-04T15:00:00+03:00");
    expect(again.stage).toBeUndefined();
    state = await app.inlineRun("query", async ctx => ({
      client: await ctx.db.query("clients").first(),
      outbox: await ctx.db.query("outbox").collect(),
    }));
    expect(state.client.stage).toBe("Brand Blueprint Booked\u2660\ufe0f");
    expect(
      state.outbox.filter((o: { kind: string }) => o.kind === "stage"),
    ).toHaveLength(1);
  });

  test("a check-in never moves the board, and a live client stays live", async () => {
    await book();
    await setStage("Active");
    slots = ["2026-10-04T16:00:00+03:00"];
    const r = await bookKind("launch", "2026-10-04T16:00:00+03:00");
    expect(r.stage).toBeUndefined();
    const outbox = await app.inlineRun("query", ctx =>
      ctx.db.query("outbox").collect(),
    );
    expect(
      outbox.filter((o: { kind: string }) => o.kind === "stage"),
    ).toHaveLength(0);
  });

  test("the main contact is read for the client, inside the CSM's scope only", async () => {
    // HighLevel's contactName is lower case; the name fields win.
    contacts[0].contactName = "example owner";
    contacts[0].phone = "+96550000000";
    contacts[0].email = "owner@example.test";
    const c = await app.run("checkIns:contact", { taskId: TASK }, { as: user });
    expect(c).toMatchObject({
      id: "contact-1",
      name: "Example Owner",
      phone: "+96550000000",
      email: "owner@example.test",
    });
    await app.inlineRun("mutation", async ctx => {
      const member = await ctx.db.query("portalMembers").first();
      await ctx.db.patch(member._id, { clients: ["Different Client"] });
    });
    await expect(
      app.run("checkIns:contact", { taskId: TASK }, { as: user }),
    ).rejects.toThrow(/not on your list/);
  });

  test("an unknown call cannot be booked", async () => {
    await expect(bookKind("strategy")).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });
});
