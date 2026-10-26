import { describe, expect, test } from "bun:test";
import { importTask } from "./clickup";
import { runSeats, SEAT_PAGES } from "./seats";
import { cuTask, kit, NOW } from "./testkit";

const SM = 113459516;
const CSM = 113688800;
const REQUEST_TYPE = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e";

function linked(k: ReturnType<typeof kit>, seats: { memberId: string; clickupUserId: number; label: string }[]) {
  k.db.handlers.cockpit_task_mirror_inputs = () => ({ cursorMs: null, baselinedAt: null, linked: seats, notLinked: 0 });
}
const formTicket = (id: string, value: unknown, extra: Record<string, unknown> = {}) =>
  cuTask(id, {
    name: `Form Submission - #${id}`,
    list: { id: "901816723226", name: "All Tasks" },
    tags: [{ name: "acme interiors" }],
    text_content: "Please offboard them",
    custom_fields: [
      {
        id: REQUEST_TYPE,
        type: "drop_down",
        value,
        type_config: { options: [{ id: "8c5d4f0e-0000-4000-8000-000000000001", name: "Client Offboarding Request 🔴", orderindex: 10 }] },
      },
    ],
    ...extra,
  });

describe("the seats job", () => {
  test("members, fields, templates, every linked seat in full, the old form's tickets, then one complete state row", async () => {
    const k = kit();
    k.clickup.members = [
      { user: { id: SM, username: "huda", email: "sm@tests.invalid" } },
      { user: { id: CSM, username: "noura", email: "CSM@tests.invalid" } },
    ];
    k.clickup.fields = [
      { id: REQUEST_TYPE, name: "Request Type", type: "drop_down", type_config: { options: [{ id: "o1", name: "One", orderindex: 0 }] } },
      { id: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", name: "ADs Platform", type: "drop_down", type_config: { options: [{ id: "p1", label: "Meta" }] } },
      { id: "f3", name: "Notes", type: "text" },
    ];
    k.clickup.templates = [
      [{ id: "t-86ex09tmh", name: "Connecting a new lead form" }],
      [{ id: "t-86ex09vmq", name: "Missing Leads ❌" }],
      [],
    ];
    linked(k, [
      { memberId: "m-sm", clickupUserId: SM, label: "the systems manager" },
      { memberId: "m-csm", clickupUserId: CSM, label: "the CSM" },
      { memberId: "m-csm-2", clickupUserId: CSM, label: "the CSM" },
    ]);
    k.clickup.byAssignee.set(SM, Array.from({ length: 130 }, (_, i) => cuTask(`sm${i}`, { assignees: [{ id: SM }] })));
    k.clickup.byAssignee.set(CSM, [cuTask("csm1", { assignees: [{ id: CSM }] })]);
    k.clickup.allTasks = [
      formTicket("ft1", 10),
      formTicket("ft2", "8c5d4f0e-0000-4000-8000-000000000001"),
      formTicket("ft3", null),
      formTicket("ft4", 10, { status: { status: "complete", type: "done" } }),
      cuTask("other1", { name: "Something else", list: { id: "901816723226" } }),
    ];
    const r = await runSeats(k.deps);
    expect(r).toMatchObject({ ok: true, complete: true, linked: 3, seats: 3, members: 2, fields: 3, templates: 2, imported: 2 });
    expect(k.db.of("cockpit_clickup_members_sync")[0].args.p_members).toEqual([
      { id: String(SM), username: "huda", email: "sm@tests.invalid" },
      { id: String(CSM), username: "noura", email: "CSM@tests.invalid" },
    ]);
    expect(k.db.of("cockpit_request_field_catalog_sync")[0].args.p_fields).toEqual([
      { id: REQUEST_TYPE, name: "Request Type", type: "drop_down", options: [{ id: "o1", name: "One" }] },
      { id: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9", name: "ADs Platform", type: "drop_down", options: [{ id: "p1", name: "Meta" }] },
      { id: "f3", name: "Notes", type: "text", options: null },
    ]);
    expect(k.db.of("cockpit_request_templates_sync")[0].args.p_templates).toEqual([
      { id: "t-86ex09tmh", name: "Connecting a new lead form" },
      { id: "t-86ex09vmq", name: "Missing Leads ❌" },
    ]);
    // One read per ClickUp user, even when two seats share one; every page; then who holds what.
    const seatReads = k.clickup.calls.filter(c => c.path === "team/90182518398/task");
    expect(seatReads.map(c => [c.query.get("assignees[]"), c.query.get("page"), c.query.get("include_closed"), c.query.get("subtasks")])).toEqual([
      [String(SM), "0", "false", "true"],
      [String(SM), "1", "false", "true"],
      [String(CSM), "0", "false", "true"],
    ]);
    expect(k.db.of("cockpit_task_mirror_upsert").map(c => [(c.args.p_tasks as unknown[]).length, c.args.p_source])).toEqual([
      [100, "seat"],
      [30, "seat"],
      [1, "seat"],
    ]);
    expect(k.db.of("cockpit_task_mirror_seat").map(c => [c.args.p_clickup_user_id, (c.args.p_task_ids as string[]).length])).toEqual([
      [SM, 130],
      [CSM, 1],
    ]);
    // The old form's open tickets with a Request Type, by option id.
    const imported = k.db.of("cockpit_request_import")[0].args.p_tasks as Record<string, unknown>[];
    expect(imported.map(t => [t.taskId, t.optionId])).toEqual([
      ["ft1", "8c5d4f0e-0000-4000-8000-000000000001"],
      ["ft2", "8c5d4f0e-0000-4000-8000-000000000001"],
    ]);
    expect(imported[0]).toMatchObject({ name: "Form Submission - #ft1", tags: ["acme interiors"], description: "Please offboard them", status: "to do", statusType: "open" });
    const state = k.db.last("cockpit_task_mirror_state").args;
    expect(state).toMatchObject({ p_job: "seats", p_ok: true });
    expect(state.p_detail).toEqual({ members: 2, linked: 3, seats: 3, imported: 2, templates: 2, fields: 3, complete: true });
    expect(k.clickup.calls.every(c => c.method === "GET")).toBe(true);
  });

  test("a seat whose read fails or runs past 5 pages is skipped, named by role, and nobody is taken off its tasks", async () => {
    const k = kit();
    linked(k, [
      { memberId: "m-sm", clickupUserId: SM, label: "the systems manager" },
      { memberId: "m-csm", clickupUserId: CSM, label: "the CSM" },
    ]);
    k.clickup.byAssignee.set(SM, Array.from({ length: SEAT_PAGES * 100 + 1 }, (_, i) => cuTask(`sm${i}`)));
    let failCsm = true;
    const real = k.clickup.fetch;
    k.deps.clickupFetch = async (input, init) => {
      if (String(input).includes(`assignees%5B%5D=${CSM}`) || String(input).includes(`assignees[]=${CSM}`)) {
        if (failCsm) return new Response(JSON.stringify({ err: "Team not authorized" }), { status: 401 });
      }
      return real(input, init);
    };
    const r = await runSeats(k.deps);
    expect(r.complete).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.seats).toBe(0);
    expect(r.note).toContain("These seats' tasks were not read in full: the systems manager (more than 500 open tasks); the CSM (");
    expect(k.db.of("cockpit_task_mirror_seat").length).toBe(0);
    expect(k.db.last("cockpit_task_mirror_state").args.p_detail).toMatchObject({ complete: false, seats: 0, linked: 2 });
    failCsm = false;
  });

  test("each step stands alone: a failed members read is named and the rest still run", async () => {
    const k = kit();
    k.clickup.fail.set("team", 500);
    linked(k, [{ memberId: "m-csm", clickupUserId: CSM, label: "the CSM" }]);
    const r = await runSeats(k.deps);
    expect(r.ok).toBe(false);
    expect(r.members).toBeNull();
    expect(r.note).toContain("The ClickUp members were not read");
    expect(k.db.of("cockpit_clickup_members_sync").length).toBe(0);
    expect(k.db.of("cockpit_request_templates_sync").length).toBe(1);
    expect(k.db.of("cockpit_task_mirror_seat").length).toBe(1);
    expect(r.complete).toBe(true);
    // An empty member list is never sent (the sync would refuse it anyway).
    const k2 = kit();
    k2.clickup.members = [];
    await runSeats(k2.deps);
    expect(k2.db.of("cockpit_clickup_members_sync").length).toBe(0);
  });

  test("no token: nothing is read, nothing is linked, the state says what to add", async () => {
    const k = kit({ token: null });
    const r = await runSeats(k.deps);
    expect(k.clickup.calls.length).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.complete).toBe(false);
    expect(k.db.last("cockpit_task_mirror_state").args.p_detail).toMatchObject({ complete: false });
  });

  test("an old ticket: a Form Submission, open, with a Request Type", () => {
    expect(importTask(formTicket("a1", 10))?.optionId).toBe("8c5d4f0e-0000-4000-8000-000000000001");
    expect(importTask(formTicket("a2", 3))).toBeNull(); // no such option
    expect(importTask(formTicket("a3", ""))).toBeNull();
    expect(importTask(cuTask("a4", { name: "Fix the form" }))).toBeNull();
    expect(importTask(formTicket("a5", 10, { status: { status: "closed", type: "closed" } }))).toBeNull();
    expect(importTask(formTicket("a6", 10))?.dateCreated).toBe(NOW - 86_400_000);
  });
});
