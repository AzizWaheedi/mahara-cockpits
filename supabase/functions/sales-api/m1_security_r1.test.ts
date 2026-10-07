// bun test supabase/functions/sales-api/m1_security_r1.test.ts
//
// Milestone 1, video-link round 1, security angle: the link a missed call
// sends the lead, and who may act on a room. Pilot settings (m1-scope.md
// section 3): rooms on for the test contact, Meet and Zoom on, every send
// channel on, count_on_join, settle and wrap off, live off. Against
// testfakes.ts; no network, every lead and seat invented (stress-...,
// ...@stress.invalid).

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { redact } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, isHostLink, redactRoom, shortUrl } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "stress-m1s-setter@stress.invalid";
const OTHER = "stress-m1s-other@stress.invalid";
const LEAD = "stress-m1s-lead";
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
const boss: Who = {
  signed_in: true,
  seat: true,
  manager: true,
  email: "stress-m1s-boss@stress.invalid",
  name: "Boss",
  role: "manager",
};
const desk: Who = {
  signed_in: true,
  seat: true,
  manager: false,
  email: "sales-desk",
  name: "Sales desk",
};

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
};

function setup(o: { rooms?: Row; contact?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...PILOT_ROOMS, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "followups", value: { enabled: true, agent: false } },
    {
      key: "whatsapp_guard",
      value: {
        connector_off: true,
        single_copy_ok_at: "2026-10-01T00:00:00Z",
        templates_per_day: 250,
      },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    {
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      active: true,
    },
    {
      email: OTHER,
      name: "Omar Other",
      role: "setter",
      ghl_user_id: "G-other",
      active: true,
    },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    {
      email: SETTER,
      zoom_user_id: "Z-setter",
      zoom_status: "licensed",
      google_ok: true,
    },
    {
      email: OTHER,
      zoom_user_id: "Z-other",
      zoom_status: "licensed",
      google_ok: true,
    },
  ]);
  w.db.seed("cockpit_sales_worker_status", [
    {
      worker: "sales-desk",
      job: "rooms",
      ok: true,
      at: w.db.iso(),
      detail: "ready",
    },
  ]);
  w.db.seed("cockpit_sales_leads", [
    {
      contact_id: LEAD,
      name: "Huda Ali",
      country: "KW",
      assigned_to: "G-setter",
    },
  ]);
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
      audits.push({
        who: who.email,
        action,
        entityType,
        entityId,
        before,
        after,
        metadata,
      });
    },
    markAppointment: async () => ({}),
    sendText: async (who, b) => {
      sends.push({ who: who.email, kind: "text", ...b });
      return {
        message: { id: fakeUuid(), state: "sent", provider_status: "sent" },
      };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, kind: "template", ...t });
      return {
        message: { id: fakeUuid(), state: "sent", provider_status: "sent" },
      };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find((r) => r.id === id) as Row;
  return { ...w, rooms, audits, sends, room };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

/** The seat presses Send a video link (lead page, manual), the worker makes it and tells sales-api. */
async function videoLink(w: ReturnType<typeof setup>, provider: "meet" | "zoom" = "meet"): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider,
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
  const t = w.db.iso();
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: {
      state: "creating",
      claimed_at: t,
      worker_run: "run-1",
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.io.db("cockpit_sales_room_events", {
    method: "POST",
    body: {
      room_id: id,
      kind: "worker.ready",
      source: "worker",
      dedupe_key: `worker.ready:${id}`,
      detail: { worker_run: "run-1" },
    },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: provider === "meet" ? MEET_URL : ZOOM_URL,
      provider_meeting_id: provider === "meet" ? "evt-1" : "81234567890",
      opened_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.rooms.desk["room.event"]!(desk, {
    kind: "worker.ready",
    room_id: id,
    payload: { worker_run: "run-1" },
  });
  await w.flush();
  return id;
}

/** Every https/http/www link, or bare domain with a path, in a message. */
function linksIn(body: string): string[] {
  return body.match(/(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi) ?? [];
}

// ---------------------------------------------------------------------------

describe("m1 security r1: the lead's own name inside Mahara's video-link message", () => {
  test("control: a plain name, the email carries one link and it is the room's (the fixture works)", async () => {
    const w = setup({
      rooms: {
        send: { whatsapp_text: false, whatsapp_template: false, email: true },
      },
    });
    const id = await videoLink(w);
    expect(w.room(id).link_sent_at).toBeTruthy();
    const mail = w.sends.find((s) => s.kind === "text" && s.channel === "email") as Row;
    expect(mail).toBeTruthy();
    const links = linksIn(String(mail.body));
    expect(links.map((l) => l.replace(/[.,]+$/, ""))).toEqual([MEET_URL]);
  });

  test("lead-name-link-in-link-message: a lead form's first name that is a link (anyone can fill a lead form with any name and any number) goes into Mahara's own message beside the room link", async () => {
    // A HighLevel contact made from a public lead form: the first name is
    // whatever was typed, the phone and email whoever's were typed.
    const w = setup({
      rooms: {
        send: { whatsapp_text: false, whatsapp_template: false, email: true },
      },
      contact: {
        firstName: "https://mahara-refunds.example/claim",
        name: "https://mahara-refunds.example/claim",
      },
    });
    const id = await videoLink(w);
    expect(w.room(id).link_sent_at).toBeTruthy();
    const bodies = w.sends.filter((s) => s.kind === "text").map((s) => String(s.body));
    expect(bodies.length).toBeGreaterThan(0);
    // Only the room's own link may be in a message Mahara sends the lead.
    const foreign = bodies
      .flatMap(linksIn)
      .map((l) => l.replace(/[.,]+$/, ""))
      .filter((l) => l !== MEET_URL);
    expect(foreign).toEqual([]);
  });

  test("lead-name-link-in-link-message (WhatsApp text): a bare domain with a path as the first name is put in the WhatsApp line too", async () => {
    const w = setup({
      rooms: {
        send: { whatsapp_text: true, whatsapp_template: false, email: false },
      },
      contact: { firstName: "mahara-refunds.example/claim" },
    });
    // The lead wrote inside the last 24 hours, so free text may go.
    w.db.seed("cockpit_sales_inbox", [
      {
        contact_id: LEAD,
        last_message_at: new Date(w.clock.now - 10 * MIN).toISOString(),
        last_direction: "inbound",
        inbound_whatsapp_at: new Date(w.clock.now - 10 * MIN).toISOString(),
      },
    ]);
    const id = await videoLink(w);
    const bodies = w.sends.filter((s) => s.kind === "text").map((s) => String(s.body));
    expect(w.room(id).link_sent_at).toBeTruthy();
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => b.includes("mahara-refunds.example"))).toBe(false);
  });

  test("lead-name-bidi-in-link-message: a first name carrying a right-to-left override reverses the rest of Mahara's message on the lead's screen (the room link included)", async () => {
    const w = setup({
      rooms: {
        send: { whatsapp_text: false, whatsapp_template: false, email: true },
      },
      contact: { firstName: "Huda‮" },
    });
    await videoLink(w);
    const bodies = w.sends.filter((s) => s.kind === "text").map((s) => String(s.body));
    expect(bodies.length).toBeGreaterThan(0);
    // No bidi override, embedding or isolate from a name reaches the message.
    expect(bodies.some((b) => /[‪-‮⁦-⁩]/.test(b))).toBe(false);
  });
});

describe("m1 security r1: another rep's room (the fixture's own rules hold)", () => {
  test("a non-host seat is refused room.open, room.send, room.mark and room.end on the setter's room, and gets no host link", async () => {
    const w = setup();
    const id = await videoLink(w, "zoom");
    w.db.seed("cockpit_sales_room_secrets", [
      {
        room_id: id,
        start_url: "https://us06web.zoom.us/s/81234567890?zak=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig",
        expires_at: new Date(w.clock.now + 60 * MIN).toISOString(),
      },
    ]);
    const v = Number(w.room(id).version);
    for (const [action, body] of [
      ["room.open", { room_id: id }],
      ["room.send", { room_id: id, request_id: crypto.randomUUID(), channel: "email" }],
      ["room.mark", { room_id: id, version: v, what: "host_in" }],
      ["room.end", { room_id: id, version: v, reason: "end" }],
    ] as const) {
      const r = await refused(w.rooms.actions[action]!(other, body as Row));
      expect([action, r.status]).toEqual([action, 403]);
      expect(JSON.stringify(r.extra)).not.toContain("zak");
    }
    // A manager may act on it but never gets the host's own link.
    const m = await refused(w.rooms.actions["room.open"]!(boss, { room_id: id }));
    expect(m.status).toBe(403);
    const status = await w.rooms.actions["room.status"]!(other, {
      room_id: id,
    });
    expect(JSON.stringify(status)).not.toContain("zak");
  });
});

describe("m1 security r1: a Zoom host link written with an escaped parameter name (defence in depth)", () => {
  // Zoom decodes %7A to z in a query parameter's name, so ?%7Aak= is zak=.
  const HOST = "https://us06web.zoom.us/s/81234567890?%7Aak=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.c2lnbmF0dXJl";
  const HOST_PATH = "https://us06web.zoom.us/j/81234567890?pwd=abc&%7aak=hosttoken123";

  test("control: the plain zak= form is never a lead's link, and is redacted (the fixture works)", () => {
    expect(isHostLink("https://us06web.zoom.us/s/81234567890?zak=hosttoken123")).toBe(true);
    expect(shortUrl("K7Q2MX", "https://us06web.zoom.us/j/81234567890?zak=hosttoken123", false)).toBeNull();
    expect(redactRoom("see https://us06web.zoom.us/j/1?zak=hosttoken123")).not.toContain("hosttoken123");
  });

  test("host-link-escaped-zak: a start link whose zak is written %7Aak passes as a lead's link and through every redaction", () => {
    expect(isHostLink(HOST)).toBe(true);
    expect(isHostLink(HOST_PATH)).toBe(true);
    expect(shortUrl("K7Q2MX", HOST_PATH, false)).toBeNull();
    expect(redact(`Zoom said: ${HOST_PATH}`)).not.toContain("hosttoken123");
    expect(String(redactRoom(`Zoom said: ${HOST_PATH}`))).not.toContain("hosttoken123");
  });
});
