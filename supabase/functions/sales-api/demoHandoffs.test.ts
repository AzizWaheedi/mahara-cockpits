import { describe, expect, test } from "bun:test";
import { makeDemoHandoffs } from "./demoHandoffs.ts";
import { fakeWorld, fakeUuid } from "./testfakes.ts";
import { GhlError } from "./liveio.ts";
import type { Who } from "./lib.ts";
type Row = Record<string, unknown>;
const now = Date.parse("2026-10-22T14:00:00Z");
const who: Who = {
  signed_in: true,
  seat: true,
  email: "setter@test.invalid",
  ghl_user_id: "u-set",
  role: "setter",
};
function setup() {
  const w = fakeWorld(now),
    remote: Row[] = [],
    marks: Row[] = [];
  w.db.tables.cockpit_sales_people = [
    {
      email: who.email,
      name: "Setter",
      ghl_user_id: "u-set",
      active: true,
      role: "setter",
    },
    {
      email: "closer@test.invalid",
      name: "Closer",
      ghl_user_id: "u-close",
      active: true,
      role: "closer",
    },
  ];
  w.db.tables.cockpit_sales_leads = [
    {
      contact_id: "lead",
      name: "Sample lead",
      tags: [],
      lead_class: "qualified",
    },
  ];
  w.db.tables.cockpit_sales_settings = [
    {
      key: "calendars",
      value: {
        dsqmJ393Dwl9fDSbIVOI: { type: "intro", label: "Intro qualified" },
        jQqXS1YuFnmGZKLkrE62: { type: "demo", label: "Demo" },
      },
    },
  ];
  let lose = false,
    loseBefore = false,
    wrongHost = false,
    markFailed = false;
  w.routes.push(async (method, path, body) => {
    if (method === "GET" && path === "/contacts/lead")
      return { contact: { id: "lead", tags: [] } };
    if (method === "GET" && path === "/contacts/lead/appointments")
      return { events: structuredClone(remote) };
    if (method === "POST" && path === "/calendars/events/appointments") {
      if (loseBefore) throw new GhlError("lost before receipt", 0);
      const row = {
        ...(body as Row),
        id: fakeUuid(),
        dateAdded: new Date(now).toISOString(),
      };
      remote.push(row);
      if (lose) {
        lose = false;
        throw new GhlError("lost after write", 0);
      }
      return row;
    }
    if (path.startsWith("/calendars/events/appointments/")) {
      const row = remote.find(r => r.id === path.split("/").pop());
      if (!row) throw new GhlError("missing", 404);
      if (method === "PUT") Object.assign(row, body);
      return {
        appointment: wrongHost
          ? { ...row, assignedUserId: "wrong" }
          : structuredClone(row),
      };
    }
    return undefined as unknown as Row;
  });
  const mod = makeDemoHandoffs({
    io: w.io,
    locationId: "location",
    audit: async () => {},
    markAppointment: async (_w, id, status, opts) => {
      marks.push({ id, status, ...opts });
      return { crm: markFailed ? "failed" : "quiet", status };
    },
  });
  const b = {
    request_id: fakeUuid(),
    contact_id: "lead",
    host_email: who.email,
    intro_id: null,
    demo_id: null,
    intro_start: "2026-10-22T12:45:00Z",
    demo_start: "2026-10-22T13:00:00Z",
    demo_end: "2026-10-22T13:45:00Z",
    note: "Agreed next step",
  };
  function intro() {
    const row = {
      id: "intro-1",
      contactId: "lead",
      calendarId: "dsqmJ393Dwl9fDSbIVOI",
      assignedUserId: "u-set",
      startTime: b.intro_start,
      appointmentStatus: "showed",
    };
    remote.push(row);
    w.db.tables.cockpit_sales_calendar = [
      {
        appointment_id: "intro-1",
        contact_id: "lead",
        call_type: "intro",
        assigned_user_id: "u-set",
        start_at: b.intro_start,
        status: "showed",
      },
    ];
    return { ...b, intro_id: "intro-1" };
  }
  return {
    ...w,
    remote,
    marks,
    mod,
    b,
    intro,
    lose: () => {
      lose = true;
    },
    loseBefore: () => {
      loseBefore = true;
    },
    wrong: () => {
      wrongHost = true;
    },
    failMark: () => {
      markFailed = true;
    },
  };
}
describe("recording a live demo", () => {
  test("full-cycle setter keeps two distinct calls and both real hosts", async () => {
    const s = setup();
    const out = await s.mod.record(who, s.b);
    expect(out.receipt.state).toBe("recorded");
    expect(s.remote).toHaveLength(2);
    expect(s.remote.map(r => r.assignedUserId)).toEqual(["u-set", "u-set"]);
    expect(s.db.t("cockpit_sales_appointments").map(r => r.call_type)).toEqual([
      "intro",
      "demo",
    ]);
    expect(
      s.remote.every(
        r => r.toNotify === false && r.appointmentStatus === "showed",
      ),
    ).toBe(true);
    expect(s.marks.every(r => r.quiet === true)).toBe(true);
  });
  test("handoff preserves intro owner and credits chosen closer", async () => {
    const s = setup();
    const b = { ...s.intro(), host_email: "closer@test.invalid" };
    await s.mod.record(who, b);
    expect(s.remote).toHaveLength(2);
    expect(s.remote[0]?.assignedUserId).toBe("u-set");
    expect(s.remote[1]?.assignedUserId).toBe("u-close");
    expect(s.db.t("cockpit_sales_demo_handoffs")[0]?.setter_email).toBe(
      who.email,
    );
  });
  test("a receiver can claim their own demo without claiming the setter's credit", async () => {
    const s = setup();
    await s.mod.record(
      {
        ...who,
        email: "closer@test.invalid",
        ghl_user_id: "u-close",
        role: "closer",
      },
      { ...s.intro(), host_email: "closer@test.invalid" },
    );
    expect(s.remote[0]?.assignedUserId).toBe("u-set");
    expect(s.remote[1]?.assignedUserId).toBe("u-close");
  });
  test("a rep cannot put an unrelated rep's intro onto a third person's report", async () => {
    const s = setup();
    await expect(
      s.mod.record(
        { ...who, email: "other@test.invalid", ghl_user_id: "u-other" },
        { ...s.intro(), host_email: "closer@test.invalid" },
      ),
    ).rejects.toThrow("assigned to you");
    expect(s.remote).toHaveLength(1);
  });
  test("repeat press creates no extra calls", async () => {
    const s = setup();
    const a = await s.mod.record(who, s.b);
    const b = await s.mod.record(who, s.b);
    expect(b.receipt.id).toBe(a.receipt.id);
    expect(b.repeated).toBe(true);
    expect(s.remote).toHaveLength(2);
  });
  test("concurrent presses produce one receipt", async () => {
    const s = setup();
    const result = await Promise.allSettled([
      s.mod.record(who, s.b),
      s.mod.record(who, { ...s.b, request_id: fakeUuid() }),
    ]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(s.remote).toHaveLength(2);
  });
  test("lost intro POST answer reconciles exact marker before continuing", async () => {
    const s = setup();
    s.lose();
    await expect(s.mod.record(who, s.b)).rejects.toThrow("saved");
    expect(s.remote).toHaveLength(1);
    await s.mod.record(who, s.b);
    expect(s.remote).toHaveLength(2);
  });
  test("lost demo POST answer never gets hidden by replaying intro", async () => {
    const s = setup();
    const b = s.intro();
    s.lose();
    await expect(s.mod.record(who, b)).rejects.toThrow("saved");
    expect(s.remote).toHaveLength(2);
    await s.mod.record(who, b);
    expect(s.remote).toHaveLength(2);
  });
  test("unknown write with no found record is not sent again", async () => {
    const s = setup();
    s.loseBefore();
    await expect(s.mod.record(who, s.b)).rejects.toThrow("saved");
    await expect(s.mod.record(who, s.b)).rejects.toThrow("uncertain");
    expect(s.ghlCalls.filter(r => r.method === "POST")).toHaveLength(1);
  });
  test("wrong provider assignment is not reported as success", async () => {
    const s = setup();
    s.wrong();
    await expect(s.mod.record(who, s.b)).rejects.toThrow("confirmed");
    expect(s.db.t("cockpit_sales_demo_handoffs")[0]?.state).toBe("uncertain");
    expect(s.db.t("cockpit_sales_appointments")).toHaveLength(0);
  });
  test("existing intro cannot be duplicated as an unscheduled one", async () => {
    const s = setup();
    s.intro();
    await expect(s.mod.record(who, s.b)).rejects.toThrow("Select the intro");
    expect(s.remote).toHaveLength(1);
  });
  test("existing demo is reused, preserving before evidence", async () => {
    const s = setup();
    const b = s.intro();
    s.remote.push({
      id: "demo-1",
      contactId: "lead",
      calendarId: "jQqXS1YuFnmGZKLkrE62",
      assignedUserId: "u-close",
      startTime: "2026-10-22T15:00:00Z",
      appointmentStatus: "confirmed",
    });
    await expect(s.mod.record(who, b)).rejects.toThrow("already has a demo");
    await s.mod.record(who, { ...b, demo_id: "demo-1" });
    expect(s.remote).toHaveLength(2);
    expect(s.remote[1]?.assignedUserId).toBe("u-set");
    expect(
      (s.db.t("cockpit_sales_demo_handoffs")[0]?.before_demo as Row)
        .assignedUserId,
    ).toBe("u-close");
  });
  for (const [name, patch] of Object.entries({
    future: { demo_end: "2026-10-23T14:00:00Z" },
    backwards: { demo_start: "2026-10-22T13:59:00Z" },
    old: { intro_start: "2026-09-01T12:00:00Z" },
    bad: { demo_start: "bad" },
    host: { host_email: "unknown@test.invalid" },
  }))
    test(`invalid ${name} refuses before any write`, async () => {
      const s = setup();
      await expect(s.mod.record(who, { ...s.b, ...patch })).rejects.toThrow();
      expect(s.remote).toHaveLength(0);
      expect(s.db.t("cockpit_sales_demo_handoffs")).toHaveLength(0);
    });
  test("active clients remain outside sales", async () => {
    const s = setup();
    s.db.t("cockpit_sales_leads")[0]!.tags = ["client"];
    await expect(s.mod.record(who, s.b)).rejects.toThrow("active client");
    expect(s.ghlCalls).toHaveLength(0);
  });
  test("a mismatched source intro refuses", async () => {
    const s = setup();
    const b = s.intro();
    s.db.t("cockpit_sales_calendar")[0]!.contact_id = "other";
    await expect(s.mod.record(who, b)).rejects.toThrow("this lead");
    expect(s.remote).toHaveLength(1);
  });
});

test("a changed provider intro is never reassigned or marked by this receipt", async () => {
  const s = setup();
  const b = s.intro();
  s.remote[0]!.assignedUserId = "other";
  await expect(s.mod.record(who, b)).rejects.toThrow("intro changed");
  expect(s.marks).toHaveLength(0);
  expect(s.remote).toHaveLength(1);
});
test("failed intro synchronization does not claim a completed demo", async () => {
  const s = setup();
  const b = s.intro();
  s.failMark();
  await expect(s.mod.record(who, b)).rejects.toThrow("not confirmed");
  expect(s.remote).toHaveLength(1);
  expect(s.db.t("cockpit_sales_demo_handoffs")[0]!.state).toBe("uncertain");
});
test("a second request cannot silently change a recorded host", async () => {
  const s = setup();
  await s.mod.record(who, s.b);
  await expect(
    s.mod.record(who, { ...s.b, host_email: "closer@test.invalid" }),
  ).rejects.toThrow();
  expect(s.remote).toHaveLength(2);
});
test("two concurrent reconcilers cannot post another call", async () => {
  const s = setup();
  s.lose();
  await expect(s.mod.record(who, s.b)).rejects.toThrow();
  const results = await Promise.allSettled([
    s.mod.record(who, s.b),
    s.mod.record(who, s.b),
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(s.remote).toHaveLength(2);
});
