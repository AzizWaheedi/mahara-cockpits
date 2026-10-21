// recording.link: who may link a call, which calls can be linked, the booking
// the link names, the race two people linking at once, and the audit row.

import { beforeEach, describe, expect, test } from "bun:test";
import { ApiRefusal } from "./liveio.ts";
import type { Who } from "./lib.ts";
import { FakeDb } from "./testfakes.ts";
import { LINK_DAYS, makeCallLinks } from "./calllinks.ts";

type Row = Record<string, unknown>;

const T0 = Date.parse("2026-10-21T10:00:00Z");
const CLOSER: Who = {
  signed_in: true, seat: true, manager: false, role: "closer",
  email: "ahmed@maharamedia.com", fathom_email: "ahmed.fathom@maharamedia.com",
};
const MANAGER: Who = { signed_in: true, seat: true, manager: true, role: "manager", email: "aziz@maharamedia.com" };
const SETTER: Who = { signed_in: true, seat: true, manager: false, role: "setter", email: "lama@maharamedia.com" };

let db: FakeDb;
let audits: { action: string; id: string | null; before: unknown; after: unknown }[];

function build() {
  return makeCallLinks({
    svc: (path, init) => db.db(path, init),
    audit: async (_who, action, _t, id, before, after) => {
      audits.push({ action, id, before, after });
    },
    cockpitLead: async contactId => {
      const lead = db.t("cockpit_sales_leads").find(l => l.contact_id === contactId);
      if (!lead) throw new ApiRefusal("That lead is not in the cockpit.", 404);
      return lead;
    },
    now: () => T0,
  });
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

const call = (id: string): Row => db.t("cockpit_sales_recordings").find(r => r.recording_id === id) as Row;
const link = (who: Who, recording_id: string, contact_id = "c-mohsen") =>
  build().actions["recording.link"](who, { recording_id, contact_id });

beforeEach(() => {
  db = new FakeDb({ now: T0 });
  audits = [];
  db.tables.cockpit_sales_leads = [{ contact_id: "c-mohsen", name: "Mohsen" }, { contact_id: "c-other", name: "Other" }];
  db.tables.cockpit_sales_appointments = [
    { appointment_id: "a-demo", contact_id: "c-mohsen", call_type: "demo", start_at: "2026-10-20T13:00:00.000Z" },
    { appointment_id: "a-old", contact_id: "c-mohsen", call_type: "intro", start_at: "2026-10-18T13:00:00.000Z" },
  ];
  const base = { title: "Mahara Media: Mohsen (demo)", contact_id: null, appointment_id: null, matched_by: "none",
    source: "vault", kind: "sales", hidden_reason: null, recorded_by: "ahmed.fathom@maharamedia.com" };
  db.tables.cockpit_sales_recordings = [
    { ...base, recording_id: "194379855", started_at: "2026-10-20T13:59:07.000Z" },
    { ...base, recording_id: "200", started_at: "2026-10-20T14:00:00.000Z", recorded_by: "rasem@maharamedia.com" },
    { ...base, recording_id: "201", started_at: "2026-10-20T13:00:00.000Z", hidden_reason: "internal" },
    { ...base, recording_id: "maqsam:9", started_at: "2026-10-20T13:00:00.000Z", source: "maqsam", kind: "phone" },
    { ...base, recording_id: "202", started_at: "2026-10-20T13:00:00.000Z", contact_id: "c-other", matched_by: "email" },
    { ...base, recording_id: "203", started_at: "2026-10-17T09:00:00.000Z" },
  ];
});

describe("recording.link", () => {
  test("the closer who recorded the demo links it, with the booking beside it, and an audit row", async () => {
    const out = await link(CLOSER, "194379855");
    expect((out.recording as Row).contact_id).toBe("c-mohsen");
    expect([call("194379855").contact_id, call("194379855").appointment_id, call("194379855").matched_by]).toEqual([
      "c-mohsen", "a-demo", "hand",
    ]);
    expect(audits).toEqual([
      {
        action: "recording.link",
        id: "194379855",
        before: { contact_id: null, appointment_id: null, matched_by: "none" },
        after: { contact_id: "c-mohsen", appointment_id: "a-demo", matched_by: "hand" },
      },
    ]);
  });

  test("a closer links only their own calls; a manager links anyone's", async () => {
    expect((await refusal(link(CLOSER, "200"))).status).toBe(403);
    expect(call("200").contact_id).toBeNull();
    await link(MANAGER, "200");
    expect(call("200").contact_id).toBe("c-mohsen");
    expect((await refusal(link(SETTER, "194379855"))).status).toBe(403);
    expect(audits.length).toBe(1);
  });

  test("a hidden call, a phone call, another lead's call and an old call are refused", async () => {
    expect((await refusal(link(MANAGER, "201"))).message).toContain("hidden from sales");
    expect((await refusal(link(MANAGER, "maqsam:9"))).message).toContain("phone call");
    const taken = await refusal(link(MANAGER, "202"));
    expect([taken.status, taken.message]).toEqual([409, "That call is already another lead's. Ask a manager to move it."]);
    expect((await refusal(link(MANAGER, "203"))).message).toContain(`last ${LINK_DAYS} days`);
    expect((await refusal(link(MANAGER, "404"))).status).toBe(404);
    expect((await refusal(link(MANAGER, "194379855", "c-nobody"))).status).toBe(404);
    expect(call("202").contact_id).toBe("c-other");
    expect(audits).toEqual([]);
  });

  test("two people linking the same call at once: the second is told, and nothing is overwritten", async () => {
    db.beforePatch = () => {
      call("194379855").contact_id = "c-other";
    };
    const late = await refusal(link(CLOSER, "194379855"));
    expect([late.status, late.message]).toEqual([409, "Someone linked that call a moment ago. Reload the page."]);
    expect(call("194379855").contact_id).toBe("c-other");
    expect(audits).toEqual([]);
  });

  test("no booking within three hours leaves the call's booking empty", async () => {
    db.tables.cockpit_sales_appointments = [];
    await link(CLOSER, "194379855");
    expect([call("194379855").appointment_id, call("194379855").matched_by]).toEqual([null, "hand"]);
  });
});
