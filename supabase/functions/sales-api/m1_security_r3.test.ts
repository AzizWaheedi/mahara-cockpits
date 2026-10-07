// bun test supabase/functions/sales-api/m1_security_r3.test.ts
//
// Milestone 1, video-link round 3, security angle: what reaches the lead
// beside the room's own link, and the host's link kept away from the lead.
// Pilot settings (m1-scope.md section 3) unless a test says otherwise:
// rooms on for the test contact, Meet and Zoom on, every send channel on,
// count_on_join, settle and wrap off, live off, short_link off. Against
// testfakes.ts; no network, every lead and seat invented (stress-...,
// ...@stress.invalid).

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { leadFirstName, redact } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, isHostLink, redactRoom, shortUrl } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "stress-m1s3-setter@stress.invalid";
const OTHER = "stress-m1s3-other@stress.invalid";
const LEAD = "stress-m1s3-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";

const setter: Who = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};
const other: Who = {
  signed_in: true,
  seat: true,
  manager: false,
  email: OTHER,
  name: "Omar Other",
  role: "setter",
  ghl_user_id: "G-other",
};
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };

const PILOT_ROOMS = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: true,
  test_contacts: [LEAD],
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  count_on_join: false,
  settle: false,
  wrap: false,
  short_link: false,
};

function setup(o: { rooms?: Row; contact?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...PILOT_ROOMS, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: OTHER, name: "Omar Other", role: "setter", ghl_user_id: "G-other", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: OTHER, zoom_user_id: "Z-other", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, at: w.db.iso(), detail: "ready" }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-setter" }]);
  const contact = {
    id: LEAD,
    firstName: "Huda",
    name: "Huda Ali",
    phone: "+96550000000",
    email: "huda@stress.invalid",
    tags: ["roas-qualified"],
    country: "KW",
    ...(o.contact ?? {}),
  };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: async (who, b) => {
      sends.push({ who: who.email, kind: "text", ...b });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, kind: "template", ...t });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find((r) => r.id === id) as Row;
  return { ...w, rooms, audits, sends, room };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  return null;
}

/** The seat presses Send a video link (lead page, manual); the worker makes it with `joinUrl` and tells sales-api. */
async function videoLink(w: ReturnType<typeof setup>, provider: "meet" | "zoom", joinUrl: string): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider,
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.io.db("cockpit_sales_room_events", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" } },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: joinUrl,
      provider_meeting_id: provider === "meet" ? "evt-1" : "81234567890",
      opened_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    },
  });
  // A host's link is refused at worker.ready (bad_link: the room is never
  // opened on it, round 4 reads ZAK escaped as capitals too); the worker
  // sees the refusal, and nothing goes to the lead.
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } }).catch(e => {
    if (!(e instanceof ApiRefusal && e.extra?.code === "bad_link")) throw e;
  });
  await w.flush();
  return id;
}

// ---------------------------------------------------------------------------
// A Zoom host token whose parameter name is escaped as capital letters
// ---------------------------------------------------------------------------

describe("m1 security r3: a Zoom host token escaped as capital letters (defence in depth)", () => {
  // The rule as the code states it: the parameter's name is read case-blind
  // (ZAK= is refused like zak=) and its letters may be percent-escaped
  // (%7Aak= is refused, m1 round 1). %5A%41%4B= is both at once: Z, A and K
  // escaped as capitals, ZAK once Zoom decodes it.
  const UPPER = "https://us06web.zoom.us/j/81234567890?pwd=abc&%5A%41%4B=hosttoken123";
  const MIXED = "https://us06web.zoom.us/j/81234567890?pwd=abc&z%41k=hosttoken123";

  test("control: zak=, ZAK=, %7Aak= and %7A%61%6B= are all a host's link, never a lead's (the rule the code states)", () => {
    for (const n of ["zak", "ZAK", "%7Aak", "%7A%61%6B"]) {
      const url = `https://us06web.zoom.us/j/81234567890?pwd=abc&${n}=hosttoken123`;
      expect([n, isHostLink(url)]).toEqual([n, true]);
      expect([n, shortUrl("K7Q2MX", url, false)]).toEqual([n, null]);
      expect([n, String(redactRoom(`Zoom said: ${url}`)).includes("hosttoken123")]).toEqual([n, false]);
    }
  });

  test("host-link-escaped-zak-capitals: ?%5A%41%4B= and ?z%41k= (ZAK and zAk once decoded) pass as a lead's link and through both redactions", () => {
    expect(decodeURIComponent("%5A%41%4B").toLowerCase()).toBe("zak");
    expect(decodeURIComponent("z%41k").toLowerCase()).toBe("zak");
    for (const url of [UPPER, MIXED]) {
      expect([url, isHostLink(url)]).toEqual([url, true]);
      expect([url, shortUrl("K7Q2MX", url, false)]).toEqual([url, null]);
      expect([url, redact(`Zoom said: ${url}`).includes("hosttoken123")]).toEqual([url, false]);
      expect([url, String(redactRoom(`Zoom said: ${url}`)).includes("hosttoken123")]).toEqual([url, false]);
    }
  });

  test("host-link-escaped-zak-capitals (the lead's message): a Zoom join link carrying ?%5A%41%4B= goes to the lead by email with the host token in it", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: true } } });
    const id = await videoLink(w, "zoom", UPPER);
    const bodies = w.sends.map((s) => String(s.body ?? ""));
    expect(bodies.some((b) => b.includes("hosttoken123"))).toBe(false);
    expect(w.room(id).link_sent_at ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The lead's own name on the WhatsApp template lane (needs rooms.short_link)
// ---------------------------------------------------------------------------

describe("m1 security r3: the lead's first name on the template lane (needs rooms.short_link on, outside the pilot)", () => {
  test("control: the free-text lanes say Hi there for a first name that is a domain and a path (m1 round 1 holds)", async () => {
    expect(leadFirstName("mahara-refunds.example/claim", "mahara-refunds.example/claim")).toBe("");
    const w = setup({
      rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: true } },
      contact: { firstName: "mahara-refunds.example/claim", name: "mahara-refunds.example/claim" },
    });
    await videoLink(w, "meet", MEET_URL);
    const mail = w.sends.find((s) => s.kind === "text") as Row;
    expect(mail).toBeTruthy();
    expect(String(mail.body)).not.toContain("mahara-refunds.example");
  });

  // Outside Milestone 1 (the template lane needs rooms.short_link on) and
  // outside video-link round 4's list: kept, skipped, for the round that
  // turns the short link on.
  test.skip("room-template-greets-link-name: with the short link on and the lead's WhatsApp window shut, the call_link template (Hi {{1}}, {{1}} = HighLevel's own first_name) goes to a lead whose first name is a link", async () => {
    const w = setup({
      rooms: { short_link: true, send: { whatsapp_text: true, whatsapp_template: true, email: true } },
      contact: { firstName: "mahara-refunds.example/claim", name: "mahara-refunds.example/claim" },
    });
    // The call_link routes Meta approved, each with its workflow (20261003b's rows, switched on).
    w.db.seed("cockpit_sales_wa_templates", [
      { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
      { key: "call_link_ar", active: true, workflow_id: "wf-call-link-ar" },
    ]);
    // The lead last wrote two days ago: free text cannot go, the template can.
    const at = new Date(w.clock.now - 48 * 60 * MIN).toISOString();
    w.db.seed("cockpit_sales_inbox", [{ contact_id: LEAD, last_message_at: at, last_direction: "inbound", inbound_whatsapp_at: at }]);
    await videoLink(w, "meet", MEET_URL);
    // The free-text lanes greet this lead "Hi there"; the template greets
    // them with HighLevel's first_name as it stands, the link (index.ts
    // sendTemplateOnce takes contact.firstName raw, and the workflow merges
    // HighLevel's own field). A lead whose name is no name gets no template.
    const templates = w.sends.filter((s) => s.kind === "template").map((t) => t.key);
    expect(templates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Controls: another rep's room, as the pilot runs (expected to hold)
// ---------------------------------------------------------------------------

describe("m1 security r3: another rep's room (controls)", () => {
  test("a non-host seat's room.status and live.status never carry the host's start link; room.open is the host's alone and unaudited of the link", async () => {
    const w = setup();
    const id = await videoLink(w, "zoom", ZOOM_URL);
    w.db.seed("cockpit_sales_room_secrets", [
      { room_id: id, start_url: "https://us06web.zoom.us/s/81234567890?zak=hosttoken123", expires_at: new Date(w.clock.now + 60 * MIN).toISOString() },
    ]);
    const st = await w.rooms.actions["room.status"]!(other, { room_id: id });
    expect(JSON.stringify(st)).not.toContain("hosttoken123");
    const r = await refused(w.rooms.actions["room.open"]!(other, { room_id: id }));
    expect(r?.status).toBe(403);
    const live = await w.rooms.actions["live.status"]!(other, {}).catch((e) => ({ error: String(e) }));
    expect(JSON.stringify(live)).not.toContain(id);
    const mine = await w.rooms.actions["room.open"]!(setter, { room_id: id });
    expect(String(mine.start_url)).toContain("hosttoken123");
    expect(JSON.stringify(w.audits)).not.toContain("hosttoken123");
  });

  test("a seat's room.create with another rep's request id never answers with the other rep's room", async () => {
    const w = setup();
    const rid = crypto.randomUUID();
    const a = await w.rooms.actions["room.create"]!(setter, { request_id: rid, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    let theirs: Row | null = null;
    try {
      theirs = await w.rooms.actions["room.create"]!(other, { request_id: rid, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    } catch (e) {
      if (!(e instanceof ApiRefusal)) throw e;
    }
    expect(String(((theirs?.room ?? {}) as Row).id ?? "")).not.toBe(String((a.room as Row).id));
  });
});
