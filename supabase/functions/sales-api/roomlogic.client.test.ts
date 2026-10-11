// The video rooms' three client gates (channelPlan, countLive, and the
// lead checks room.create and Take on share) hold for a signed client too:
// HighLevel's contact carries the client tag but not the deal, so the caller
// marks a contact the cockpit holds a live deal for (clients.ts markSigned).

import { describe, expect, test } from "bun:test";
import { clientFacts, isActiveClient, markSigned, SIGNED_MARK } from "./clients.ts";
import {
  adoptRefusal,
  applyRoomEvent,
  channelPlan,
  countLive,
  createRefusal,
  DEFAULT_ROOMS_JSON,
  DEFAULT_ROOMS_SETTING,
  newRoomRow,
  roomCtx,
  type RoomRow,
  roomsSetting,
} from "./roomlogic.ts";

type Row = Record<string, unknown>;

const T0 = Date.parse("2026-10-04T08:00:00.000Z");
const JOIN = T0 + 4 * 60_000;
const SETTER = "maria@maharamedia.com";
const at = (t: number) => new Date(t).toISOString();
const LEAD: Row = { phone: "+96550001234", email: "lead@example.com", tags: ["roas-qualified"], dnd: false, dndSettings: {} };
const DEAL = { contact_id: "c1", submitted_at: "2026-10-01T10:00:00Z", closer: "Ahmed", contracted_revenue: 6000, voided: false };
/** The lead as a signed client: no tag in HighLevel, a live deal in the cockpit. */
const SIGNED = markSigned(LEAD, clientFacts({ ...LEAD, contact_id: "c1" }, [DEAL]));

const ON = roomsSetting({
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  short_link: true,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
});

describe("the signed mark", () => {
  test("a live deal marks the contact; the tag alone or no deal leaves it as it is", () => {
    expect(SIGNED[SIGNED_MARK]).toBe(true);
    expect(isActiveClient(SIGNED)).toBe(true);
    const tagged = { ...LEAD, tags: ["client"] };
    expect(markSigned(tagged, clientFacts(tagged, []))).toBe(tagged);
    expect(markSigned(LEAD, clientFacts(LEAD, []))).toBe(LEAD);
    expect(markSigned(LEAD, clientFacts({ ...LEAD, contact_id: "c1" }, [{ ...DEAL, voided: true }]))).toBe(LEAD);
  });

  test("a tag and a deal: marked as well (either way a client)", () => {
    const both = { ...LEAD, contact_id: "c1", tags: ["client"] };
    expect(markSigned(both, clientFacts(both, [DEAL]))[SIGNED_MARK]).toBe(true);
  });

  test("only true counts: a stray value is not a mark", () => {
    expect(isActiveClient({ ...LEAD, [SIGNED_MARK]: "yes" })).toBe(false);
    expect(isActiveClient(LEAD)).toBe(false);
    expect(isActiveClient(null)).toBe(false);
  });
});

describe("the three room gates hold for a signed client", () => {
  test("channelPlan: no link goes to a signed client", () => {
    const base = {
      last_inbound_at: at(T0 - 2 * 3_600_000),
      now: T0,
      setting: ON,
      whatsapp_on: true,
      guard: { connector_off: true, single_copy_ok_at: "2026-10-03T09:00:00Z" },
      template_live: true,
      room_wa: [],
    };
    expect(channelPlan({ ...base, contact: SIGNED }).refusal).toBe("client");
    expect(channelPlan({ ...base, contact: LEAD }).refusal).toBeNull();
  });

  test("room.create and Take on: a signed client is refused as a client", () => {
    const create = (contact: Row) =>
      createRefusal({
        setting: ON,
        purpose: "fallback",
        provider: "meet",
        call_kind: "intro",
        contact_id: "c1",
        contact,
        host: { zoom_status: "licensed", zoom_live: false, google_ok: true },
        host_email: SETTER,
        lead_room_open: false,
        host_room_open: false,
        booked_demo: false,
        booked_intro: true,
      });
    expect(create(SIGNED)?.code).toBe("client");
    expect(create(LEAD)).toBeNull();
    expect(adoptRefusal({ setting: ON, contact_id: "c1", contact: SIGNED })?.code).toBe("client");
    expect(adoptRefusal({ setting: ON, contact_id: "c1", contact: LEAD })).toBeNull();
  });

  test("countLive: a signed client's join is not a lead's, so nothing is booked", () => {
    const ctx = roomCtx(DEFAULT_ROOMS_SETTING);
    const step = (r: RoomRow, e: Parameters<typeof applyRoomEvent>[1], t: number): RoomRow => {
      const a = applyRoomEvent(r, e, t, ctx);
      if (!a.ok) throw new Error(`refused: ${a.code}`);
      return a.room;
    };
    let r = newRoomRow({
      id: "3f2a9c1e-7b4d-4e8a-9c2f-0a1b2c3d4e5f",
      request_id: "9b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3",
      code: "K7Q2MX",
      contact_id: "c1",
      purpose: "fallback",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      now: T0,
    });
    r = step(r, { kind: "claim" }, T0);
    r = step(r, { kind: "ready", join_url: "https://meet.google.com/abc-defg-hij", provider_meeting_id: null }, T0 + 5_000);
    const joined: RoomRow = { ...r, state: "lead_in", lead_in_at: at(JOIN) };
    const count = (contact: Row) =>
      countLive({
        room: joined,
        setting: roomsSetting({ ...DEFAULT_ROOMS_JSON, count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" }),
        contact: { firstName: "Sara", name: "Sara Al Ali", ...contact },
        upcoming: null,
        host_ghl_user_id: "GHLSETTER",
        location_id: "7NI8yyJtwsh2OOWA5Icr",
        link: "https://call.maharamedia.com/K7Q2MX",
      });
    expect(count(SIGNED)).toEqual({ action: "none", claim: true, count_result: "not_a_lead", reason: "client" });
    expect(count(LEAD).action).toBe("create");
  });
});
