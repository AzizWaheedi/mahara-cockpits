// call.outcome: who may rate a call, which calls can be rated, what each
// answer must be, that only the fields sent change, and the audit row.

import { beforeEach, describe, expect, test } from "bun:test";
import { heldForOutcome, makeCallOutcomes, NO_DEMO_REASONS, readQuality } from "./callOutcomes.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const T0 = Date.parse("2026-10-29T10:00:00Z");
const HOST: Who = {
  signed_in: true, seat: true, manager: false, role: "closer",
  email: "ahmed@maharamedia.com", ghl_user_id: "u-ahmed",
};
const OTHER: Who = { signed_in: true, seat: true, manager: false, role: "setter", email: "lama@maharamedia.com", ghl_user_id: "u-lama" };
const MANAGER: Who = { signed_in: true, seat: true, manager: true, role: "manager", email: "aziz@maharamedia.com", ghl_user_id: "u-aziz" };

let db: FakeDb;
let audits: { action: string; id: string | null; before: unknown; after: unknown; meta?: Row }[];

function save(who: Who, b: Row) {
  return makeCallOutcomes({
    svc: (path, init) => db.db(path, init),
    audit: async (_who, action, _t, id, before, after, meta) => {
      audits.push({ action, id, before, after, meta });
    },
    now: () => T0,
  }).actions["call.outcome"](who, b);
}

async function refusal(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

const row = (id: string) => db.t("cockpit_sales_call_outcomes").find(r => r.appointment_id === id) as Row | undefined;

beforeEach(() => {
  db = new FakeDb({ now: T0 });
  audits = [];
  const call = (appointment_id: string, call_type: string, status: string, start_at = "2026-10-29T08:00:00.000Z"): Row => ({
    appointment_id, contact_id: `c-${appointment_id}`, call_type, status, start_at, assigned_user_id: "u-ahmed",
  });
  db.tables.cockpit_sales_calendar = [
    call("intro", "intro", "showed"),
    call("demo", "demo", "showed"),
    call("dq", "intro", "invalid"),
    call("past-confirmed", "intro", "confirmed"),
    call("noshow", "intro", "noshow"),
    call("later", "intro", "confirmed", "2026-10-29T15:00:00.000Z"),
    call("fu", "follow_up", "showed"),
  ];
  db.tables.cockpit_sales_call_outcomes = [];
});

describe("what the answers must be", () => {
  test("lead quality is a whole number from 1 to 10", () => {
    expect(readQuality(1)).toBe(1);
    expect(readQuality("10")).toBe(10);
    expect(readQuality(undefined)).toBeUndefined();
    for (const bad of [0, 11, 6.5, "", "seven", null, -3]) expect(() => readQuality(bad)).toThrow(ApiRefusal);
  });

  test("a held call: marked showed, completed or disqualified, or confirmed once past", () => {
    expect(heldForOutcome("showed", null, T0)).toBe(true);
    expect(heldForOutcome("invalid", null, T0)).toBe(true);
    expect(heldForOutcome("confirmed", "2026-10-29T08:00:00Z", T0)).toBe(true);
    expect(heldForOutcome("confirmed", "2026-10-29T11:00:00Z", T0)).toBe(false);
    expect(heldForOutcome("noshow", "2026-10-29T08:00:00Z", T0)).toBe(false);
    expect(heldForOutcome("cancelled", "2026-10-29T08:00:00Z", T0)).toBe(false);
  });

  test("the reasons are the eleven the migration allows", () => {
    expect([...NO_DEMO_REASONS]).toEqual([
      "signed", "no_budget", "too_small", "not_decision_maker", "not_a_fit",
      "no_need", "not_ready", "has_agency", "price_only", "thinking", "other",
    ]);
  });
});

describe("call.outcome", () => {
  test("the host rates an intro and says why no demo, in two presses", async () => {
    await save(HOST, { appointment_id: "intro", lead_quality: 7 });
    expect(row("intro")).toMatchObject({ lead_quality: 7, quality_by: HOST.email, quality_role: "closer", call_type: "intro" });
    expect(row("intro")?.no_demo_reason ?? null).toBeNull();
    await save(HOST, { appointment_id: "intro", no_demo_reason: "not_decision_maker" });
    // The second press kept the first answer.
    expect(row("intro")).toMatchObject({ lead_quality: 7, no_demo_reason: "not_decision_maker", reason_by: HOST.email });
    expect(audits.map(a => a.action)).toEqual(["call.outcome", "call.outcome"]);
    expect(audits[1]?.before).toMatchObject({ lead_quality: 7 });
  });

  test("Other needs a few words, and another reason clears them", async () => {
    expect((await refusal(save(HOST, { appointment_id: "intro", no_demo_reason: "other" }))).message).toContain("few words");
    await save(HOST, { appointment_id: "intro", no_demo_reason: "other", no_demo_note: "Moving offices first" });
    expect(row("intro")).toMatchObject({ no_demo_reason: "other", no_demo_note: "Moving offices first" });
    await save(HOST, { appointment_id: "intro", no_demo_reason: "not_ready" });
    expect(row("intro")).toMatchObject({ no_demo_reason: "not_ready", no_demo_note: null });
  });

  test("a demo is rated but never asked why no demo", async () => {
    await save(HOST, { appointment_id: "demo", lead_quality: 9 });
    expect(row("demo")).toMatchObject({ lead_quality: 9, call_type: "demo" });
    expect((await refusal(save(HOST, { appointment_id: "demo", no_demo_reason: "no_budget" }))).message).toContain("Only an intro");
  });

  test("a disqualified call and a past confirmed call can be rated", async () => {
    await save(HOST, { appointment_id: "dq", lead_quality: 2 });
    await save(HOST, { appointment_id: "past-confirmed", lead_quality: 6 });
    expect(row("dq")?.lead_quality).toBe(2);
    expect(row("past-confirmed")?.lead_quality).toBe(6);
  });

  test("a no-show, a call still ahead and a follow-up are refused", async () => {
    expect((await refusal(save(HOST, { appointment_id: "noshow", lead_quality: 5 }))).message).toContain("Mark it Showed first");
    expect((await refusal(save(HOST, { appointment_id: "later", lead_quality: 5 }))).message).toContain("not happened yet");
    expect((await refusal(save(HOST, { appointment_id: "fu", lead_quality: 5 }))).message).toContain("Only intros and demos");
    expect((await refusal(save(HOST, { appointment_id: "gone", lead_quality: 5 }))).status).toBe(404);
    expect(db.t("cockpit_sales_call_outcomes")).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  test("another rep cannot rate the host's call; a manager can, and it says so", async () => {
    const no = await refusal(save(OTHER, { appointment_id: "intro", lead_quality: 4 }));
    expect(no.status).toBe(403);
    expect(no.message).toContain("another rep");
    const unlinked = await refusal(save({ ...OTHER, ghl_user_id: null }, { appointment_id: "intro", lead_quality: 4 }));
    expect(unlinked.message).toContain("not linked");
    await save(MANAGER, { appointment_id: "intro", lead_quality: 4 });
    expect(row("intro")).toMatchObject({ lead_quality: 4, quality_role: "manager" });
    expect(audits[0]?.meta).toMatchObject({ by_manager: true });
  });

  test("bad answers and empty presses are refused before anything is read", async () => {
    for (const b of [
      { appointment_id: "intro", lead_quality: 0 },
      { appointment_id: "intro", lead_quality: 11 },
      { appointment_id: "intro", no_demo_reason: "too_expensive" },
      { appointment_id: "intro" },
      { lead_quality: 5 },
    ])
      await refusal(save(HOST, b));
    expect(db.t("cockpit_sales_call_outcomes")).toHaveLength(0);
  });
});
