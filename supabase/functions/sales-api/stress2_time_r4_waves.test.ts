// TIME stress, second series, round 4: the line a manager reads after Approve
// all, for leads whose clock is not Kuwait's.
//
// bun test supabase/functions/sales-api/stress2_time_r4_waves.test.ts
//
// followup.batch (followupAgent.ts) answers opens_at: the first instant any
// approved opener may go, on its lead's own clock (hoursRefusal: first_hours
// 09:00 to 18:00 there, never their day off). The Follow-ups page turns it
// into "Approved. It goes tomorrow at 09:00, their time." (apps/sales-cockpit
// src/lib/waves.ts approvedLine, batchWhen). A test that fails here is a
// finding: its comment says what the manager reads instead.

import { describe, expect, test } from "bun:test";
import { approvedLine, waveSettings } from "../../../apps/sales-cockpit/src/lib/waves.ts";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const rep: Who = { signed_in: true, seat: true, manager: false, email: "setter@stress.invalid" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@stress.invalid" };
const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };

function setup(now: number) {
  const w = fakeWorld(now);
  w.db.seed("cockpit_sales_settings", [
    { key: "whatsapp_guard", value: GATE },
    { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], quiet_days: ["friday"] } },
    { key: "messaging", value: { whatsapp: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: rep.email, ghl_user_id: "G-setter", active: true }]);
  const agent = makeFollowupAgent({
    io: w.io,
    audit: async () => undefined,
    sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
    whatsappHealth: async () => ({ paused: false, why: "" }),
  });
  function opener(waveId: string, contact: string, country: string): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_leads", [{ contact_id: contact, country, assigned_to: "G-setter" }]);
    w.db.seed("cockpit_sales_followups", [
      {
        id,
        contact_id: contact,
        owner_email: rep.email,
        segment: "reactivate",
        channel: "whatsapp_text",
        status: "draft",
        touch: 1,
        body: "Hi",
        created_at: w.db.iso(),
        context: { wave_id: waveId, language: "ar" },
      },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, wave_id: waveId, kind_key: "reactivate.ar.whatsapp_text" }]);
    return id;
  }
  return { ...w, agent, opener };
}

/** The HH:MM a line names. */
const named = (line: string) => [...line.matchAll(/\b(\d{2}):(\d{2})\b/g)].map(m => `${m[1]}:${m[2]}`);

describe("Thursday 8 October, 18:30 Kuwait: a manager approves one backlog opener for a lead in Dubai (country AE)", () => {
  // 18:30 Kuwait is 19:30 in Dubai, past the first hours there. The UAE works
  // on Friday (its weekend is Saturday and Sunday), so the opener may go on
  // Friday at 09:00 Dubai time, which is 08:00 in Kuwait.
  const THU_1830 = Date.parse("2026-10-08T18:30:00+03:00");
  const FRI_0900_DUBAI = Date.parse("2026-10-09T09:00:00+04:00");

  test("setup: sales-api answers opens_at = Friday 09:00 on the lead's clock (05:00 UTC), and not in hours now", async () => {
    const w = setup(THU_1830);
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const id = w.opener(String((started.wave as Row).id), "stress-t2r4-dubai-1", "AE");
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] });
    expect(out.count).toBe(1);
    expect(out.in_hours).toBe(false);
    expect(Date.parse(String(out.opens_at))).toBe(FRI_0900_DUBAI);
  });

  test("the line names the hour on the lead's clock when it says 'their time' (09:00 in Dubai), never Kuwait's 08:00", async () => {
    const w = setup(THU_1830);
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const id = w.opener(String((started.wave as Row).id), "stress-t2r4-dubai-2", "AE");
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] });
    const line = approvedLine(out, waveSettings({ waves: { batch_gap_s: 45 } }).gapS, { from: 9, to: 18, daysOff: ["friday"] }, THU_1830);
    // The card reads "Approved. It goes tomorrow at 08:00, their time.": 08:00
    // is Kuwait's clock; in Dubai the opener goes at 09:00.
    expect(line).toMatch(/their time/);
    expect(named(line)).toEqual(["09:00"]);
  });
});

describe("Thursday 22 October, 21:30 Kuwait: one opener for a lead in London (country GB, still on summer time)", () => {
  // 21:30 Kuwait is 19:30 in London (UTC+1 until 25 October). The opener may
  // go on Friday at 09:00 London time, 11:00 in Kuwait.
  const THU_2130 = Date.parse("2026-10-22T21:30:00+03:00");
  const FRI_0900_LONDON = Date.parse("2026-10-23T09:00:00+01:00");

  test("sales-api's opens_at is Friday 09:00 London time, and the line names 09:00 as their time, never Kuwait's 11:00", async () => {
    const w = setup(THU_2130);
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const id = w.opener(String((started.wave as Row).id), "stress-t2r4-london-1", "GB");
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] });
    expect(Date.parse(String(out.opens_at))).toBe(FRI_0900_LONDON);
    const line = approvedLine(out, 45, { from: 9, to: 18, daysOff: ["friday"] }, THU_2130);
    // The card reads "Approved. It goes tomorrow at 11:00, their time."
    expect(line).toMatch(/their time/);
    expect(named(line)).toEqual(["09:00"]);
  });
});

describe("control: a Kuwait lead approved on Thursday at 18:30", () => {
  test("goes on Saturday at 09:00, and the line says so", async () => {
    const THU_1830 = Date.parse("2026-10-08T18:30:00+03:00");
    const w = setup(THU_1830);
    const started = await w.agent.actions["followup.wave"]!(boss, { op: "start", pool: "never_booked" });
    const id = w.opener(String((started.wave as Row).id), "stress-t2r4-kuwait-1", "KW");
    const out = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: [id] });
    const line = approvedLine(out, 45, { from: 9, to: 18, daysOff: ["friday"] }, THU_1830);
    expect(line).toBe("Approved. It goes on Saturday at 09:00, their time.");
  });
});
